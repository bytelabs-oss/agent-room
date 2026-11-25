# Contributing

## Checks

```sh
npm install
npm test            # node:test, real agents on localhost ports
npm run check       # tsc type check
npm run lint        # oxlint
npm run build:web   # after changing the web app; the build in web/dist is committed
```

CI runs all four on every push and pull request.

## TypeScript without a build

Node 22.18 and later run `.ts` files directly by stripping their types, so `src/` is TypeScript and nothing is built.
That allows only syntax that can be stripped: no `enum`, `namespace` or constructor parameter properties, and
imports name their `.ts` files. `tsconfig.json` sets `erasableSyntaxOnly`, so `npm run check` refuses anything else.

One file is plain JavaScript: `src/install/bootstrap.js`, which `npx` runs from inside `node_modules`, where Node
does not strip types.

## Layout

```
src/
  room.ts, schema.ts      the room document and A2A messages; shapes of what comes in
  agent/                  one agent as functions over a plain state object
    index.ts              state, card, presence, lookups
    messages.ts           posting, receiving, the inbox
    membership.ts         start, join, sync with the host, leave, accept a hand-over
    hosting.ts            what the host does
    skills.ts             sharing skills: carrying a folder from one agent's harness to another's
  peers.ts                the JSON-RPC methods other agents and channels call
  local.ts                routes for this machine's web app and hooks
  rpc.ts, http.ts         calling out, listening
  turn.ts, hook.ts        holding and waking a session's turn
  registry.ts, tailscale.ts
  mcp/                    the MCP server, its tools, and room.md (the guide agents read)
  programs/               one file per program
  install/                install, uninstall, config editing
web/                      the web app (React, Vite)
skills/                   the slash commands every install gets
extras/                   skills installed only on request
test/
docs/                     protocol.md, channels.md
```

`src/agent/` never touches MCP and calls other agents and channels only through `rpc.ts`; the server hands it `net`
(`listen`, `share`, `stop`). The files in it import in one direction: `index` ← `messages` ← `hosting` ← `skills`,
`membership`.

## Adding a program

Add `src/programs/<name>.ts`, shaped like the others (the `Program` type in `src/programs/index.ts`), and one line in
`src/programs/index.ts`:

- `clients`: the names it gives as an MCP client.
- `skills(cwd, session)`: the program's skills, its own way: `list` which it has, `use` to take in a shared skill
  folder so the program has it as one of its own, `remove` to take it out. `src/programs/skills.ts` has helpers for
  programs whose skills are folders. agent-room only carries the folder.
- `detect`, `install`, `uninstall`: how it is set up. Use the helpers in
  `src/install/files.ts`, and make `uninstall` undo `install` exactly; `test/install.test.ts` checks that.
- `reach`, `deliver`: how the session is found, and how a message is handed to it. The program decides whether it
  goes into the turn under way or starts one. A program that can only be reached from inside the session, as
  Copilot, calls `session.publish`: the MCP server queues the delivery in its `room://deliveries` resource and sends
  `notifications/resources/list_changed`, and code in the session reads it through the program.

## Adding a tool

Add one entry to `TOOLS` in `src/mcp/tools.ts`: a name, a description, a zod input, and `run(agent, input)` returning
JSON. Say when to use it in `src/mcp/room.md`.

## Adding a part of the room

Add a map to the room in `src/room.ts` (`newRoom` and the `Room` type) and its shape in `src/schema.ts`.

## Diagrams

The README's diagrams are drawn with [Archify](https://github.com/alksnd/archify) from the JSON in `docs/diagrams/`. To change one, edit its JSON, render it with Archify's architecture renderer, make its A2A arrows two-way (`marker-start` as well as `marker-end`) and remove the legend, then export the SVG into `docs/images/`. Screenshots come from the web app's sample room (`npm --prefix web run dev`), in light and dark.

## Style

- Functions start with a verb (`admitAgent`, `syncWithHost`); ones that answer yes or no start with `is` or `has`.
  Constants carry their unit (`QUICK_TIMEOUT_MS`), and zod shapes end in `Schema`.
- Use what Node, a package already in `package.json` or a standard gives before writing your own; add no caps or
  limits that nothing needs.
- Comments say only what the code cannot: a constraint, the reason for an exact value, a non-obvious requirement.
- A few behaviour tests per area, against real agents; no test file over ten tests.
