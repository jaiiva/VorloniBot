import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatReply, parseCommand, PluginManager } from "./plugins";

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail("Plugin-muutos ei tullut voimaan.");
}

test("komennon tunnistus ja vastauksen siistiminen", () => {
  assert.deepEqual(parseCommand("!SÄÄ   huomenna"), { command: "!sää", args: "huomenna" });
  assert.equal(parseCommand("hei !sää"), undefined);
  assert.equal(formatReply("testi\r\nPRIVMSG #kanava :x"), "testi PRIVMSG #kanava :x");
  assert.ok(Buffer.byteLength(formatReply("ä".repeat(300)), "utf8") <= 300);
});

test("plugineja voi lisätä, muuttaa ja poistaa käynnissä", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "vorloni-plugins-"));
  const manager = new PluginManager(directory);
  const file = join(directory, "hello.cjs");
  const context = { command: "!hei", args: "", nick: "Testaaja", channel: "#testi" };
  try {
    writeFileSync(file, 'module.exports = { command: "!hei", execute: () => "Hei!" };');
    await waitFor(() => manager.has("!hei"));
    assert.equal(await manager.run(context), "Hei!");

    const temporary = join(directory, "hello.tmp");
    writeFileSync(temporary, 'module.exports = { command: "!hei", execute: () => "Moikka!" };');
    renameSync(temporary, file);
    await waitFor(async () => (await manager.run(context)) === "Moikka!");
    assert.equal(await manager.run(context), "Moikka!");

    writeFileSync(file, "module.exports = {");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await manager.run(context), "Moikka!");

    rmSync(file);
    await waitFor(() => !manager.has("!hei"));
    assert.equal(await manager.run(context), undefined);
  } finally {
    manager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("viestiplugin käsittelee tavallisen viestin ja päivittyy lennosta", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "vorloni-messages-"));
  const manager = new PluginManager(directory);
  const file = join(directory, "automatic.cjs");
  const context = { message: "ping", nick: "Testaaja", channel: "#testi" };
  try {
    assert.equal(await manager.dispatch(context), undefined);
    writeFileSync(file,
      'module.exports = { onMessage: ({ message }) => message === "ping" ? "pong" : undefined };');
    await waitFor(async () => (await manager.dispatch(context)) === "pong");
    assert.equal(await manager.dispatch({ ...context, message: "hei" }), undefined);

    writeFileSync(file,
      'module.exports = { onMessage: ({ message }) => message === "ping" ? "uusi pong" : undefined };');
    await waitFor(async () => (await manager.dispatch(context)) === "uusi pong");

    writeFileSync(file, "module.exports = {");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await manager.dispatch(context), "uusi pong");

    rmSync(file);
    await waitFor(async () => (await manager.dispatch(context)) === undefined);
  } finally {
    manager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tunnistettu komento käsitellään ennen viestiplugineja", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vorloni-priority-"));
  writeFileSync(join(directory, "automatic.cjs"),
    'module.exports = { onMessage: () => "automaattinen" };');
  writeFileSync(join(directory, "command.cjs"),
    'module.exports = { command: "!hei", execute: () => "komento" };');
  const manager = new PluginManager(directory);
  try {
    assert.equal(await manager.dispatch({ message: "!hei", nick: "x", channel: "#testi" }), "komento");
    assert.equal(await manager.dispatch({ message: "jotain muuta", nick: "x", channel: "#testi" }),
      "automaattinen");
  } finally {
    manager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("komentopluginin virheestä vastataan englanniksi", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vorloni-error-reply-"));
  writeFileSync(join(directory, "failing.cjs"),
    'module.exports = { command: "!fail", execute: () => { throw new Error("test"); } };');
  const manager = new PluginManager(directory);
  try {
    assert.equal(await manager.run({ command: "!fail", args: "", nick: "Tester", channel: "#test" }),
      "Command failed.");
  } finally {
    manager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
