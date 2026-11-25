// Claude Code. It gives each session a messaging socket with a token, which is how a message is handed to the session.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { copySkills, editJson, removeSkills, setHooks } from '../install/files.ts';
import type { Program } from './index.ts';
import { deleteSkill, projectRoot, listSkillsIn, writeSkill } from './skills.ts';

/** Plugin skills sit under ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills. */
function pluginSkillFolders() {
  const subfolders = (folder: string) => (fs.existsSync(folder) ? fs.readdirSync(folder).map((name) => path.join(folder, name)).filter((one) => fs.statSync(one).isDirectory()) : []);
  return subfolders(path.join(configDir(os.homedir(), process.env), 'plugins', 'cache'))
    .flatMap(subfolders)
    .flatMap(subfolders)
    .map((version) => path.join(version, 'skills'));
}

/** Claude Code reads project skills from the folder it starts in and each parent up to the repository root. */
function projectSkillFolders(cwd: string) {
  const root = projectRoot(cwd);
  const folders = [];
  for (let at = cwd; ; at = path.dirname(at)) {
    folders.push(path.join(at, '.claude', 'skills'));
    if (at === root || at === path.dirname(at)) return folders;
  }
}

const SKILLS = path.join('.claude', 'skills');

// Claude Code's own setting moves both its folder and .claude.json.
const configDir = (home: string, env: NodeJS.ProcessEnv) => env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude');
const configFile = (home: string, env: NodeJS.ProcessEnv) => (env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json'));

export default {
  name: 'claude',
  label: 'Claude Code',
  provider: { organization: 'Anthropic', url: 'https://www.anthropic.com' },
  clients: ['claude-code'],

  detect: (home, env) => fs.existsSync(configDir(home, env)),
  install(ctx) {
    editJson(configFile(ctx.home, ctx.env), (config) => ((config.mcpServers ??= {}).room = { type: 'stdio', ...ctx.mcp, env: {} }), ctx.created);
    editJson(path.join(configDir(ctx.home, ctx.env), 'settings.json'), setHooks(ctx.ours, [['Stop', ctx.hook]]), ctx.created);
    copySkills(path.join(configDir(ctx.home, ctx.env), 'skills'), ctx.skills, ctx.created);
  },
  uninstall(ctx) {
    editJson(configFile(ctx.home, ctx.env), (config) => delete config.mcpServers?.room);
    editJson(path.join(configDir(ctx.home, ctx.env), 'settings.json'), setHooks(ctx.ours, []));
    removeSkills(path.join(configDir(ctx.home, ctx.env), 'skills'), ctx.skills);
  },

  reach: () => ({ session: process.env.CLAUDE_CODE_SESSION_ID ?? null, socket: process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? null, token: process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? null }),
  deliver(session, prompt) {
    if (!session.socket) return;
    const lines = [{ type: 'auth', token: session.token }, { type: 'user', message: { role: 'user', content: prompt } }];
    const socket = net.createConnection(session.socket, () => socket.end(lines.map((line) => `${JSON.stringify(line)}\n`).join('')));
    socket.on('error', (error) => console.error(`could not reach the Claude Code session: ${error.message}`));
  },

  // Claude Code watches its skills folders, so a skill written there is available at once.
  skills: (cwd) => ({
    list: () => listSkillsIn([path.join(configDir(os.homedir(), process.env), 'skills'), ...projectSkillFolders(cwd), ...pluginSkillFolders()]),
    use(name, files) {
      writeSkill(projectRoot(cwd), SKILLS, name, files);
      return `Claude Code has it now as the skill /${name}.`;
    },
    remove: (name) => deleteSkill(projectRoot(cwd), SKILLS, name),
  }),
} satisfies Program;
