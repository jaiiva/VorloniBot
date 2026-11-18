import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "./config";

const valid = {
  nickname: "VorloniBot",
  server: { host: "irc.example.net" },
  channels: ["#testi", "#toinen"],
};

test("oletusasetuksina TLS ja portti 6697", () => {
  assert.deepEqual(parseConfig(valid), {
    ...valid,
    server: { host: "irc.example.net", port: 6697, tls: true },
  });
});

test("portin ja TLS:n voi muuttaa", () => {
  assert.deepEqual(parseConfig({
    ...valid,
    server: { host: "localhost", port: 6667, tls: false },
  }).server, { host: "localhost", port: 6667, tls: false });
});

test("virheelliset asetukset hylätään", () => {
  for (const config of [
    {},
    { ...valid, nickname: "bad nick" },
    { ...valid, server: { host: "" } },
    { ...valid, server: { host: "localhost", port: 0 } },
    { ...valid, server: { host: "localhost", tls: "false" } },
    { ...valid, channels: [] },
    { ...valid, channels: ["testi"] },
  ]) {
    assert.throws(() => parseConfig(config));
  }
});
