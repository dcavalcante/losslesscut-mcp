import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLosslessCutApi } from '../../dist/api-status.js';

test('recognizes the documented LosslessCut API root response', async () => {
  let requestedUrl;
  let requestedOptions;
  const result = await checkLosslessCutApi(async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return new Response('See https://losslesscut.app/', { status: 200 });
  });

  assert.equal(result.reachable, true);
  assert.equal(requestedUrl, 'http://127.0.0.1:8080/');
  assert.equal(requestedOptions.headers.host, '127.0.0.1:8080');
  assert.equal(requestedOptions.redirect, 'manual');
});

test('does not treat an unrelated localhost service as LosslessCut', async () => {
  const result = await checkLosslessCutApi(async () => new Response('OK', { status: 200 }));
  assert.equal(result.reachable, false);
});

test('reports an unavailable loopback API without throwing', async () => {
  const result = await checkLosslessCutApi(async () => {
    throw new Error('connection refused');
  });
  assert.equal(result.reachable, false);
  assert.match(result.detail, /connection refused/);
});
