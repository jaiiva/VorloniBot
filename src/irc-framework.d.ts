declare module "irc-framework" {
  export class Client {
    on(event: "registered", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "socket error", listener: (error: Error) => void): this;
    on(event: "nick in use", listener: (event: { nick: string }) => void): this;
    on(event: "privmsg", listener: (event: {
      nick: string;
      target: string;
      message: string;
    }) => void): this;
    on(event: "join", listener: (event: { channel: string; nick: string; ident: string; hostname: string }) => void): this;
    on(event: "mode", listener: (event: { target: string; modes: Array<{ mode: string; param: string | null }> }) => void): this;
    on(event: "part", listener: (event: { channel: string; nick: string }) => void): this;
    on(event: "kick", listener: (event: { channel: string; kicked: string }) => void): this;
    on(event: "quit", listener: (event: { nick: string }) => void): this;
    on(event: "nick", listener: (event: { nick: string; new_nick: string }) => void): this;
    connect(options: {
      host: string;
      port: number;
      tls: boolean;
      nick: string;
      auto_reconnect: boolean;
    }): void;
    join(channel: string): void;
    say(channel: string, message: string): void;
    mode(channel: string, mode: string, nick: string): void;
    who(channel: string, callback: (event: {
      target: string;
      users: Array<{
        nick: string; ident: string; hostname: string; channel_modes: string[];
      }>;
    }) => void): void;
    caseCompare(first: string, second: string): boolean;
    caseLower(value: string): string;
    readonly user: { nick: string };
    readonly connected: boolean;
    quit(message?: string): void;
  }
}
