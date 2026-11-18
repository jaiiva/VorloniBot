import { Client } from "irc-framework";
import { loadConfig } from "./config";
import { PluginManager } from "./plugins";
import type { OperatorIdentity } from "./plugins";

function main(): void {
  const config = loadConfig();
  const client = new Client();
  const plugins = new PluginManager("plugins");
  let reconnectTimer: NodeJS.Timeout | undefined;
  let stopping = false;
  let activeMessages = 0;
  let connectionGeneration = 0;
  type Member = OperatorIdentity & { op: boolean };
  const members = new Map<string, Map<string, Member>>();
  const ready = new Set<string>();
  const pending = new Map<string, Array<() => void>>();
  const pendingJoins = new Map<string, OperatorIdentity[]>();
  const key = (value: string) => client.caseLower(value);
  const configuredChannel = (value: string) =>
    config.channels.find((channel) => client.caseCompare(channel, value));

  function offerOp(member: Member): void {
    const users = members.get(key(member.channel));
    if (ready.has(key(member.channel)) && !member.op &&
        !client.caseCompare(member.nick, client.user.nick) &&
        users?.get(key(client.user.nick))?.op && plugins.shouldOp(member) &&
        users.get(key(member.nick)) === member && users.get(key(client.user.nick))?.op) {
      client.mode(member.channel, "+o", member.nick);
    }
  }

  function joined(member: Member): void {
    members.get(key(member.channel))?.set(key(member.nick), member);
    offerOp(member);
  }

  function apply(channel: string, change: () => void): void {
    const queue = pending.get(key(channel));
    if (queue) queue.push(change);
    else change();
  }

  client.on("join", (event) => {
    const channel = configuredChannel(event.channel);
    if (!channel || stopping) return;
    const id = key(channel);
    if (client.caseCompare(event.nick, client.user.nick)) {
      members.set(id, new Map());
      ready.delete(id);
      pending.set(id, []);
      pendingJoins.set(id, []);
      const generation = connectionGeneration;
      client.who(channel, ({ users }) => {
        if (stopping || generation !== connectionGeneration || !pending.has(id)) return;
        const current = new Map<string, Member>();
        for (const user of users) {
          current.set(key(user.nick), {
            channel, nick: user.nick, ident: user.ident, hostname: user.hostname,
            op: user.channel_modes?.includes("o") ?? false,
          });
        }
        members.set(id, current);
        const changes = pending.get(id)!;
        pending.delete(id);
        // Jonossa olevat JOIN/MODE/PART-tapahtumat voivat olla WHO-vastausta tuoreempia.
        for (const change of changes) change();
        plugins.recordOperators([...current.values()].filter((user) => user.op));
        ready.add(id);
        for (const join of pendingJoins.get(id) ?? []) {
          const user = current.get(key(join.nick));
          if (user && user.ident === join.ident && user.hostname === join.hostname) offerOp(user);
        }
        pendingJoins.delete(id);
      });
      return;
    }
    if (pending.has(id)) pendingJoins.get(id)?.push(event);
    apply(channel, () => joined({ channel, nick: event.nick, ident: event.ident,
      hostname: event.hostname, op: false }));
  });

  client.on("mode", (event) => {
    const channel = configuredChannel(event.target);
    if (!channel || !members.has(key(channel))) return;
    for (const mode of event.modes) {
      if ((mode.mode !== "+o" && mode.mode !== "-o") || !mode.param) continue;
      apply(channel, () => {
        const user = members.get(key(channel))?.get(key(mode.param!));
        if (!user) return;
        user.op = mode.mode === "+o";
        if (user.op && ready.has(key(channel))) plugins.recordOperator(user);
      });
    }
  });

  client.on("part", (event) => {
    const channel = configuredChannel(event.channel);
    if (!channel) return;
    apply(channel, () => members.get(key(channel))?.delete(key(event.nick)));
    if (client.caseCompare(event.nick, client.user.nick)) {
      members.delete(key(channel)); pending.delete(key(channel)); pendingJoins.delete(key(channel));
      ready.delete(key(channel));
    }
  });
  client.on("kick", (event) => {
    const channel = configuredChannel(event.channel);
    if (!channel) return;
    apply(channel, () => members.get(key(channel))?.delete(key(event.kicked)));
    if (client.caseCompare(event.kicked, client.user.nick)) {
      members.delete(key(channel)); pending.delete(key(channel)); pendingJoins.delete(key(channel));
      ready.delete(key(channel));
    }
  });
  client.on("quit", (event) => {
    for (const channel of config.channels) {
      apply(channel, () => members.get(key(channel))?.delete(key(event.nick)));
    }
  });
  client.on("nick", (event) => {
    for (const channel of config.channels) {
      apply(channel, () => {
        const users = members.get(key(channel));
        const user = users?.get(key(event.nick));
        if (!user) return;
        users!.delete(key(event.nick));
        user.nick = event.new_nick;
        users!.set(key(user.nick), user);
      });
    }
  });

  client.on("registered", () => {
    console.log(`Connected to ${config.server.host}.`);
    for (const channel of config.channels) {
      client.join(channel);
      console.log(`Joining channel ${channel}.`);
    }
  });

  client.on("socket error", (error) => {
    console.error(`IRC connection error: ${error.message}`);
  });

  client.on("nick in use", (event) => {
    console.error(`Nickname ${event.nick} is already in use. Check that another bot instance is not running.`);
    client.quit("Trying to reconnect");
  });

  client.on("privmsg", (event) => {
    if (stopping || client.caseCompare(event.nick, client.user.nick) ||
        !config.channels.some((channel) => client.caseCompare(event.target, channel))) {
      return;
    }
    if (activeMessages >= 3) return;
    const generation = connectionGeneration;
    activeMessages++;
    void plugins.dispatch({
      message: event.message,
      nick: event.nick,
      channel: event.target,
    }).then((reply) => {
      if (reply && !stopping && client.connected && generation === connectionGeneration) {
        client.say(event.target, reply);
      }
    }).finally(() => { activeMessages--; });
  });

  client.on("close", () => {
    if (stopping) return;
    connectionGeneration++;
    members.clear(); ready.clear(); pending.clear(); pendingJoins.clear();
    console.error("Connection lost. Reconnecting in 5 seconds.");
    reconnectTimer = setTimeout(connect, 5000);
  });

  function connect(): void {
    reconnectTimer = undefined;
    console.log(`Connecting to ${config.server.host}:${config.server.port}...`);
    client.connect({
      host: config.server.host,
      port: config.server.port,
      tls: config.server.tls,
      nick: config.nickname,
      auto_reconnect: false,
    });
  }

  function stop(): void {
    if (stopping) return;
    stopping = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    plugins.close();
    console.log("Closing IRC connection...");
    client.quit("Bot shutting down");
    // Jos palvelin ei sulje yhteyttä, prosessi ei saa jäädä roikkumaan.
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  connect();
}

try {
  main();
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
