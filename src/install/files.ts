// Editing the config files of the programs agent-room installs into. Install records in `created` every file and
// folder it makes that was not there, and uninstall removes those again once nothing but agent-room's part was in them.

import fs from 'node:fs';
import path from 'node:path';

function recordCreated(created: Set<string>, target: string) {
  for (let at = target; !fs.existsSync(at); at = path.dirname(at)) created.add(at);
}

function makeFolder(folder: string, created: Set<string>) {
  recordCreated(created, folder);
  fs.mkdirSync(folder, { recursive: true });
}

export function writeFile(file: string, text: string, created: Set<string>) {
  makeFolder(path.dirname(file), created);
  recordCreated(created, file);
  fs.writeFileSync(file, text);
}

/** With `created`, a missing file is made and recorded; without it, a missing file is left missing. */
export function editJson(file: string, change: (config: any) => void, created?: Set<string>) {
  const exists = fs.existsSync(file);
  if (!exists && !created) return;
  const config = exists ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  change(config);
  const text = `${JSON.stringify(config, null, 2)}\n`;
  if (created) writeFile(file, text, created);
  else fs.writeFileSync(file, text);
}

/** For Claude Code and Codex hooks files. Replaces agent-room's hooks; no entries just removes them. Empty events are dropped. */
export const setHooks = (ours: (command: string) => boolean, entries: [event: string, command: string, extra?: object][]) => (config: any) => {
  const hooks = (config.hooks ??= {});
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((group: any) => !group.hooks?.some((hook: any) => ours(hook.command ?? '')));
    if (!hooks[event].length) delete hooks[event];
  }
  for (const [event, command, extra = {}] of entries) (hooks[event] ??= []).push({ hooks: [{ type: 'command', command, ...extra }] });
  if (!Object.keys(hooks).length) delete config.hooks;
};

function withoutTomlBlock(text: string, header: string) {
  const start = text.indexOf(`\n${header}\n`) + 1 || (text.startsWith(`${header}\n`) ? 0 : -1);
  if (start < 0) return text.trimEnd();
  const next = text.slice(start + header.length).search(/\n\[/);
  return (text.slice(0, start) + (next === -1 ? '' : text.slice(start + header.length + next + 1))).trimEnd();
}

export function setTomlBlock(file: string, table: string, body: string, created: Set<string>) {
  const rest = withoutTomlBlock(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', `[${table}]`);
  writeFile(file, `${rest ? `${rest}\n\n` : ''}[${table}]\n${body}\n`, created);
}

export function removeTomlBlock(file: string, table: string) {
  if (!fs.existsSync(file)) return;
  const rest = withoutTomlBlock(fs.readFileSync(file, 'utf8'), `[${table}]`);
  fs.writeFileSync(file, rest ? `${rest}\n` : '');
}

export function copySkills(folder: string, skills: string[], created: Set<string>) {
  makeFolder(folder, created);
  for (const skill of skills) {
    const target = path.join(folder, path.basename(skill));
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(skill, target, { recursive: true });
  }
}

export function removeSkills(folder: string, skills: string[]) {
  for (const skill of skills) fs.rmSync(path.join(folder, path.basename(skill)), { recursive: true, force: true });
}

const isEmptyObject = (value: unknown): boolean => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as object).every(isEmptyObject);

function isEmptyJson(text: string) {
  try {
    return isEmptyObject(JSON.parse(text));
  } catch {
    return false;
  }
}

/** Empty means an empty folder, an empty file, or JSON of only empty objects. */
export function removeIfEmpty(target: string) {
  if (!fs.existsSync(target)) return;
  if (fs.statSync(target).isDirectory()) {
    if (!fs.readdirSync(target).length) fs.rmdirSync(target);
    return;
  }
  const text = fs.readFileSync(target, 'utf8').trim();
  if (!text || isEmptyJson(text)) fs.rmSync(target);
}
