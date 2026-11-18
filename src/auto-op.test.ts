import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("IRC-tapahtumaa ei saatu ajoissa.");
}

test("operaattorit kerätään WHOsta ja hyväksytty maski antaa opit liittyessä", { timeout: 7000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "vorloni-auto-op-"));
  const sockets = new Set<Socket>();
  const lines: string[] = [];
  let peer: Socket | undefined;
  const server = createServer((socket) => {
    peer = socket;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        lines.push(line);
        if (line === "CAP LS 302") socket.write(":test CAP VorloniBot LS :\r\n");
        if (line === "CAP END") socket.write(":test 001 VorloniBot :Welcome\r\n");
        if (line === "JOIN #testi") socket.write(":VorloniBot!bot@bot.example JOIN #testi\r\n");
        if (line === "WHO #testi") {
          socket.write(":test 352 VorloniBot #testi bot bot.example test VorloniBot H@ :0 Bot\r\n");
          socket.write(":test 352 VorloniBot #testi uid668184 id-668184.hampstead.irccloud.com test Alice H@ :0 Alice\r\n");
          socket.write(":test 315 VorloniBot #testi :End of WHO list\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Portti puuttuu");
  mkdirSync(join(directory, "plugins"));
  copyFileSync(resolve(__dirname, "../plugins/auto-op.cjs"), join(directory, "plugins", "auto-op.cjs"));
  mkdirSync(join(directory, "data"));
  writeFileSync(join(directory, "data", "op-masks.json"),
    JSON.stringify({ "#testi": ["Old!ident@old.example"] }));
  writeFileSync(join(directory, "config.json"), JSON.stringify({
    nickname: "VorloniBot", server: { host: "127.0.0.1", port: address.port, tls: false },
    channels: ["#testi"],
  }));
  const bot = spawn(process.execPath, [join(__dirname, "index.js")], {
    cwd: directory, stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  bot.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  try {
    const file = join(directory, "data", "op-masks.json");
    await until(() => {
      try {
        return JSON.parse(readFileSync(file, "utf8"))["#testi"]?.length === 3;
      } catch { return false; }
    });
    const masks = JSON.parse(readFileSync(file, "utf8")) as Record<string, string[]>;
    assert.ok(masks["#testi"].includes("Alice!uid668184@id-668184.hampstead.irccloud.com"));
    assert.ok(masks["#testi"].includes("Old!ident@old.example"));
    masks["#testi"] = masks["#testi"].map((mask) => mask.startsWith("Alice!")
      ? "Alice!uid*@*.hampstead.irccloud.com" : mask);
    writeFileSync(file, JSON.stringify(masks));
    peer!.write(":Alice!uid668184@id-668184.hampstead.irccloud.com PART #testi\r\n");
    peer!.write(":Alice!uid999999@id-999999.hampstead.irccloud.com JOIN #testi\r\n");
    await until(() => lines.includes("MODE #testi +o Alice"));
    assert.ok((JSON.parse(readFileSync(file, "utf8")) as Record<string, string[]>)["#testi"]
      .includes("Alice!uid*@*.hampstead.irccloud.com"));

    peer!.write(":Charlie!uid123@new.example JOIN #testi\r\n");
    peer!.write(":Alice!uid999999@id-999999.hampstead.irccloud.com MODE #testi +o Charlie\r\n");
    await until(() => (JSON.parse(readFileSync(file, "utf8")) as Record<string, string[]>)["#testi"]
      .includes("Charlie!uid123@new.example"));
    const granted = lines.filter((line) => line === "MODE #testi +o Alice").length;
    peer!.write(":Alice!uid999999@id-999999.hampstead.irccloud.com MODE #testi -o VorloniBot\r\n");
    peer!.write(":Alice!uid999999@id-999999.hampstead.irccloud.com PART #testi\r\n");
    peer!.write(":Alice!uid888888@id-888888.hampstead.irccloud.com JOIN #testi\r\n");
    peer!.write("PING :barrier\r\n");
    await until(() => lines.some((line) => /^PONG :?barrier$/.test(line)));
    assert.equal(lines.filter((line) => line === "MODE #testi +o Alice").length, granted);
    assert.equal(errors, "");
  } finally {
    bot.kill("SIGKILL");
    for (const socket of sockets) socket.destroy();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
