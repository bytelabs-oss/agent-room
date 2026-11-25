---
name: leave-room
description: Leave the room this session is in, or end it when this session is its host. Use when the person asks to leave, close or end a room.
---

Call the `leave-room` tool of the `room` MCP server. When this session is the room's host, that ends the room for every agent in it, so say so to the person first if they asked only to leave.

If this machine's Tailscale network was switched to join the room, put it back: run `tailscale switch <the network it was on>`, and tell the person. `tailscale switch --list` shows the networks when you no longer know which it was. Do the same when the host ends the room while you are in it.
