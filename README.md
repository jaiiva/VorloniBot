# Vorloni

A simple IRC bot that joins the channels specified in its configuration. When
someone posts an HTTP(S) link, the title plugin fetches the first link's page
title and posts it to the same channel. The page must be publicly accessible;
the bot does not fetch local or private network addresses.

YouTube video titles are fetched from oEmbed metadata when available. Reddit
post titles also use oEmbed because regular Reddit pages may show the bot a
JavaScript challenge instead. Public Facebook and Instagram posts use
`og:title` metadata. For other sites, the bot reads only as much HTML as it
needs to find the title.

The `!sää` plugin reports the current weather in Kuopio using Open-Meteo data.
`!haddock` fetches a new insult from the Haddock generator at mummila.net for
each request; `!metafora` fetches a new simile from the same site.
Plugin responses, including the `Otsikko:` prefix, may still be in Finnish.

## Getting started

Requires Node.js 22 or newer and npm.

1. Install dependencies: `npm install`
2. Copy `config.example.json` to `config.json` and set the server, nickname, and channels.
3. Build the bot: `npm run build`
4. Start it: `node dist/index.js` (or `npm start`).

`server.port` defaults to 6697 and `server.tls` defaults to `true`; both can
be omitted. For an unencrypted connection, set `"port": 6667` and
`"tls": false`. The bot retries a lost connection every five seconds.

Stop the bot with Ctrl+C. If you only stop the `npm start` process with a
command such as `kill`, its Node.js child process may remain running. Check
for it with `ps -ef | grep '[n]ode dist/index.js'`, then stop the bot's own
process with `kill -TERM <pid>`. If the connection is forcibly closed without
a QUIT message, the IRC server may keep the nickname reserved until the
connection times out.

Run tests with `npm test`.

## Plugins

The bot loads `.cjs` files from `plugins/` at startup and watches that
directory while running. Adding, changing, or removing a plugin takes effect
automatically after a short delay, without restarting the bot. If an updated
plugin fails to load, its previous working version remains active.

A command plugin exports a command and an execution function:

```js
module.exports = {
  command: "!hello",
  async execute({ args, nick, channel, signal }) {
    return `Hello, ${nick}!`;
  },
};
```

A plugin that responds to regular messages can instead define `onMessage`:

```js
module.exports = {
  async onMessage({ message, nick, channel, signal }) {
    if (!message.includes("hello")) return;
    return `Hello, ${nick}!`;
  },
};
```

Each message is passed to the handlers. A recognized command runs first;
otherwise, message plugins run in filename order and the first reply is sent
to the channel. Return `undefined` to skip a message. The bot ignores its own
messages so that replies do not trigger further replies.
`plugins/title.cjs` uses this model for URL previews.

Command plugins receive the text after the command in `args`. The `signal`
aborts after eight seconds; pass it to operations such as `fetch`. Replies
are sanitized and limited to 300 UTF-8 bytes before being sent to the
channel. Plugins handle messages only on configured channels.

Message and command plugins can be updated while the bot is running. Changes
to the runtime code in `src/` require a build and restart. The entire URL
preview implementation lives in `plugins/title.cjs`, so changing it requires
neither. `src/url-preview.ts` only provides a typed interface for tests.

### Automatic channel operator privileges

When the bot joins a channel, `plugins/auto-op.cjs` saves the exact
`nick!user@host` masks of its current operators to `data/op-masks.json`.
The file is created if necessary; operators who receive `+o` later are also
added. Existing masks are preserved. For example:

```json
{
  "#example": ["Alice!uid668184@id-668184.hampstead.irccloud.com"]
}
```

You can manually change a mask to `Alice!uid*@*.hampstead.irccloud.com`.
The bot never creates wildcards itself, and it will not add another exact
mask if an existing rule already matches the user. The file is read on each
JOIN event, so manual edits take effect without a restart. If a joining
user matches a saved mask and the bot has `+o` on that channel, it grants
the user `+o`.

Invalid JSON prevents the bot from granting operator privileges or saving
new masks until the file is fixed. Only trusted administrators should edit
the file: overly broad masks may grant privileges to unintended users.

The initial deployment of this feature requires `npm run build` and a bot
restart because JOIN and MODE event handling is part of the core. Subsequent
changes to the plugin itself are hot-reloaded.

Plugins are **trusted local code** with the same privileges as the bot. Do
not add untrusted files to the plugin directory.
