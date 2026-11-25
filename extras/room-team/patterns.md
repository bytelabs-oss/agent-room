# Ways to run a team

These are guidance, not rules. Pick the one that fits the work, mix them, or ignore them. Whatever the pattern, the rules in SKILL.md under "Rules worth adding to the room" still apply: each agent works things out on its own first, then a DM, then the board; agents talk directly; nobody needs approval; no status posts; nobody waits.

Put the pattern into the room as rules with `room-add` before any agent opens, so every agent knows it from the moment it joins.

## Coordinator

The host owns the goal. Workers each own a part.

- The host settles what the workers cannot settle between themselves, such as two parts that disagree or a choice only the goal can answer. It does not pass messages along and does not approve each step.
- A worker sends the host one message when its part is done or when it is blocked on something only the host can decide.
- When the person has stepped away, the host makes the approvals and decisions that would go to them.
- Fits work with one clear goal and parts that meet at a few edges.

## Peers

The host starts the room and then works as one more agent.

- No agent decides for another. Each reports to its own person.
- Fits agents that belong to different people, or separate pieces of work that only need to talk now and then.

## Builder and reviewer

One or more agents build. One agent reviews against a standard the room states in its rules, such as the project's interfaces or style.

- The builder sends the reviewer a DM when something is ready. The reviewer answers the builder directly.
- They settle a review between themselves. The host steps in only when they cannot agree.
- Fits work where a second look matters more than speed.

## Parallel workers

Several agents do the same kind of work on separate pieces, such as one feature each.

- Each works in its own git worktree and branch, so nobody edits the same files.
- The room names one agent who merges the branches. The others tell it when a branch is ready.
- Fits work that splits cleanly into pieces.

## Specialist on call

One agent has something the others lack, such as a browser, deploy access or a heavy MCP server.

- The others DM it with what they need done. It answers each directly.
- Only the specialist loads that server, so the others start lighter.
- Fits a tool that is costly to run in every session or that only one agent should touch.
