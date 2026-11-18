"use strict";

const { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const FILE = join(process.cwd(), "data", "op-masks.json");

// IRC:n RFC1459-kirjainvertailu (myös hakasulut ja aaltosulut vastaavat toisiaan).
function lower(value) {
  return value.toLowerCase().replace(/\[/g, "{").replace(/\]/g, "}")
    .replace(/\\/g, "|").replace(/\^/g, "~");
}

function readMasks() {
  if (!existsSync(FILE)) return {};
  const data = JSON.parse(readFileSync(FILE, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.values(data).some((masks) => !Array.isArray(masks) ||
        masks.some((mask) => typeof mask !== "string"))) {
    throw new Error("Operator mask file is invalid.");
  }
  return data;
}

function saveMasks(data) {
  mkdirSync(dirname(FILE), { recursive: true });
  const temporary = `${FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, FILE);
}

function channelMasks(data, channel) {
  const name = Object.keys(data).find((item) => lower(item) === lower(channel));
  return name ? data[name] : (data[channel] = []);
}

function maskFor(user) {
  if (!user.nick || !user.ident || !user.hostname ||
      /[\s!*?@]/.test(user.nick) || /[\s!@]/.test(user.ident) ||
      /[\s!@]/.test(user.hostname)) return undefined;
  return `${user.nick}!${user.ident}@${user.hostname}`;
}

function matches(pattern, user) {
  const separator = pattern.indexOf("!");
  const at = pattern.indexOf("@", separator + 1);
  if (separator < 1 || at <= separator + 1 || at === pattern.length - 1 ||
      /[*?]/.test(pattern.slice(0, separator))) return false;
  if (lower(pattern.slice(0, separator)) !== lower(user.nick)) return false;
  const value = `${user.ident}@${user.hostname}`;
  const glob = pattern.slice(separator + 1);
  const escaped = lower(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "u").test(lower(value));
}

function record(users) {
  const data = readMasks();
  let changed = false;
  for (const user of users) {
    const exact = maskFor(user);
    if (!exact) continue;
    const masks = channelMasks(data, user.channel);
    if (!masks.some((pattern) => matches(pattern, user))) {
      masks.push(exact);
      changed = true;
    }
  }
  if (changed || !existsSync(FILE)) saveMasks(data);
}

module.exports = {
  onOperators: record,
  onOperator(user) { record([user]); },
  onJoin(user) {
    // Luetaan aina uudestaan: käsin tehdyt wildcard-muutokset tulevat heti voimaan.
    if (!maskFor(user)) return false;
    const data = readMasks();
    const masks = Object.entries(data).find(([channel]) => lower(channel) === lower(user.channel))?.[1];
    return Array.isArray(masks) && masks.some((pattern) => matches(pattern, user));
  },
};
