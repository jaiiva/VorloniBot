"use strict";

const { load } = require("cheerio");

const URL = "https://mummila.net/varasto/vekottimet/combogen/mf_gen.cgi";
const MAX_BYTES = 64 * 1024;

module.exports = {
  command: "!metafora",
  async execute({ signal }) {
    const response = await fetch(URL, {
      signal,
      redirect: "error",
      headers: {
        Accept: "text/html",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) throw new Error(`Metaforasivu vastasi ${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new Error("Metaforasivu ei palauttanut HTML:ää.");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Metaforasivun sisältö puuttuu.");
    const decoder = new TextDecoder();
    let html = "";
    let size = 0;
    let complete = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          complete = true;
          break;
        }
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Metaforasivu on liian suuri.");
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }

    const metaphor = load(html)("h1.generoitu").first().text().trim();
    if (!metaphor) throw new Error("Generoitua tekstiä ei löytynyt metaforasivulta.");
    return metaphor;
  },
};
