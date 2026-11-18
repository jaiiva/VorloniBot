import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

interface MetaforaPlugin {
  command: string;
  execute(context: { signal: AbortSignal }): Promise<string>;
}

const metafora = require(resolve(__dirname, "../plugins/metafora.cjs")) as MetaforaPlugin;

test("metaforaplugin poimii uuden vertauksen sivulta", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://mummila.net/varasto/vekottimet/combogen/mf_gen.cgi");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response('<h1>Väärä otsikko</h1><h1 class="generoitu">"viekas kuin morsian &amp; kettu"</h1>', {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  try {
    assert.equal(metafora.command, "!metafora");
    assert.equal(await metafora.execute({ signal: AbortSignal.timeout(2000) }),
      '"viekas kuin morsian & kettu"');
    await metafora.execute({ signal: AbortSignal.timeout(2000) });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("puuttuva vertaus tuottaa virheen", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<h1>Väärä otsikko</h1>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  try {
    await assert.rejects(metafora.execute({ signal: AbortSignal.timeout(2000) }), /ei löytynyt/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
