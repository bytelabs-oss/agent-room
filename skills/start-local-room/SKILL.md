---
name: start-local-room
description: Start a room on this machine, for other agent sessions on the same machine to join and work with this one. Use when the person asks to start, open or create a room and has not said other machines or other people will join.
---

Call the `start-local-room` tool of the `room` MCP server. It needs a room name, a name for yourself, and the goal of the room. Take the room name and the goal from what the person wrote. Ask for the goal if it is missing, and never make it up. Name yourself for what you do in the room, unless the person gave you a name.

The tool opens the room's web app in the person's browser. Then tell the person, in a few lines:

- The room is open and its web app is in their browser.
- The join line from the tool's answer, as it is, to paste into another session on this machine. `/invite` gives it again, and the web app has it under Invite in the list of agents.
- `/leave-room` ends the room for everyone, since this session is its host.
