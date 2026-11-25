import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, test } from 'node:test';
import { createHttp } from '../src/http.ts';

const http = createHttp({
  card: () => ({ name: 'x' }),
  methods: {},
  routes: { get: { '/state': () => ({ ok: true }) }, post: {} },
  page: '/nonexistent',
});
const { port } = await http.listen();
after(() => http.stop());

const statusFor = (host: string): Promise<number | undefined> => new Promise((resolve) => request({ port, path: '/state', headers: { host } }, (response) => resolve(response.statusCode)).end());

test('local routes answer only requests addressed to this machine', async () => {
  assert.equal(await statusFor(`127.0.0.1:${port}`), 200);
  assert.equal(await statusFor(`localhost:${port}`), 200);
  assert.equal(await statusFor('evil.example'), 403);
});

