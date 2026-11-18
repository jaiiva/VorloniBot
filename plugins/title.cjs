"use strict";

const { load } = require("cheerio");
const { lookup } = require("node:dns/promises");
const { request: httpRequest } = require("node:http");
const { request: httpsRequest } = require("node:https");
const ipaddr = require("ipaddr.js");

const MAX_BYTES = 256 * 1024;
const MAX_JSON_BYTES = 32 * 1024;
const MAX_REDIRECTS = 3;

function firstUrl(message) {
  for (const match of message.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const candidate = match[0].replace(/[.,!?;:)\]}]+$/, "");
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
        return url.href;
      }
    } catch {
      // Ohitetaan virheellinen linkki.
    }
  }
  return undefined;
}

function isPublicAddress(address) {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.range() === "ipv4Mapped") {
      return parsed.toIPv4Address().range() === "unicast";
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

function cleanTitle(text) {
  const title = text
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  return Array.from(title).slice(0, 250).join("");
}

function extractTitle(html, preferOpenGraph = false) {
  const $ = load(html);
  const openGraph = $('meta[property="og:title"]').first().attr("content");
  const description = $('meta[property="og:description"]').first().attr("content");
  const pageTitle = $("title").first().text();
  if (preferOpenGraph) {
    const value = openGraph && openGraph.trim().toLowerCase() !== "facebook"
      ? openGraph : description || pageTitle;
    const withoutStats = value.replace(
      /^[^|\n]{0,90}\b(?:views|reactions|näyttökertaa|reaktiota)\b[^|\n]*\|\s*/iu, ""
    );
    return cleanTitle(withoutStats.split(/\n\s*\n/)[0]);
  }
  return cleanTitle(pageTitle || openGraph || "");
}

function isFacebookHost(hostname) {
  return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
}

function isInstagramHost(hostname) {
  return hostname === "instagram.com" || hostname.endsWith(".instagram.com");
}

function prefersOpenGraph(hostname) {
  return isFacebookHost(hostname) || isInstagramHost(hostname);
}

function youtubeOEmbedUrl(url) {
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else if (/^\/(shorts|live)\/[^/]+\/?$/.test(url.pathname)) {
      id = url.pathname.split("/")[2];
    }
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return undefined;
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", `https://www.youtube.com/watch?v=${id}`);
  endpoint.searchParams.set("format", "json");
  return endpoint;
}

function redditOEmbedUrl(url) {
  if (!["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com",
    "m.reddit.com", "sh.reddit.com"].includes(url.hostname.toLowerCase()) ||
      !/^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(url.pathname)) {
    return undefined;
  }
  const endpoint = new URL("https://www.reddit.com/oembed");
  endpoint.searchParams.set("url", `https://www.reddit.com${url.pathname}`);
  return endpoint;
}

function extractOEmbedTitle(json) {
  const value = JSON.parse(json);
  if (!value || typeof value !== "object" || typeof value.title !== "string") {
    return undefined;
  }
  return cleanTitle(value.title);
}

function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

async function getPage(url, format, signal) {
  if ((url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password) {
    throw new Error("Linkin osoite ei ole sallittu.");
  }

  // Kiinnitetään tarkistettu IP yhteyteen myös DNS-rebindingin estämiseksi.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Paikallisiin tai yksityisiin osoitteisiin ei oteta yhteyttä.");
  }
  const { address, family } = addresses[0];

  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      headers: {
        Accept: format === "html" ? "text/html, application/xhtml+xml" : "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "VorloniBot/0.1",
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      lookup: pinnedLookup(address, family === 6 ? 6 : 4),
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }
      const type = response.headers["content-type"] ?? "";
      const expectedType = format === "html"
        ? /^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i
        : /^application\/json(?:\s*;|$)/i;
      if (status !== 200 || !expectedType.test(type)) {
        response.resume();
        resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }
      const chunks = [];
      let length = 0;
      const limit = format === "html" ? MAX_BYTES : MAX_JSON_BYTES;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > limit) {
          request.destroy(new Error("Vastaus on liian suuri."));
        } else {
          chunks.push(chunk);
          if (format === "html") {
            const body = Buffer.concat(chunks);
            const html = body.toString("utf8");
            // Facebookin ja Instagramin varsinainen otsikko on yleensä ennen title-tagia.
            const complete = prefersOpenGraph(url.hostname)
              ? /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*>/i.test(html) ||
                /<\/title\s*>/i.test(html)
              : /<\/title\s*>/i.test(html);
            if (complete) {
              resolve({ status, headers: response.headers, body });
              response.destroy();
            }
          }
        }
      });
      response.on("end", () => {
        resolve({ status, headers: response.headers, body: Buffer.concat(chunks) });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchTitleFrom(url, format, signal) {
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (signal?.aborted) return undefined;
    const page = await getPage(url, format, signal);
    if (page.status >= 300 && page.status < 400 && page.headers.location) {
      url = new URL(page.headers.location, url);
      continue;
    }
    if (page.status !== 200 || !page.body.length) return undefined;
    const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(page.headers["content-type"] ?? "")?.[1] ?? "utf-8";
    try {
      const body = new TextDecoder(charset).decode(page.body);
      return format === "html" ? extractTitle(body, prefersOpenGraph(url.hostname)) : extractOEmbedTitle(body);
    } catch {
      const body = new TextDecoder().decode(page.body);
      return format === "html" ? extractTitle(body, prefersOpenGraph(url.hostname)) : extractOEmbedTitle(body);
    }
  }
  return undefined;
}

async function fetchTitle(address, signal) {
  const url = new URL(address);
  const reddit = redditOEmbedUrl(url);
  const oembed = reddit || youtubeOEmbedUrl(url);
  if (oembed) {
    try {
      const title = await fetchTitleFrom(oembed, "json", signal);
      if (title) return title;
    } catch {
      // Jos oEmbed ei ole saatavilla, yritetään lukea HTML:n alkua.
    }
  }
  const title = await fetchTitleFrom(url, "html", signal);
  // Redditin JavaScript-haasteen yleinen otsikko ei kerro julkaisusta mitään.
  if (reddit && /^(?:welcome to )?reddit(?:\s*[-–—:]\s*dive into anything)?$/i.test(title ?? "")) {
    return undefined;
  }
  if ((isInstagramHost(url.hostname) && title?.toLowerCase() === "instagram") ||
      (isFacebookHost(url.hostname) && title?.toLowerCase() === "facebook")) {
    return undefined;
  }
  return title;
}

module.exports = {
  async onMessage({ message, signal }) {
    const url = firstUrl(message);
    if (!url) return;
    const title = await module.exports.fetchTitle(url, signal);
    return title ? `Otsikko: ${title}` : undefined;
  },
  firstUrl,
  fetchTitle,
  extractTitle,
  youtubeOEmbedUrl,
  redditOEmbedUrl,
  extractOEmbedTitle,
  isPublicAddress,
  pinnedLookup,
};
