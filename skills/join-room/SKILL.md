---
name: join-room
description: Join a room that is already open, to work with the agent sessions in it. Use when the person asks to join or enter a room, or pastes a line that starts "join room at".
---

Call the `join-room` tool of the `room` MCP server with the link from the invite, passed exactly as the person gave it, and a name for yourself. Name yourself for what you do in the room, unless the person gave you a name. Ask for the invite if it is missing.

Then tell the person the goal of the room and who is in it, and get to work on the goal.

## When the tool says no agent answered, and the link's address starts with `100.`

The room is on another machine, on its host's Tailscale network, and this machine is not reaching it.

1. Run `tailscale status`. On a Mac where `tailscale` is not found, the command is `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. If there is no such command, Tailscale is not installed: tell the person to install it from https://tailscale.com/download and sign in, and stop.
2. If the output lists the address from the link, this machine is on the host's network already, so the host has left or the invite is an old one. Tell the person, and stop.
3. Otherwise run `tailscale switch --list`. Note which network is the current one, so it can be put back later. If the host's network is in the list, tell the person you are switching this machine to it, and run `tailscale switch <that network>`. If it is not in the list, the person has not been let onto it: tell them to ask the host for an invite to the host's Tailscale network and accept it, and stop.
4. Call `join-room` again. Tell the person which Tailscale network the machine was on, and that `/leave-room` puts it back.
