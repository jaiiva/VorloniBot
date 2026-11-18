"use strict";

const { load } = require("cheerio");

const URL = "https://mummila.net/varasto/vekottimet/combogen/haddock.cgi";
const MAX_BYTES = 64 * 1024;

module.exports = {
  command: "!haddock",
  async execute({ signal }) {
    const response = await fetch(URL, {
      signal,
      redirect: "error",
      headers: {
        Accept: "text/html",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) throw new Error(`Haddock-sivu vastasi ${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new Error("Haddock-sivu ei palauttanut HTML:ää.");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Haddock-sivun sisältö puuttuu.");
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
        if (size > MAX_BYTES) throw new Error("Haddock-sivu on liian suuri.");
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }

    const insult = load(html)("h1.generoitu").first().text().trim();
    if (!insult) throw new Error("Generoitua tekstiä ei löytynyt Haddock-sivulta.");
    return insult;
  },
};
