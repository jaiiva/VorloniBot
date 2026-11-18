import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

interface HaddockPlugin {
  command: string;
  execute(context: { signal: AbortSignal }): Promise<string>;
}

const haddock = require(resolve(__dirname, "../plugins/haddock.cjs")) as HaddockPlugin;

test("Haddock-plugin poimii generoidun tekstin HTML:stä", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://mummila.net/varasto/vekottimet/combogen/haddock.cgi");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(
      `<h1>Väärä otsikko</h1><h1 class="generoitu">Viheliäinen pässinpää &amp; markkinakaappari!</h1>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };
  try {
    assert.equal(haddock.command, "!haddock");
    assert.equal(await haddock.execute({ signal: AbortSignal.timeout(2000) }),
      "Viheliäinen pässinpää & markkinakaappari!");
    await haddock.execute({ signal: AbortSignal.timeout(2000) });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("puuttuva generoitu teksti tuottaa virheen", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<h1>Muu otsikko</h1>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  try {
    await assert.rejects(haddock.execute({ signal: AbortSignal.timeout(2000) }), /ei löytynyt/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
