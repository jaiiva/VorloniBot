import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

test("otsikkoplugin reagoi URL-viestiin ilman komentoa", async () => {
  const plugin = require(resolve(__dirname, "../plugins/title.cjs")) as {
    onMessage(context: { message: string; signal: AbortSignal }): Promise<string | undefined>;
    fetchTitle(url: string, signal?: AbortSignal): Promise<string | undefined>;
  };
  const originalFetchTitle = plugin.fetchTitle;
  let requestedUrl: string | undefined;
  let receivedSignal: AbortSignal | undefined;
  plugin.fetchTitle = async (url, signal) => {
    requestedUrl = url;
    receivedSignal = signal;
    return "Testisivun otsikko";
  };
  try {
    const signal = AbortSignal.timeout(2000);
    assert.equal(await plugin.onMessage({ message: "Katso https://example.com/!", signal }),
      "Otsikko: Testisivun otsikko");
    assert.equal(requestedUrl, "https://example.com/");
    assert.equal(receivedSignal, signal);
    assert.equal(await plugin.onMessage({ message: "Ei linkkiä", signal }), undefined);
  } finally {
    plugin.fetchTitle = originalFetchTitle;
  }
});
