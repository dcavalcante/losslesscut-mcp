import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nodeExpected = (await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim();
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const npmExpected = packageJson.engines.npm;
const npmActual = process.env.npm_config_user_agent?.match(/\bnpm\/([0-9.]+)/)?.[1];

assert.equal(process.versions.node, nodeExpected, `Expected Node.js ${nodeExpected}, found ${process.versions.node}`);
assert.ok(npmActual, 'Run this check through npm so npm_config_user_agent is available.');
assert.equal(npmActual, npmExpected, `Expected npm ${npmExpected}, found ${npmActual}`);
