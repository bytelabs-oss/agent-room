import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { configure } from '../src/install/configure.ts';

/** Every file and folder under a home, with each file's text. The CLI removes ~/.agent-room itself. */
function tree(home: string) {
  return readdirSync(home, { recursive: true, withFileTypes: true })
    .map((entry) => path.relative(home, path.join(entry.parentPath, entry.name)))
    .filter((inside) => !inside.startsWith('.agent-room'))
    .sort()
    .map((inside) => {
      const full = path.join(home, inside);
      return readdirSync(path.dirname(full), { withFileTypes: true }).find((one) => one.name === path.basename(full))?.isFile() ? `${inside}: ${readFileSync(full, 'utf8')}` : inside;
    });
}

test('uninstall leaves the home exactly as install found it', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-room-home-'));
  const files: Record<string, string> = {
    '.claude.json': `${JSON.stringify({ mcpServers: { other: {} } }, null, 2)}\n`,
    '.claude/settings.json': `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }, null, 2)}\n`,
    '.codex/config.toml': 'model = "x"\n',
    '.copilot/mcp-config.json': `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
    writeFileSync(path.join(home, file), text);
  }
  const before = tree(home);

  configure(home, true, { extras: ['room-team'], env: {} });
  assert.match(readFileSync(path.join(home, '.claude.json'), 'utf8'), /"room"/);
  assert.match(readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.room\]/);
  assert.ok(existsSync(path.join(home, '.copilot', 'skills', 'room-team', 'SKILL.md')));
  assert.ok(existsSync(path.join(home, '.copilot', 'extensions', 'room', 'extension.mjs')));

  configure(home, false, { env: {} });
  assert.deepEqual(tree(home), before);
});

test('install follows a harness that its own setting moved to another folder', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-room-home-'));
  const moved = path.join(home, 'personal');
  mkdirSync(moved);
  writeFileSync(path.join(moved, 'mcp-config.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  const before = tree(home);

  configure(home, true, { env: { COPILOT_HOME: moved } });
  assert.match(readFileSync(path.join(moved, 'mcp-config.json'), 'utf8'), /"room"/);
  assert.equal(existsSync(path.join(home, '.copilot')), false);

  configure(home, false, { env: { COPILOT_HOME: moved } });
  assert.deepEqual(tree(home), before);
});
