import { EXTENSION } from './room.ts';

export const A2A_VERSION = '1.0';
export const TIMEOUT_MS = 3000;
export const QUICK_TIMEOUT_MS = 1500;
export const SLOW_TIMEOUT_MS = 10_000;
export const CHANNEL_TIMEOUT_MS = 5000;

type Reason = 'removed' | 'key' | { host: string } | undefined;

export class Refused extends Error {
  readonly reason: Reason;
  constructor(message: string, reason?: Reason) {
    super(message);
    this.reason = reason;
  }
}

/** Throws Refused when the other side answers no, and the network error when nobody answers. */
export async function rpc(url: string, method: string, params: object, { key, ms = TIMEOUT_MS }: { key?: string | null; ms?: number } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'A2A-Version': A2A_VERSION, 'A2A-Extensions': EXTENSION };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(ms) });
  const answer = await response.json();
  if (answer.error) throw new Refused(answer.error.message, answer.error.data);
  return answer.result;
}

/** An agent's A2A card, or null when nobody answers at that address. */
export const fetchCard = (address: string) =>
  fetch(`${address}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(QUICK_TIMEOUT_MS) }).then((response) => response.json(), () => null);

export async function postLocal(url: string, route: string, body: object, ms = TIMEOUT_MS) {
  const response = await fetch(url + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const answer = await response.json();
  if (!response.ok) throw new Refused(answer.error ?? `status ${response.status}`);
  return answer;
}
