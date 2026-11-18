import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { test } from "node:test";
import {
  extractOEmbedTitle, extractTitle, fetchTitle, firstUrl, isPublicAddress, pinnedLookup, redditOEmbedUrl,
  youtubeOEmbedUrl,
} from "./url-preview";

test("etsii ensimmäisen linkin viestistä", () => {
  assert.equal(firstUrl("Katso (https://example.com/testi), kiitos!"), "https://example.com/testi");
  assert.equal(firstUrl("http://example.com/ https://example.org/"), "http://example.com/");
  assert.equal(firstUrl("ei linkkiä"), undefined);
});

test("poimii HTML-otsikon ja purkaa entiteetit", () => {
  assert.equal(extractTitle("<html><head><title> Hei &amp; tervetuloa\n taas </title></head></html>"),
    "Hei & tervetuloa taas");
  assert.equal(extractTitle("<title>Otsikko\u0001\r\n sisältö</title>"), "Otsikko sisältö");
  assert.equal(extractTitle("<html><body>Ei otsikkoa</body></html>"), undefined);
});

test("Facebookin og:title menee yleisen title-tagin edelle", () => {
  const html = `<head><meta property="og:title" content="23K views &#xb7; Video &amp; musiikki" />
    <meta property="og:description" content="Videon kuvaus" /><title>Facebook</title></head>`;
  assert.equal(extractTitle(html, true), "23K views · Video & musiikki");
  assert.equal(extractTitle(html), "Facebook");
  assert.equal(extractTitle(
    '<meta property="og:description" content="Videon kuvaus" /><title>Facebook</title>', true
  ), "Videon kuvaus");
  assert.equal(extractTitle(
    `<meta property="og:title" content="23K views · 69K reactions | Video &amp; musiikki

Katso myös muita videoita" /><title>Facebook</title>`, true
  ), "Video & musiikki");
});

test("Instagramin og:title menee yleisen title-tagin edelle", () => {
  assert.equal(extractTitle(
    '<meta property="og:title" content="Mikael Kosola on Instagram: &quot;#Muna&quot;" /><title>Instagram</title>',
    true
  ), 'Mikael Kosola on Instagram: "#Muna"');
  assert.equal(extractTitle(
    '<meta property="og:description" content="#Muna - @niilo222" /><title>Instagram</title>', true
  ), "#Muna - @niilo222");
});

test("YouTube-linkistä rakennetaan videokohtainen oEmbed-pyyntö", () => {
  const endpoint = youtubeOEmbedUrl(new URL(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"
  ));
  assert.equal(endpoint?.hostname, "www.youtube.com");
  assert.equal(endpoint?.pathname, "/oembed");
  assert.equal(endpoint?.searchParams.get("url"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(youtubeOEmbedUrl(new URL("https://youtu.be/dQw4w9WgXcQ"))?.searchParams.get("format"), "json");
  assert.equal(youtubeOEmbedUrl(new URL("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")), undefined);
  assert.equal(extractOEmbedTitle('{"title":"Video \\u0026 musiikki","author_name":"Test"}'), "Video & musiikki");
});

test("Reddit-julkaisulle rakennetaan oEmbed-pyyntö ilman ylimääräisiä parametreja", () => {
  const endpoint = redditOEmbedUrl(new URL(
    "https://www.reddit.com/r/youtube/comments/1ri5s41/is_there_a_way_to_turn_off_most_relevant_in/?utm_source=share"
  ));
  assert.equal(endpoint?.pathname, "/oembed");
  assert.equal(endpoint?.searchParams.get("url"),
    "https://www.reddit.com/r/youtube/comments/1ri5s41/is_there_a_way_to_turn_off_most_relevant_in/");
  assert.equal(extractOEmbedTitle('{"title":"Is there a way to turn off most relevant in subscriptions?"}'),
    "Is there a way to turn off most relevant in subscriptions?");
  assert.equal(redditOEmbedUrl(new URL("https://reddit.com.evil.test/r/youtube/comments/1ri5s41/")),
    undefined);
  assert.equal(redditOEmbedUrl(new URL("https://www.reddit.com/r/youtube/")), undefined);
});

test("paikallisen sivun otsikkoa ei haeta", async () => {
  await assert.rejects(fetchTitle("http://127.0.0.1/"), /Paikallisiin/);
});

test("kiinnitetty DNS-vastaus toimii Node.js:n HTTP-yhteydessä", async () => {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Testipalvelimen porttia ei löytynyt.");
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(`http://example.invalid:${address.port}/`, {
        lookup: pinnedLookup("127.0.0.1", 4),
        signal: AbortSignal.timeout(2000),
      }, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { data += chunk; });
        response.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(body, "ok");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("vain julkiset IP-osoitteet hyväksytään", () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});
