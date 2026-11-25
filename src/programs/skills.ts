// Helpers for harnesses whose skills are folders: Agent Skills, a folder with a SKILL.md, in places the harness reads.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { HarnessSkill, SkillFiles } from '../agent/index.ts';

function git(cwd: string, args: string[]) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** The repository a session works in, or its folder when it is not in one. */
export const projectRoot = (cwd: string) => git(cwd, ['rev-parse', '--show-toplevel']) ?? cwd;

function readDescription(file: string) {
  const frontMatter = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1];
  const { description } = (frontMatter && parse(frontMatter)) || {};
  return typeof description === 'string' ? description.trim() : '';
}

/** The first folder wins when two have a skill of the same name. */
export function listSkillsIn(folders: string[]): HarnessSkill[] {
  const found = new Map<string, HarnessSkill>();
  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name, 'SKILL.md');
      if (!found.has(name) && fs.existsSync(file)) found.set(name, { name, description: readDescription(file), folder: path.join(folder, name) });
    }
  }
  return [...found.values()];
}

/** The repository's own exclude file, so a received skill never shows as a change to commit. */
function gitExcludeFile(root: string) {
  const file = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  return file && path.resolve(root, file);
}

const excludeLine = (skills: string, name: string) => `/${skills}/${name}/`;

/** A skill's name becomes a folder that is replaced and deleted, so it must not reach outside the skills folder. */
function skillFolder(root: string, skills: string, name: string) {
  if (name !== path.basename(name) || name === '.' || name === '..') throw new Error(`"${name}" is not a skill folder name`);
  return path.join(root, skills, name);
}

/** The skill is kept out of the repository's commits through its exclude file. */
export function writeSkill(root: string, skills: string, name: string, files: SkillFiles) {
  const folder = skillFolder(root, skills, name);
  fs.rmSync(folder, { recursive: true, force: true });
  for (const [file, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), data);
  }
  const exclude = gitExcludeFile(root);
  const line = excludeLine(skills, name);
  if (exclude && !(fs.existsSync(exclude) && fs.readFileSync(exclude, 'utf8').split('\n').includes(line))) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `${line}\n`);
  }
  return folder;
}

export function deleteSkill(root: string, skills: string, name: string) {
  fs.rmSync(skillFolder(root, skills, name), { recursive: true, force: true });
  const exclude = gitExcludeFile(root);
  if (!exclude || !fs.existsSync(exclude)) return;
  fs.writeFileSync(exclude, fs.readFileSync(exclude, 'utf8').split('\n').filter((one) => one !== excludeLine(skills, name)).join('\n'));
}
