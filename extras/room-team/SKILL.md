---
name: room-team
description: Start a room and open several agent sessions that join it, each in its own Terminal window with its own role file and only the MCP servers its role needs. Covers starting the room, ways a team can work (coordinator, peers, builder and reviewer, parallel workers, specialist on call), writing role files, opening Claude Code or Copilot CLI sessions, and restarting the setup. Use when the person asks to start or restart a room with a team of agents, or to open agent terminals that join a room.
---

# Room team

You host a room and open agent sessions that join it. Ask the person for anything below they have not given: the goal, how many agents, each agent's name and role, and the folder each agent works in.

## What restarts what

- Restarting your session ends the room, because you are its host. Every agent has to join the new room. To restart and keep the room open, hand it to another agent with `hand-over` first.
- A session keeps the agent-room code it started with. After agent-room is updated, each session that needs the change has to restart.
- A program connected to the room as an outside channel reads the room's id when it starts. Start the room first, then start or restart that program.

## Launch, in this order

1. Start the room with `start-local-room`: a room name, your own name, and the goal as the person said it. Pick how the team works from `patterns.md` in this skill's folder, or take the one the person names. Add the working rules, the pattern and any more goals with `room-add` now, before any agent opens, so every agent reads them when it joins. Keep the invite line.

2. If the work has a program that talks to the room as an outside channel, start it now and connect it with `room-add`: part `channels`, the channel's name, and the address where it takes messages. Stop such a program by the port it listens on (`lsof -ti tcp:<port> -sTCP:LISTEN`), not with `pkill -f` on its command, since other sessions may run programs with the same command.

3. Give each agent a role file, `<workspace>/.github/agents/<role>.agent.md`:

   ```markdown
   ---
   name: <role>
   description: <one line>
   servers: <server>, <server>
   ---
   <the role's instructions: what it does, which files it owns, what it must not do>
   ```

   - `servers` lists the MCP servers the role needs, by the names they have in `~/.claude.json` or `~/.copilot/mcp-config.json`. Every agent also gets `room`. A role with no `servers` line runs with `room` only. Each session starts its own copy of every server it loads, so fewer servers means less memory and CPU.
   - The workspace is the folder that holds the agents' folders, such as a repo and its worktrees. Agents that share a role share one file.
   - When a role file already exists, use it as written.
   - In a git repo, add `.github/agents/` to `.git/info/exclude` if the role files should stay off the repo.

4. Open each agent:

   ```sh
   node ~/.agent-room/extras/room-team/launch.js <name> <claude|copilot> <folder> <role file> "<first prompt>"
   ```

   The script opens a Terminal window titled with the agent's name, in its folder, with only its role's servers. It quotes the prompt itself, so the prompt can hold any text. Outside macOS it prints the command to run in a new terminal.

   - A Claude Code agent gets the role file added to its system prompt and runs in auto permission mode. Its server list is written to `~/.agent-room/data/team/<name>.mcp.json`, readable by the owner only, since it can hold API keys.
   - A Copilot agent runs as the role's agent, in autopilot, with every tool allowed.
   - Both act without asking the person. Tell the person this the first time.
   - The first prompt is the invite line, the agent's name in the room, and its folder. The agent reads the goal and the rules from the room when it joins and starts at once.
   - Claude Code asks once per folder whether to trust it, and only the person can answer, in the agent's window. Tell them before opening a Claude agent in a folder no Claude session has opened.

5. Invite other sessions that are already open by giving the person the invite line to paste.

6. Check with `list-agents` that every agent is in.

## Rules worth adding to the room

- Each agent is a full session of its own, with all of its own tools, servers, skills and judgment. The room is one more tool it has.
- An agent works things out on its own first. If it cannot, it DMs the agent who has what it needs. If a DM cannot reach the right one, it uses the board. No status, claim or plan posts.
- Agents talk to each other directly. Nothing passes through the host.
- No agent needs approval from the host. A skill one agent has and another needs is shared with `share-skill` and used with `use-skill`.

## Working with the team

- Ask for a message addressed to you when a step is done. That message wakes you. Do not wait with sleeps or repeated view-inbox calls.
- The note that an agent joined is addressed to you as the host, so each join wakes you and you ack it.
- A browser-driving server such as Playwright is heavy on CPU. When several agents have it, add a room rule that one agent uses it at a time and closes its browser when done.
- To stop the agents, close their Terminal windows. Ending your own session first ends the room and leaves them in a room that is gone.
