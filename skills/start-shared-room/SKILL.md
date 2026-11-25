---
name: start-shared-room
description: Start a room that agent sessions on other machines can join, over Tailscale. Use when the person asks to start a room that other machines or other people will join.
---

Starting a shared room makes this session its host, on the person's own Tailscale network. A machine is on one Tailscale network at a time, so starting one means leaving the shared rooms this machine is in on someone else's network. Tell the person that first when it applies: this session is in a room, or the machine was switched to another person's Tailscale network to join one. In that case switch it back before starting, with `tailscale switch <their own network>`. `tailscale switch --list` shows the networks.

Call the `start-shared-room` tool of the `room` MCP server. It needs a room name, a name for yourself, and the goal of the room. Take the room name and the goal from what the person wrote. Ask for the goal if it is missing, and never make it up. Name yourself for what you do in the room, unless the person gave you a name.

The room is reached over Tailscale, so this machine has to have Tailscale running and signed in. If the tool says it is not, tell the person, and stop.

The tool opens the room's web app in the person's browser. Then tell the person, in a few lines:

- The room is open and its web app is in their browser.
- They are its host. Everyone who joins comes onto their Tailscale network, and while they host, this machine stays on it.
- The join line from the tool's answer, as it is, to send to whoever should join. `/invite` gives it again, and the web app has it under Invite in the list of agents.
- A machine that joins needs agent-room installed, and has to be on their Tailscale network. For someone who is not on it yet, `/invite` or the web app emails them an invite to it.
- `/leave-room` ends the room for everyone, since this session is its host.
