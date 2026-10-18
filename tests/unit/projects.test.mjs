import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../../dist/config.js';
import { loadProject } from '../../dist/integration/projects.js';

test('loads a LosslessCut LLC v2 project and resolves its media within an authorized root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'losslesscut-project-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'clip.mp4'), 'fixture');
  await writeFile(
    join(root, 'edit.llc'),
    `{
    version: 2,
    mediaFileName: 'clip.mp4',
    cutSegments: [
      { start: 1, end: 3, name: 'keep-a', selected: true },
      { start: 5, end: 7, name: 'keep-b', selected: true },
    ],
  }`,
  );

  const project = await loadProject(join(root, 'edit.llc'), readConfig({ LOSSLESSCUT_ALLOWED_ROOTS: root }));
  assert.equal(project.mediaPath, join(root, 'clip.mp4'));
  assert.deepEqual(
    project.selectedSegments.map(({ start, end }) => [start, end]),
    [
      [1, 3],
      [5, 7],
    ],
  );
});

test('rejects a project outside authorized roots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'losslesscut-project-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'losslesscut-project-outside-'));
  t.after(async () => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await writeFile(join(outside, 'clip.mp4'), 'fixture');
  await writeFile(
    join(outside, 'edit.llc'),
    JSON.stringify({
      version: 2,
      mediaFileName: 'clip.mp4',
      cutSegments: [{ start: 1, end: 3, name: 'keep', selected: true }],
    }),
  );
  await assert.rejects(loadProject(join(outside, 'edit.llc'), readConfig({ LOSSLESSCUT_ALLOWED_ROOTS: root })), error => error.code === 'path_not_authorized');
});

test('rejects LLC files whose selected segment has no valid end', async t => {
  const root = await mkdtemp(join(tmpdir(), 'losslesscut-project-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'media'));
  await writeFile(join(root, 'media', 'clip.mp4'), 'fixture');
  await writeFile(
    join(root, 'edit.llc'),
    JSON.stringify({
      version: 2,
      mediaFileName: 'media/clip.mp4',
      cutSegments: [{ start: 4, name: 'invalid', selected: true }],
    }),
  );
  await assert.rejects(loadProject(join(root, 'edit.llc'), readConfig({ LOSSLESSCUT_ALLOWED_ROOTS: root })), error => error.code === 'invalid_project');
});
