// Registers agent-room with every program found under a home folder, or takes it out again.

import fs from 'node:fs';
import path from 'node:path';
import { PROGRAMS } from '../programs/index.ts';
import { removeIfEmpty } from './files.ts';
import type { InstallContext } from '../programs/index.ts';

const SOURCE = path.join(import.meta.dirname, '..', '..');
const listFolder = (folder: string) => fs.readdirSync(folder).map((name) => path.join(folder, name));
export const EXTRAS = fs.readdirSync(path.join(SOURCE, 'extras'));

/**
 * @param options the extras to install; uninstall takes them all out
 * @returns the labels of the programs found
 */
export function configure(home: string, install: boolean, { extras = [], env = process.env }: { extras?: string[]; env?: NodeJS.ProcessEnv } = {}): string[] {
  const root = path.join(home, '.agent-room');
  const hookFile = path.join(root, 'src', 'hook.ts');
  // What install made that was not there, kept across installs so uninstall can take it all out.
  const record = path.join(root, 'installed.json');
  const created: Set<string> = new Set(fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : []);
  const ctx: InstallContext = {
    home,
    env,
    root,
    mcp: { command: 'node', args: [path.join(root, 'src', 'mcp', 'server.ts')] },
    hook: `node ${hookFile}`,
    ours: (command) => command === `node ${hookFile}`,
    skills: [...listFolder(path.join(SOURCE, 'skills')), ...(install ? extras : EXTRAS).map((name) => path.join(SOURCE, 'extras', name))],
    created,
  };
  const found = Object.values(PROGRAMS).filter((program) => program.detect(home, env));
  for (const program of found) (install ? program.install : program.uninstall)(ctx);
  if (install) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(record, `${JSON.stringify([...created].sort(), null, 2)}\n`);
  } else {
    // Deepest first, so a folder is empty by the time it is reached.
    for (const one of [...created].sort((a, b) => b.length - a.length)) removeIfEmpty(one);
    fs.rmSync(record, { force: true });
  }
  return found.map((program) => program.label);
}
