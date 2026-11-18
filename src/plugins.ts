import { existsSync, mkdirSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";

export interface CommandContext {
  command: string;
  args: string;
  nick: string;
  channel: string;
  signal: AbortSignal;
}

export interface MessageContext {
  message: string;
  nick: string;
  channel: string;
  signal: AbortSignal;
}

export interface OperatorIdentity {
  channel: string;
  nick: string;
  ident: string;
  hostname: string;
}

interface Plugin {
  command?: string;
  execute?(context: CommandContext): Promise<string | undefined> | string | undefined;
  onMessage?(context: MessageContext): Promise<string | undefined> | string | undefined;
  onOperators?(users: OperatorIdentity[]): void;
  onOperator?(user: OperatorIdentity): void;
  onJoin?(user: OperatorIdentity): boolean;
}

const COMMAND_PATTERN = /^![^\s\x00-\x1f]+$/u;

function isPlugin(value: unknown): value is Plugin {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Plugin>;
  const hasCommand = candidate.command !== undefined || candidate.execute !== undefined;
  const hasMessage = candidate.onMessage !== undefined;
  const hasOperator = candidate.onOperators !== undefined || candidate.onOperator !== undefined ||
    candidate.onJoin !== undefined;
  return (hasCommand || hasMessage || hasOperator) &&
    (!hasCommand || (typeof candidate.command === "string" && COMMAND_PATTERN.test(candidate.command) &&
      typeof candidate.execute === "function")) &&
    (!hasMessage || typeof candidate.onMessage === "function") &&
    (candidate.onOperators === undefined || typeof candidate.onOperators === "function") &&
    (candidate.onOperator === undefined || typeof candidate.onOperator === "function") &&
    (candidate.onJoin === undefined || typeof candidate.onJoin === "function");
}

export function parseCommand(message: string): { command: string; args: string } | undefined {
  const match = /^(![^\s]+)(?:\s+([\s\S]*))?$/u.exec(message.trim());
  return match && COMMAND_PATTERN.test(match[1])
    ? { command: match[1].toLocaleLowerCase("fi"), args: (match[2] ?? "").trim() }
    : undefined;
}

export function formatReply(text: string): string {
  let reply = "";
  const cleaned = text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
  for (const character of cleaned) {
    if (Buffer.byteLength(reply + character, "utf8") > 300) break;
    reply += character;
  }
  return reply;
}

export class PluginManager {
  private readonly files = new Map<string, Plugin>();
  private readonly commands = new Map<string, Plugin>();
  private readonly messagePlugins: Array<{ name: string; plugin: Plugin }> = [];
  private watcher: FSWatcher;
  private debounce?: NodeJS.Timeout;

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.reload();
    // Hakemiston seuranta huomaa myös uudet tiedostot ja atomiset korvaukset.
    this.watcher = watch(directory, () => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        try {
          this.reload();
        } catch (error) {
          console.error(`Could not read plugin directory: ${error}`);
        }
      }, 150);
    });
    this.watcher.on("error", (error) => console.error(`Plugin directory watcher failed: ${error}`));
  }

  reload(): void {
    const names = readdirSync(this.directory).filter((name) => name.endsWith(".cjs")).sort();
    for (const name of this.files.keys()) {
      if (!names.includes(name)) this.files.delete(name);
    }
    for (const name of names) {
      const path = resolve(this.directory, name);
      try {
        if (!existsSync(path)) continue;
        const modulePath = require.resolve(path);
        delete require.cache[modulePath];
        const plugin: unknown = require(modulePath);
        if (!isPlugin(plugin)) {
          throw new Error("Plugin must define command + execute, onMessage, or an operator event handler.");
        }
        this.files.set(name, plugin);
      } catch (error) {
        // Säilytetään edellinen toimiva versio virheellisen päivityksen yli.
        console.error(`Failed to load plugin ${name}: ${error}`);
      }
    }
    this.commands.clear();
    this.messagePlugins.length = 0;
    for (const name of names) {
      const plugin = this.files.get(name);
      if (!plugin) continue;
      if (plugin.command) {
        const command = plugin.command.toLocaleLowerCase("fi");
        if (this.commands.has(command)) {
          console.error(`Command ${command} from plugin ${name} is already in use.`);
        } else {
          this.commands.set(command, plugin);
        }
      }
      if (plugin.onMessage) this.messagePlugins.push({ name, plugin });
    }
  }

  has(command: string): boolean {
    return this.commands.has(command.toLocaleLowerCase("fi"));
  }

  recordOperators(users: OperatorIdentity[]): void {
    for (const plugin of this.files.values()) {
      try {
        plugin.onOperators?.(users);
      } catch (error) {
        console.error(`Failed to save channel operators: ${error}`);
      }
    }
  }

  recordOperator(user: OperatorIdentity): void {
    for (const plugin of this.files.values()) {
      try {
        plugin.onOperator?.(user);
      } catch (error) {
        console.error(`Failed to save channel operator: ${error}`);
      }
    }
  }

  shouldOp(user: OperatorIdentity): boolean {
    for (const plugin of this.files.values()) {
      try {
        if (plugin.onJoin?.(user) === true) return true;
      } catch (error) {
        console.error(`Failed to check operator mask: ${error}`);
      }
    }
    return false;
  }

  async run(context: Omit<CommandContext, "signal">): Promise<string | undefined> {
    const plugin = this.commands.get(context.command.toLocaleLowerCase("fi"));
    if (!plugin?.execute) return undefined;
    return this.invoke(context.command, (signal) => plugin.execute!({ ...context, signal }),
      "Command failed.");
  }

  async dispatch(context: Omit<MessageContext, "signal">): Promise<string | undefined> {
    const command = parseCommand(context.message);
    if (command && this.has(command.command)) {
      return this.run({ ...command, nick: context.nick, channel: context.channel });
    }
    // Käsittelijät aakkosjärjestyksessä; ensimmäinen vastaus voittaa.
    for (const { name, plugin } of this.messagePlugins) {
      const reply = await this.invoke(name, (signal) => plugin.onMessage!({ ...context, signal }));
      if (reply) return reply;
    }
    return undefined;
  }

  private async invoke(
    name: string,
    execute: (signal: AbortSignal) => Promise<string | undefined> | string | undefined,
    errorReply?: string,
  ): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => execute(controller.signal)),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("Timed out")), { once: true });
        }),
      ]);
      return typeof result === "string" ? formatReply(result) || undefined : undefined;
    } catch (error) {
      console.error(`Plugin ${name} failed: ${error}`);
      return errorReply;
    } finally {
      clearTimeout(timeout);
    }
  }

  close(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher.close();
  }
}
