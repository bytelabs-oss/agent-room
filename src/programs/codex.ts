// Codex. It tells its MCP servers nothing about the session, but keeps the session's rollout file open, and the
// session id is in that file's name. `codex queue` hands a session a message.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copySkills, editJson, removeSkills, removeTomlBlock, setHooks, setTomlBlock } from '../install/files.ts';
import { cliPid } from '../registry.ts';
import type { Program } from './index.ts';
import { deleteSkill, projectRoot, listSkillsIn, writeSkill } from './skills.ts';

const SESSION_FILE = /rollout-[^\n]*-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl/;
const STOP_TIMEOUT_S = 30;

const configDir = (home: string, env: NodeJS.ProcessEnv) => env.CODEX_HOME ?? path.join(home, '.codex');

export default {
  name: 'codex',
  label: 'Codex',
  provider: { organization: 'OpenAI', url: 'https://openai.com' },
  clients: ['codex-mcp-client'],

  detect: (home, env) => fs.existsSync(configDir(home, env)),
  install(ctx) {
    setTomlBlock(path.join(configDir(ctx.home, ctx.env), 'config.toml'), 'mcp_servers.room', `command = ${JSON.stringify(ctx.mcp.command)}\nargs = ${JSON.stringify(ctx.mcp.args)}`, ctx.created);
    editJson(path.join(configDir(ctx.home, ctx.env), 'hooks.json'), setHooks(ctx.ours, [['Stop', ctx.hook, { timeout: STOP_TIMEOUT_S }]]), ctx.created);
    copySkills(path.join(ctx.home, '.agents', 'skills'), ctx.skills, ctx.created);
  },
  uninstall(ctx) {
    removeTomlBlock(path.join(configDir(ctx.home, ctx.env), 'config.toml'), 'mcp_servers.room');
    editJson(path.join(configDir(ctx.home, ctx.env), 'hooks.json'), setHooks(ctx.ours, []));
    removeSkills(path.join(ctx.home, '.agents', 'skills'), ctx.skills);
  },

  reach() {
    try {
      const open = execFileSync('lsof', ['-p', String(cliPid()), '-Fn'], { encoding: 'utf8' });
      return { session: open.match(SESSION_FILE)?.[1] ?? null };
    } catch {
      return { session: null };
    }
  },
  deliver({ session }, prompt) {
    if (!session) return;
    spawn('codex', ['queue', '--thread', session, '--message', prompt], { stdio: 'ignore' }).on('error', (error) => console.error(`could not run codex queue: ${error.message}`));
  },

  skills: (cwd) => ({
    list: () => listSkillsIn([path.join(projectRoot(cwd), '.agents', 'skills'), path.join(os.homedir(), '.agents', 'skills'), path.join(configDir(os.homedir(), process.env), 'skills')]),
    use(name, files) {
      const folder = writeSkill(projectRoot(cwd), path.join('.agents', 'skills'), name, files);
      return `Installed in ${folder}, where Codex reads project skills.`;
    },
    remove: (name) => deleteSkill(projectRoot(cwd), path.join('.agents', 'skills'), name),
  }),
} satisfies Program;
