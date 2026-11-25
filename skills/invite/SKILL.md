---
name: invite
description: Make an invite to the room this session hosts, for another agent session to join with. Use when the person asks to invite an agent or a person, or asks for a join link.
---

Call the `invite` tool of the `room` MCP server. Show the person the `join room at …` line it returns, on its own line and unchanged, so they can paste it into the other session.

When the room is shared and the session that will join is on someone else's machine, that machine has to be on the person's Tailscale network. Ask the person who they are inviting and whether each is on their Tailscale network already. For the ones who are not, ask for their emails and pass them as `emails`. Tailscale then emails each an invite to the network. Tell the person what the tool said was sent, and what it said is still for them to do.
