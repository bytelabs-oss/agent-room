// Tailscale is a private network between the machines signed in to it. Shared rooms are reached over it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SLOW_TIMEOUT_MS } from './rpc.ts';

// Tailscale gives every machine an address in 100.64.0.0/10.
const TAILNET_RANGE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/** Undefined when Tailscale is not up. */
export function tailnetAddress() {
  return Object.values(os.networkInterfaces())
    .flat()
    .find((one) => one?.family === 'IPv4' && TAILNET_RANGE.test(one.address))?.address;
}

export const CONFIG_FILE = path.join(import.meta.dirname, '..', 'config.json');
const API = 'https://api.tailscale.com/api/v2/tailnet/-/user-invites';

const apiToken = (): string | undefined => (fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).tailscaleApiKey : undefined);

export const canInvite = () => Boolean(apiToken());

async function callInvitesApi(failure: string, body?: object): Promise<any[]> {
  const response = await fetch(API, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${apiToken()}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(SLOW_TIMEOUT_MS),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(answer)) throw new Error(`${failure}: ${answer.message ?? `status ${response.status}`}. The saved token may have expired: npx github:bytelabs-oss/agent-room tailscale-key`);
  return answer;
}

/** Tailscale emails each address an invite to this person's tailnet. */
export async function inviteToNetwork(emails: string[]) {
  const answer = await callInvitesApi('Tailscale would not make the invite', emails.map((email) => ({ role: 'member', email })));
  return answer.map(({ email, inviteUrl }) => ({ email, inviteUrl }));
}

/** Invites nobody has accepted yet, newest first. */
export async function listPendingInvites(): Promise<{ email: string; sentAt: string | null }[]> {
  const answer = await callInvitesApi('Tailscale would not list the invites');
  return answer
    .filter((one) => one.email)
    .map((one) => ({ email: one.email, sentAt: one.lastEmailSentAt ?? null }))
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
}
