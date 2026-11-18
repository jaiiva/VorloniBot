import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface BotConfig {
  nickname: string;
  server: {
    host: string;
    port: number;
    tls: boolean;
  };
  channels: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(value: unknown): BotConfig {
  if (!isObject(value)) {
    throw new Error("Configuration must be a JSON object.");
  }
  if (typeof value.nickname !== "string" || !/^[A-Za-z_\[\]\\`^{}|][A-Za-z0-9_\-\[\]\\`^{}|]*$/.test(value.nickname)) {
    throw new Error("nickname is missing or is not a valid IRC nickname.");
  }
  if (!isObject(value.server)) {
    throw new Error("server is missing or is not an object.");
  }
  const server = value.server;
  if (typeof server.host !== "string" || !server.host.trim() || /\s/.test(server.host)) {
    throw new Error("server.host is missing or is not a valid hostname.");
  }
  if (server.port !== undefined && (!Number.isInteger(server.port) || (server.port as number) < 1 || (server.port as number) > 65535)) {
    throw new Error("server.port must be an integer between 1 and 65535.");
  }
  if (server.tls !== undefined && typeof server.tls !== "boolean") {
    throw new Error("server.tls must be true or false.");
  }
  if (!Array.isArray(value.channels) || value.channels.length === 0 ||
      !value.channels.every((channel: unknown) => typeof channel === "string" && /^[#&][^\s,\x00-\x1f:]+$/.test(channel))) {
    throw new Error("channels must be a non-empty list of channels (e.g. #example).");
  }

  return {
    nickname: value.nickname,
    server: {
      host: server.host,
      port: server.port as number | undefined ?? 6697,
      tls: server.tls as boolean | undefined ?? true,
    },
    channels: value.channels,
  };
}

export function loadConfig(path = resolve(process.cwd(), "config.json")): BotConfig {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read configuration file (${path}): ${String(error)}`);
  }
  try {
    return parseConfig(JSON.parse(content) as unknown);
  } catch (error) {
    throw new Error(`Invalid configuration in ${path}: ${String(error)}`);
  }
}
