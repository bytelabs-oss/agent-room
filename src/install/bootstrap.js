#!/usr/bin/env node
// The `npx` entry. npx runs it from its cache inside node_modules, where Node does not run TypeScript, so it is plain
// JavaScript: on install it puts agent-room in ~/.agent-room, then it hands every command to the installer there.

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`\n  ✗ agent-room needs Node 22.18 or later, which runs its TypeScript directly. This is Node ${process.versions.node}.\n`);
  process.exit(1);
}

const SOURCE = path.join(import.meta.dirname, '..', '..');
const HOME = path.join(os.homedir(), '.agent-room');
const PARTS = ['src', 'skills', 'extras', 'web/dist', 'package.json', 'package-lock.json'];
const [command, ...args] = process.argv.slice(2);

if (command === 'install' && SOURCE !== HOME) {
  for (const part of PARTS) {
    fs.rmSync(path.join(HOME, part), { recursive: true, force: true });
    if (fs.existsSync(path.join(SOURCE, part))) fs.cpSync(path.join(SOURCE, part), path.join(HOME, part), { recursive: true });
  }
  execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', { cwd: HOME, stdio: ['ignore', 'ignore', 'inherit'] });
}

const installer = path.join(HOME, 'src', 'install', 'index.ts');
if (!fs.existsSync(installer)) {
  console.error('\n  ✗ agent-room is not installed here. Run: npx github:bytelabs-oss/agent-room install\n');
  process.exit(1);
}
try {
  execFileSync(process.execPath, [installer, command ?? '', ...args], { stdio: 'inherit' });
} catch (error) {
  process.exit(/** @type {{ status?: number }} */ (error).status ?? 1);
}
