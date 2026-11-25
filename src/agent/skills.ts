// A skill belongs to its agent's harness, which lists and installs skills its own way. The room only carries the
// folder from one agent to another.

import fs from 'node:fs';
import path from 'node:path';
import { Refused, SLOW_TIMEOUT_MS, rpc } from '../rpc.ts';
import { newId } from '../room.ts';
import { skillFolderSchema } from '../schema.ts';
import { setOwnItem } from './hosting.ts';
import { cardAddress, agentName, room } from './index.ts';
import { postEvent } from './messages.ts';
import type { Agent, SkillFiles } from './index.ts';
import type { Skill } from '../room.ts';

export function findRoomSkill(agent: Agent, ref: string) {
  const found = Object.values(room(agent).skills).find((skill) => skill.id === ref || skill.name === ref);
  if (!found) throw new Error(`no skill "${ref}" in the room. view-room part=skills lists them.`);
  return found;
}

/** Only the name and description go to the room; the files stay here until another agent asks for them. */
export async function shareSkill(agent: Agent, name: string) {
  const skills = agent.harness.list();
  const had = skills.find((skill) => skill.name === name);
  if (!had) throw new Error(`your program has no skill called "${name}". It has: ${skills.map((skill) => skill.name).join(', ') || 'none'}`);
  const skill: Skill = { id: newId(), agentId: agent.me.id, name, description: had.description };
  await setOwnItem(agent, 'skills', skill);
  await postEvent(agent, `shared the skill "${name}". use-skill takes it into your program.`, 'updated');
  return skill;
}

/** Base64 contents keyed by path inside the folder. */
function packFolder(folder: string) {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(folder, full).split(path.sep).join('/')] = fs.readFileSync(full).toString('base64');
  }
  return files;
}

const isInsideFolder = (file: string) => !file.startsWith('/') && !file.includes('\\') && file.split('/').every((part) => part && part !== '.' && part !== '..');

function unpackFiles(files: Record<string, string>): SkillFiles {
  const outside = Object.keys(files).find((file) => !isInsideFolder(file));
  if (outside) throw new Refused(`the skill has a file outside its folder: ${outside}`);
  return Object.fromEntries(Object.entries(files).map(([file, data]) => [file, Buffer.from(data, 'base64')]));
}

export function getSkillFiles(agent: Agent, skillId: string) {
  const skill = room(agent).skills[skillId];
  if (!skill || skill.agentId !== agent.me.id) throw new Refused('this agent does not share that skill in its room');
  const had = agent.harness.list().find((one) => one.name === skill.name);
  if (!had) throw new Refused(`${agent.me.name}'s program no longer has the skill "${skill.name}"`);
  return { files: packFolder(had.folder) };
}

/** Installs a room skill into this agent's harness, which then uses it as one of its own. */
export async function useSkill(agent: Agent, ref: string) {
  const skill = findRoomSkill(agent, ref);
  if (skill.agentId === agent.me.id) throw new Error(`"${skill.name}" is your own skill`);
  // Taking it in would replace that skill's folder, and leaving the room would delete it.
  if (agent.harness.list().some((had) => had.name === skill.name)) throw new Error(`your program already has a skill called "${skill.name}"`);
  const owner = room(agent).agents[skill.agentId];
  const gone = new Error(`${agentName(agent, skill.agentId)}, who shares "${skill.name}", has left the room, so the skill cannot be taken.`);
  if (!owner || owner.left) throw gone;
  const answer = await rpc(cardAddress(owner), 'GetSkillFiles', { roomId: room(agent).id, skillId: skill.id }, { key: agent.key, ms: SLOW_TIMEOUT_MS }).catch((error) => {
    throw error instanceof Refused ? error : gone;
  });
  const ready = agent.harness.use(skill.name, unpackFiles(skillFolderSchema.parse(answer).files));
  agent.usedSkills.add(skill.name);
  return { skill, ready };
}
