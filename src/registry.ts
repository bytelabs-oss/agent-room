// The agents open on this machine, each filed as data/agents/<pid>.json, and the process tree that ties a session's
// hooks to its agent. A program such as VS Code runs many sessions in one process, so an agent is found by the
// session id its program gives it, and by process only when that is unambiguous.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = () => process.env.AGENT_ROOM_DIR ?? path.join(import.meta.dirname, '..', 'data');

const agentsDir = () => {
  const dir = path.join(dataDir(), 'agents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const entryFile = () => path.join(agentsDir(), `${process.pid}.json`);

function processTree(): Map<number, { ppid: number; command: string }> {
  const tree = new Map();
  try {
    for (const line of execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n')) {
      const found = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (found) tree.set(Number(found[1]), { ppid: Number(found[2]), command: found[3] });
    }
  } catch {
    // No ps: the tree is empty and lookups fall back to the session id.
  }
  return tree;
}

/** Nearest first. */
export function ancestors(pid: number, tree = processTree()) {
  const chain: number[] = [];
  for (let at = pid; at > 1 && !chain.includes(at); at = tree.get(at)?.ppid ?? 0) chain.push(at);
  return chain;
}

let knownCliPid: number | undefined;
/** The program this agent's session runs in. Version-manager wrappers running this same script are skipped. */
export function cliPid() {
  if (knownCliPid) return knownCliPid;
  const tree = processTree();
  const script = ` ${process.argv.slice(1).join(' ')}`;
  let pid = process.ppid;
  while (tree.get(pid)?.command.endsWith(script)) pid = tree.get(pid)?.ppid ?? 0;
  return (knownCliPid = pid > 1 ? pid : process.ppid);
}

type Entry = {
  cliPid: number;
  pid: number;
  session: string | null;
  port: number;
  agent: { id: string; name: string };
  room: { id: string; name: string; goals: string[]; host: string };
};

/** Written whole and renamed into place, so a reader never sees half a file. */
export function register(entry: Omit<Entry, 'cliPid' | 'pid'>) {
  fs.writeFileSync(`${entryFile()}.tmp`, JSON.stringify({ cliPid: cliPid(), pid: process.pid, ...entry }));
  fs.renameSync(`${entryFile()}.tmp`, entryFile());
}

export const unregister = () => fs.rmSync(entryFile(), { force: true });

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Removes the files of agents whose process has ended. */
export function openAgents(): Entry[] {
  const open = [];
  for (const name of fs.readdirSync(agentsDir()).filter((one) => one.endsWith('.json'))) {
    const file = path.join(agentsDir(), name);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isAlive(entry.pid)) open.push(entry);
    else fs.rmSync(file, { force: true });
  }
  return open;
}

/** By session id, else the only agent under the nearest of the given processes. */
export function findSessionAgent(pids: number[], session?: string) {
  const open = openAgents();
  const bySession = session && open.find((one) => one.session === session);
  if (bySession) return bySession;
  for (const pid of pids) {
    const there = open.filter((one) => one.cliPid === pid);
    if (there.length) return there.length === 1 ? there[0] : null;
  }
  return null;
}
