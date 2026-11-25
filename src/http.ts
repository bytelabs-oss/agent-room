// The agent's address. It always listens on 127.0.0.1, where it answers everything, but only to requests addressed
// to this machine. In a shared room it also listens on the tailnet address, where it answers only other agents.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { json } from 'node:stream/consumers';
import { Refused } from './rpc.ts';
import { tailnetAddress } from './tailscale.ts';
import { z } from 'zod';

const FIRST_PORT = Number(process.env.AGENT_ROOM_PORT ?? 4780);
const LAST_PORT = 65_535;

export type Method = { input: z.ZodType; handle: (params: any, auth: { key: string | null }) => any };
export type Routes = { get: Record<string, () => any>, post: Record<string, { input: z.ZodType; handle: (body: any) => any }> };
type Handlers = { card: () => object | null, methods: Record<string, Method>, routes: Routes, page: string };

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function sendJson(response: http.ServerResponse, body: any, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Requiring JSON keeps other websites from posting to the agent. */
async function readJson(request: http.IncomingMessage): Promise<any> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('send JSON');
  return json(request).catch(() => {
    throw new Error('send JSON');
  });
}

const bearerToken = (request: http.IncomingMessage) => request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? null;

export function createHttp({ card, methods, routes, page }: Handlers) {
  const servers: http.Server[] = [];
  let port = 0;

  /** Returns false for anything that is not the card or JSON-RPC. */
  async function handlePeerRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    if (request.method === 'GET' && request.url === '/.well-known/agent-card.json') {
      const one = card();
      sendJson(response, one ?? { error: 'this session is not in a room' }, one ? 200 : 404);
      return true;
    }
    if (request.method !== 'POST' || request.url !== '/') return false;
    const { id = null, method, params } = await readJson(request);
    const answer = (rest: object) => sendJson(response, { jsonrpc: '2.0', id, ...rest });
    if (!Object.hasOwn(methods, method ?? '')) {
      answer({ error: { code: -32601, message: `no method "${method}"` } });
      return true;
    }
    try {
      answer({ result: await methods[method].handle(methods[method].input.parse(params), { key: bearerToken(request) }) });
    } catch (error) {
      if (error instanceof Refused) answer({ error: { code: -32000, message: error.message, data: error.reason } });
      else if (error instanceof z.ZodError) answer({ error: { code: -32602, message: 'the call is not in the shape this agent takes' } });
      else {
        console.error(error);
        answer({ error: { code: -32603, message: 'the agent failed to handle the call' } });
      }
    }
    return true;
  }

  function servePage(request: http.IncomingMessage, response: http.ServerResponse) {
    if (!fs.existsSync(path.join(page, 'index.html'))) return void response.writeHead(503).end('The web app is not built: run npm run build:web.');
    const asked = path.join(page, path.normalize(new URL(request.url ?? '/', 'http://localhost').pathname));
    const file = asked.startsWith(page + path.sep) && fs.existsSync(asked) && fs.statSync(asked).isFile() ? asked : path.join(page, 'index.html');
    response.setHeader('content-type', CONTENT_TYPES[path.extname(file) as keyof typeof CONTENT_TYPES] ?? 'application/octet-stream');
    response.end(fs.readFileSync(file));
  }

  async function handleLocalRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '')) return sendJson(response, { error: 'not for this host' }, 403);
    if (await handlePeerRequest(request, response)) return;
    const route = request.url ?? '';
    if (request.method !== 'POST') return Object.hasOwn(routes.get, route) ? sendJson(response, await routes.get[route]()) : servePage(request, response);
    const body = await readJson(request);
    if (!Object.hasOwn(routes.post, route)) return sendJson(response, { error: 'not found' }, 404);
    const { input, handle } = routes.post[route];
    sendJson(response, (await handle(input.parse(body))) ?? {});
  }

  const createServer = (handle: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<unknown>) =>
    http.createServer((request, response) => {
      // A caller that kept a socket open to an agent that has since stopped would fail its next call on it.
      response.shouldKeepAlive = false;
      handle(request, response)
        .then((done) => done === false && sendJson(response, { error: 'not found' }, 404))
        .catch((error) => response.headersSent || sendJson(response, { error: error instanceof Refused ? error.message : `bad request: ${error.message}` }, error instanceof Refused ? 409 : 400));
    });

  const listenOn = (server: http.Server, at: number, host: string): Promise<boolean> =>
    new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(at, host, () => resolve(servers.push(server) > 0));
    });

  return {
    /** Listens on the first free port on 127.0.0.1. */
    async listen() {
      for (let at = FIRST_PORT; at <= LAST_PORT; at++) {
        if (await listenOn(createServer(handleLocalRequest), at, '127.0.0.1')) {
          port = at;
          return { port, url: `http://127.0.0.1:${port}` };
        }
      }
      throw new Error(`no free port from ${FIRST_PORT} up`);
    },
    /** Listens on the tailnet address too, at the same port, for other agents only. */
    async share(at: number) {
      const tailnet = tailnetAddress();
      if (!tailnet) throw new Error('a shared room is reached over Tailscale, and Tailscale is not running or not signed in on this machine. Open Tailscale, sign in, and try again.');
      if (!(await listenOn(createServer(handlePeerRequest), at, tailnet))) throw new Error(`port ${at} is taken on this machine's Tailscale address. Open a new session and try again.`);
      return `http://${tailnet}:${at}`;
    },
    stop() {
      for (const server of servers.splice(0)) {
        server.close();
        server.closeIdleConnections();
      }
    },
  };
}
