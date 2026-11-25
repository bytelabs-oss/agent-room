// The shapes of what comes in from outside this process: other agents, channels, the web app and tool calls. They
// check structure only, and keep fields a shape does not name.

import { z } from 'zod';
import { EXTENSION } from './room.ts';

export const uuidSchema = z.uuid();
export const secretSchema = z.string().min(1);
export const nonEmptySchema = z.string().trim().min(1);
export const linesSchema = z.array(z.string().trim().min(1));

// A2A's JSON leaves out a field that holds its default, such as an empty description or no skills.
export const cardSchema = z.looseObject({
  name: nonEmptySchema,
  description: z.string().optional(),
  supportedInterfaces: z.array(z.looseObject({ url: z.url() })).min(1),
  skills: z.array(z.looseObject({ name: z.string() })).optional(),
  capabilities: z.looseObject({ extensions: z.array(z.looseObject({ uri: z.string() })).optional() }).optional(),
});

const metaSchema = z.looseObject({
  where: z.union([z.enum(['board', 'dm']), z.looseObject({ channel: z.string().min(1) })]),
  from: z.union([uuidSchema, z.looseObject({ name: nonEmptySchema, outsideId: z.string().nullish() })]),
  to: z.array(z.string()),
  at: z.iso.datetime(),
  replyTo: uuidSchema.optional(),
  event: z.enum(['joined', 'left', 'updated', 'ended']).optional(),
  requiresResponse: z.boolean().optional(),
});

export const messageSchema = z.looseObject({
  messageId: uuidSchema,
  contextId: uuidSchema,
  role: z.literal('ROLE_USER'),
  parts: z.array(z.looseObject({ text: z.string().optional() })).min(1),
  metadata: z.looseObject({ [EXTENSION]: metaSchema }),
});

export const skillSchema = z.looseObject({ id: uuidSchema, agentId: uuidSchema, name: nonEmptySchema, description: z.string() });

const recordOf = (shape: z.ZodType) => z.record(uuidSchema, shape);
const itemSchema = z.looseObject({ id: uuidSchema, text: z.string().min(1) });
export const roomSchema = z.looseObject({
  id: uuidSchema,
  name: nonEmptySchema,
  hostAgentId: uuidSchema,
  at: z.iso.datetime(),
  ended: z.boolean(),
  goals: recordOf(itemSchema),
  rules: recordOf(itemSchema),
  agents: recordOf(cardSchema),
  skills: recordOf(skillSchema),
  channels: recordOf(z.looseObject({ id: uuidSchema, name: nonEmptySchema, url: z.url(), key: secretSchema })),
});

/** Base64 file contents keyed by path inside the folder. */
export const skillFolderSchema = z.object({ files: z.record(z.string(), z.base64()) });
