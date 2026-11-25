// Copilot CLI. Only code inside a session can hand it a message, so agent-room's Copilot extension
// (copilot-extension.ts) runs in every session: Copilot tells it when the room server's deliveries change, and it
// reads them through Copilot and hands them to the session.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { copySkills, editJson, removeSkills, writeFile } from '../install/files.ts';
import { deleteSkill, projectRoot, writeSkill } from './skills.ts';
import type { Program } from './index.ts';

const SKILLS = path.join('.github', 'skills');
const configDir = (home: string, env: NodeJS.ProcessEnv) => env.COPILOT_HOME ?? path.join(home, '.copilot');

export default {
  name: 'copilot',
  label: 'Copilot',
  provider: { organization: 'GitHub', url: 'https://github.com' },
  clients: ['github/cli', 'copilot-cli', 'github-copilot-cli'],

  detect: (home, env) => fs.existsSync(configDir(home, env)),
  install(ctx) {
    const dir = configDir(ctx.home, ctx.env);
    editJson(path.join(dir, 'mcp-config.json'), (config) => ((config.mcpServers ??= {}).room = { type: 'local', ...ctx.mcp, tools: ['*'] }), ctx.created);
    const hooks = { version: 1, hooks: { agentStop: [{ type: 'command', bash: ctx.hook }] } };
    writeFile(path.join(dir, 'hooks', 'room.json'), `${JSON.stringify(hooks, null, 2)}\n`, ctx.created);
    writeFile(path.join(dir, 'extensions', 'room', 'extension.mjs'), `import ${JSON.stringify(path.join(ctx.root, 'src', 'programs', 'copilot-extension.ts'))};\n`, ctx.created);
    copySkills(path.join(dir, 'skills'), ctx.skills, ctx.created);
  },
  uninstall(ctx) {
    const dir = configDir(ctx.home, ctx.env);
    editJson(path.join(dir, 'mcp-config.json'), (config) => delete config.mcpServers?.room);
    fs.rmSync(path.join(dir, 'hooks', 'room.json'), { force: true });
    fs.rmSync(path.join(dir, 'extensions', 'room'), { recursive: true, force: true });
    removeSkills(path.join(dir, 'skills'), ctx.skills);
  },

  reach: () => ({ session: process.env.COPILOT_AGENT_SESSION_ID ?? null }),
  deliver: (session, prompt, sender) => session.publish({ prompt, source: `agent-${sender}` }),

  // Copilot lists its own skills, and loads a new one when the extension in the session reloads them.
  skills(cwd, session) {
    return {
      list() {
        const listed: { name: string; description: string; path: string; enabled: boolean }[] = JSON.parse(execFileSync('copilot', ['skill', 'list', '--json'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        return listed.filter((skill) => skill.enabled).map((skill) => ({ name: skill.name, description: skill.description, folder: skill.path }));
      },
      use(name, files) {
        writeSkill(projectRoot(cwd), SKILLS, name, files);
        session.publish({ reloadSkills: true });
        return `Copilot has it now as the skill /${name}.`;
      },
      remove: (name) => deleteSkill(projectRoot(cwd), SKILLS, name),
    };
  },
} satisfies Program;
