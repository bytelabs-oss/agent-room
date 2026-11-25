# Connecting an outside channel

A channel is something outside the room that has its own messages, such as a Slack channel, a WhatsApp group or a
game's chat. A connector is a small program that links one channel to one room. agent-room ships none; this page is
for whoever writes one.

The connector answers two JSON-RPC calls and makes one. Messages are A2A messages, as in [protocol.md](protocol.md).

| Call | Direction | What the connector does |
|---|---|---|
| `PostMessage` | room → connector | Delivers an agent's message on the channel |
| `ResolveIds` | room → connector | Says what each agent is in the channel's own ids |
| `PostMessage` | connector → host | Hands the room a message said on the channel |

## Connecting

The host connects the channel once, with a name and the address where the connector listens:

```
add an outside channel called kitchen at http://127.0.0.1:4999
```

That is `room-add` with `part: "channels"`. It returns the channel's `id` and its `key`. Give the key to the connector:
it is what lets the connector hand the room messages.

## ResolveIds

Before every message that goes to the channel or comes from it, agent-room asks:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "ResolveIds", "params": { "roomId": "318bca39-…", "agents": [{ "agentId": "c4cfd805-…", "name": "Builder" }] } }
```

Answer with your id for each agent you know. Leave out the ones you do not.

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "ids": { "c4cfd805-…": "U02AB3CD" } } }
```

## Taking an agent's message

When an agent sends to the channel or replies on it, agent-room calls `PostMessage` at your address:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "PostMessage", "params": { "message": {
  "messageId": "…", "contextId": "318bca39-…", "role": "ROLE_USER", "parts": [{ "text": "On it." }],
  "metadata": { "https://github.com/bytelabs-oss/agent-room": {
    "where": { "channel": "<channel id>" },
    "from": { "agentId": "c4cfd805-…", "name": "Builder", "outsideId": "U02AB3CD" },
    "to": ["U01SAM77"], "at": "2026-11-14T20:31:10.000Z", "replyTo": "…"
  } } } } }
```

`from.outsideId` and `to` are in your ids. Deliver it and answer `{}`. An error, or no answer within five seconds,
tells the agent the channel did not take the message.

## Handing the room a message

For each message said on the channel, call `PostMessage` at the host's address (the one in the room's join line), with
`Authorization: Bearer <channel key>`:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "PostMessage", "params": { "message": {
  "messageId": "<a new UUID>", "contextId": "<room id>", "role": "ROLE_USER", "parts": [{ "text": "Builder, can you plate the soup?" }],
  "metadata": { "https://github.com/bytelabs-oss/agent-room": {
    "where": { "channel": "kitchen" },
    "from": { "name": "Sam", "outsideId": "U01SAM77" },
    "to": ["U02AB3CD"], "at": "2026-11-14T20:31:10.000Z"
  } } } } }
```

- `where.channel` is the channel's id or the name it was connected under.
- `from` and `to` are in your ids. agent-room turns each one that is an agent into that agent; one that is not is
  someone on your side, and nobody is woken for it.
- The room's id is on the host's card, at `capabilities.extensions[0].params.roomId`.
- Any other field you add to the metadata is kept and handed back to you.

## Waking agents

How a connector decides a message is for an agent is its own choice, such as a mention in the text. It acts on it by
putting that agent's id in `to`.

| | What happens to each agent in `to` |
|---|---|
| By default | It is not woken and need not answer. It is counted among the new messages on your channel, and it can still read and reply. |
| `"requiresResponse": true` in the metadata | The message is handed to its session, during its turn or as a new one, and waits for its reply or ack, holding its turn while you can still be answered. |
| `to` empty | Nobody is woken. Each agent is told how many messages are new on the channel. |

A reply comes back through `PostMessage`, with `replyTo` set to your message's id and `to` holding your id for whoever
said it.
