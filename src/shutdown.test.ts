import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("sammutussignaali lähettää QUIT-viestin ja lopettaa botin", { timeout: 7000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "vorloni-shutdown-"));
  let joined!: () => void;
  const joinedPromise = new Promise<void>((resolve) => { joined = resolve; });
  let replied!: () => void;
  const replyPromise = new Promise<void>((resolve) => { replied = resolve; });
  let autoReplied!: () => void;
  const autoReplyPromise = new Promise<void>((resolve) => { autoReplied = resolve; });
  let quit!: (line: string) => void;
  const quitPromise = new Promise<string>((resolve) => { quit = resolve; });
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line === "CAP LS 302") socket.write(":test CAP VorloniBot LS :\r\n");
        if (line === "CAP END") socket.write(":test 001 VorloniBot :Welcome\r\n");
        if (line === "JOIN #testi") {
          joined();
          socket.write(":Testaaja!user@host PRIVMSG #testi :!hei\r\n");
        }
        if (line === "PRIVMSG #testi :Hei Testaaja!") {
          replied();
          socket.write(":Testaaja!user@host PRIVMSG #testi :Katso https://example.test/\r\n");
        }
        if (line === "PRIVMSG #testi :Otsikko: Esimerkkisivu") autoReplied();
        if (line.startsWith("QUIT")) {
          quit(line);
          socket.end();
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testipalvelimen porttia ei löytynyt.");
  writeFileSync(join(directory, "config.json"), JSON.stringify({
    nickname: "VorloniBot",
    server: { host: "127.0.0.1", port: address.port, tls: false },
    channels: ["#testi"],
  }));
  mkdirSync(join(directory, "plugins"));
  writeFileSync(join(directory, "plugins", "hello.cjs"),
    'module.exports = { command: "!hei", execute: ({ nick }) => `Hei ${nick}!` };');
  writeFileSync(join(directory, "plugins", "title.cjs"),
    'module.exports = { onMessage: ({ message }) => message.includes("https://example.test/") ? "Otsikko: Esimerkkisivu" : undefined };');

  const bot = spawn(process.execPath, [join(__dirname, "index.js")], {
    cwd: directory,
    stdio: "ignore",
  });
  const exitPromise = new Promise<number | null>((resolve) => bot.once("exit", resolve));
  try {
    await joinedPromise;
    await replyPromise;
    await autoReplyPromise;
    bot.kill("SIGTERM");
    assert.match(await quitPromise, /^QUIT :?Bot shutting down$/);
    assert.equal(await exitPromise, 0);
  } finally {
    bot.kill("SIGKILL");
    for (const socket of sockets) socket.destroy();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
