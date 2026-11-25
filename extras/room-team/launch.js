// Opens one agent session in a new Terminal window, named after the agent, with its role's instructions and only its
// role's MCP servers plus room.
// Usage: node launch.js <name> <claude|copilot> <folder> <role file> "<first prompt>"
// The role file is <workspace>/.github/agents/<role>.agent.md. Its front matter can list servers: a, b
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const [name, tool, folder, roleArg, prompt] = process.argv.slice(2);
if (!/^[\w-]+$/.test(name ?? '') || !['claude', 'copilot'].includes(tool) || !folder || !roleArg || !prompt) {
  console.error('usage: node launch.js <name> <claude|copilot> <folder> <role file> "<first prompt>"\nThe name holds only letters, digits, - and _.');
  process.exit(1);
}

const roleFile = resolve(roleArg);
if (!roleFile.endsWith('.agent.md') || basename(dirname(roleFile)) !== 'agents' || basename(dirname(dirname(roleFile))) !== '.github') {
  console.error('the role file must be <workspace>/.github/agents/<role>.agent.md');
  process.exit(1);
}
const role = basename(roleFile, '.agent.md');
const workspace = dirname(dirname(dirname(roleFile)));
const servers = new Set(['room']);
for (const server of readFileSync(roleFile, 'utf8').match(/^servers:(.*)$/m)?.[1].split(',') ?? []) if (server.trim()) servers.add(server.trim());

// Server definitions come from Claude Code's and Copilot's own configs. A missing file counts as empty.
const readMcpServers = (...parts) => {
  const file = join(homedir(), ...parts);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).mcpServers ?? {} : {};
};
const ownServers = tool === 'claude' ? readMcpServers('.claude.json') : readMcpServers('.copilot', 'mcp-config.json');
const allServers = { ...(tool === 'claude' ? readMcpServers('.copilot', 'mcp-config.json') : readMcpServers('.claude.json')), ...ownServers };
const unknown = [...servers].filter((server) => !allServers[server]);
if (unknown.length) {
  console.error(`not defined in ~/.claude.json or ~/.copilot/mcp-config.json: ${unknown.join(', ')}`);
  process.exit(1);
}

const shellQuote = (text) => `'${text.replaceAll("'", `'\\''`)}'`;
let command;
if (tool === 'claude') {
  // Claude says "stdio" where Copilot says "local", and rejects Copilot's "tools" list.
  const picked = {};
  for (const server of servers) {
    const { tools, ...definition } = allServers[server];
    picked[server] = definition.type === 'local' ? { ...definition, type: 'stdio' } : definition;
  }
  // The file can hold API keys from the server definitions, so only the owner reads it. Uninstall removes it.
  const dir = join(homedir(), '.agent-room', 'data', 'team');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const config = join(dir, `${name}.mcp.json`);
  writeFileSync(config, JSON.stringify({ mcpServers: picked }), { mode: 0o600 });
  // A new Terminal window starts from Terminal's own environment, so it carries none of this session's CLAUDE* variables.
  command = `cd ${shellQuote(folder)} && claude --add-dir ${shellQuote(workspace)} --append-system-prompt-file ${shellQuote(roleFile)} --mcp-config ${shellQuote(config)} --strict-mcp-config --permission-mode auto ${shellQuote(prompt)}`;
} else {
  // Copilot adds a server defined only in Claude's config with --additional-mcp-config.
  const extra = [...servers].filter((server) => !ownServers[server]);
  const addServersFlag = extra.length ? `--additional-mcp-config ${shellQuote(JSON.stringify({ mcpServers: Object.fromEntries(extra.map((server) => [server, { ...allServers[server], tools: ['*'] }])) }))}` : '';
  const disableFlags = Object.keys(ownServers).filter((server) => !servers.has(server)).map((server) => `--disable-mcp-server ${shellQuote(server)}`);
  command = `cd ${shellQuote(folder)} && copilot --add-dir ${shellQuote(workspace)} --agent ${shellQuote(role)} --disable-builtin-mcps ${addServersFlag} ${disableFlags.join(' ')} --mode autopilot --allow-all -i ${shellQuote(prompt)}`;
}

if (process.platform !== 'darwin') {
  console.log(`Run this in a new terminal for ${name}:\n${command}`);
  process.exit(0);
}
const script = command.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const opened = execFileSync('osascript', ['-e', `tell application "Terminal" to do script "${script}"`], { encoding: 'utf8' });
const id = opened.match(/window id (\d+)/)?.[1];
if (id) execFileSync('osascript', ['-e', `tell application "Terminal" to set custom title of tab 1 of window id ${id} to "${name}"`]);
console.log(`${name}: window ${id ?? 'unknown'}, servers ${[...servers].join(', ')}`);
