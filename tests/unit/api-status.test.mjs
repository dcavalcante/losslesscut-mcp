import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLosslessCutApi } from '../../dist/api-status.js';

test('recognizes the documented LosslessCut API root response', async () => {
  const requests = [];
  const result = await checkLosslessCutApi(async (url, options) => {
    requests.push({ url, options });
    if (options.headers.host !== '127.0.0.1:8080' || options.headers.origin) return new Response('Forbidden', { status: 403 });
    return new Response('See https://losslesscut.app/', { status: 200 });
  });

  assert.equal(result.reachable, true);
  assert.equal(result.securityGuard, true);
  assert.equal(requests[0].url, 'http://127.0.0.1:8080/');
  assert.equal(requests[0].options.headers.host, '127.0.0.1:8080');
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(requests.length, 3);
});

test('does not treat an unrelated localhost service as LosslessCut', async () => {
  const result = await checkLosslessCutApi(async () => new Response('OK', { status: 200 }));
  assert.equal(result.reachable, false);
  assert.equal(result.securityGuard, false);
});

test('reports an unavailable loopback API without throwing', async () => {
  const result = await checkLosslessCutApi(async () => {
    throw new Error('connection refused');
  });
  assert.equal(result.reachable, false);
  assert.equal(result.securityGuard, false);
  assert.match(result.detail, /connection refused/);
});
