import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { linkOf, makeAgent } from './helpers.ts';
import { joinRoom, leaveAndStop, startRoom, syncWithHost } from '../src/agent/membership.ts';
import { shareSkill, useSkill } from '../src/agent/skills.ts';
import { deleteSkill, listSkillsIn, writeSkill } from '../src/programs/skills.ts';
import type { SkillHost } from '../src/agent/index.ts';

/** A harness whose skills are folders under its own `.harness/skills`, as Claude Code's and Codex's are. */
function folderHarness() {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-room-harness-'));
  const skills = path.join('.harness', 'skills');
  const host: SkillHost = {
    list: () => listSkillsIn([path.join(root, skills)]),
    use: (name, files) => `installed in ${writeSkill(root, skills, name, files)}`,
    remove: (name) => deleteSkill(root, skills, name),
  };
  return { root, folder: path.join(root, skills), host };
}

test('a skill shared by one harness is taken into another, files intact, and taken out when the room ends', async () => {
  const [sharer, taker] = [folderHarness(), folderHarness()];
  const review = path.join(sharer.folder, 'code-review');
  mkdirSync(path.join(review, 'scripts'), { recursive: true });
  writeFileSync(path.join(review, 'SKILL.md'), '---\nname: code-review\ndescription: Review a branch.\n---\nReview it.\n');
  const binary = Buffer.from([0, 255, 1, 254]);
  writeFileSync(path.join(review, 'scripts', 'tool.bin'), binary);

  const [host, guest] = [makeAgent(sharer.host), makeAgent(taker.host)];
  await startRoom(host, { room: 'Skills', goal: 'Share a skill', name: 'Host' });
  await joinRoom(guest, { link: linkOf(host), name: 'Guest' });
  await shareSkill(host, 'code-review');
  await syncWithHost(guest);

  const { ready } = await useSkill(guest, 'code-review');
  const taken = path.join(taker.folder, 'code-review');
  assert.match(ready, /installed/);
  assert.equal(readFileSync(path.join(taken, 'SKILL.md'), 'utf8'), readFileSync(path.join(review, 'SKILL.md'), 'utf8'));
  assert.deepEqual(readFileSync(path.join(taken, 'scripts', 'tool.bin')), binary);
  assert.deepEqual(taker.host.list().map((skill) => skill.name), ['code-review']);

  await leaveAndStop(host);
  assert.equal(existsSync(taken), false);
  await leaveAndStop(guest);
});

test('a skill name that would reach outside the skills folder is refused', () => {
  const { root, host } = folderHarness();
  writeFileSync(path.join(root, 'keep.txt'), 'kept');
  assert.throws(() => host.use('..', {}), /not a skill folder name/);
  assert.throws(() => host.use('../..', {}), /not a skill folder name/);
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'kept');
});
