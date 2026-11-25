// The programs a session can run in. Supporting another program is one file shaped like these and one line here.

import claude from './claude.ts';
import codex from './codex.ts';
import copilot from './copilot.ts';
import type { SkillHost } from '../agent/index.ts';

export type InstallContext = {
  home: string;
  env: NodeJS.ProcessEnv;
  root: string;
  mcp: { command: string; args: string[] };
  hook: string;
  ours(command: string): boolean;
  skills: string[];
  created: Set<string>;
};
/** What the program said about its session in `reach`, and a way to queue something for the client to read over MCP. */
export type Session = Record<string, any> & { publish(delivery: object): void };

export type Program = {
  name: string;
  label: string;
  provider: { organization: string; url: string };
  /** The names it gives as an MCP client. */
  clients: string[];
  detect(home: string, env: NodeJS.ProcessEnv): boolean;
  install(ctx: InstallContext): void;
  uninstall(ctx: InstallContext): void;
  /** In the session: what it takes to find it and hand it a message. */
  reach(): Record<string, any>;
  /** Hands the session a message from `sender`; the program delivers it into the turn under way or starts one. */
  deliver(session: Session, prompt: string, sender: string): void;
  /** Its skills, for a session working in `cwd`: which it has, and how it takes in a shared one. */
  skills(cwd: string, session: Session): SkillHost;
};

export const PROGRAMS: Record<string, Program> = { claude, codex, copilot };

export const findProgramByClient = (client: string | undefined) => Object.values(PROGRAMS).find((program) => client && program.clients.includes(client));
