import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IntegrationError } from '../../dist/integration/errors.js';
import { exportProjectWorkflow } from '../../dist/integration/workflows.js';

test('late completion after timeout quarantines the API session before another export can subscribe', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'losslesscut-mcp-late-event-'));
  const outputDirectory = join(workspace, 'output');
  const configDir = join(workspace, 'config');
  await Promise.all([mkdir(outputDirectory), mkdir(configDir)]);
  const mediaPath = join(workspace, 'source.mp4');
  const projectPath = join(workspace, 'project.llc');
  await writeFile(mediaPath, 'disposable placeholder');
  await writeFile(projectPath, JSON.stringify({ version: 2, mediaFileName: 'source.mp4', cutSegments: [{ start: 1, end: 2, name: 'clip', selected: true }] }));
  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      enableOverwriteOutput: false,
      enableCustomOutDir: true,
      autoMerge: false,
      invertCutSegments: false,
      segmentsToChaptersOnly: false,
      enableAskForFileOpenAction: false,
      askBeforeClose: true,
      storeProjectInWorkingDir: true,
      cleanupChoices: { cleanupAfterExport: false },
      recentCustomOutDirs: [outputDirectory],
    }),
  );

  let exportActions = 0;
  let lateCompletionDelivered = false;
  let eventWaiters = 0;
  const api = {
    port: 8080,
    requireRequestGuard: async () => undefined,
    action: async action => {
      if (action === 'export') {
        exportActions += 1;
        await writeFile(join(outputDirectory, 'partial.mp4'), 'truncated export');
        return;
      }
    },
    awaitExportStart: signal =>
      new Promise((resolvePromise, reject) => {
        eventWaiters += 1;
        const timeout = setTimeout(() => resolvePromise({ eventName: 'export-start', path: mediaPath }), 10);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(new IntegrationError('action_outcome_uncertain', 'event wait aborted', 'uncertain'));
          },
          { once: true },
        );
      }),
    awaitExportComplete: signal =>
      new Promise((resolvePromise, reject) => {
        eventWaiters += 1;
        setTimeout(() => {
          lateCompletionDelivered = true;
          resolvePromise({ eventName: 'export-complete', paths: [] });
        }, 250);
        signal.addEventListener(
          'abort',
          () => {
            reject(new IntegrationError('action_outcome_uncertain', 'event wait aborted', 'uncertain'));
          },
          { once: true },
        );
      }),
  };
  const config = { apiPort: 8080, apiTimeoutMs: 1_000, exportTimeoutMs: 100, allowedRoots: [workspace], configDir, ffprobePath: 'ffprobe' };
  try {
    let outcome;
    try {
      await exportProjectWorkflow(config, api, projectPath, outputDirectory);
      assert.fail('Timed out native operation must not be reported as success.');
    } catch (error) {
      assert.ok(error instanceof IntegrationError);
      assert.equal(error.code, 'export_outcome_uncertain');
      assert.equal(error.outcome, 'uncertain');
      outcome = error;
    }
    assert.deepEqual(
      outcome.details.observedArtifacts.map(artifact => ({ path: artifact.path, readableMedia: artifact.readableMedia })),
      [{ path: join(outputDirectory, 'partial.mp4'), readableMedia: false }],
    );
    await new Promise(resolvePromise => setTimeout(resolvePromise, 350));
    assert.equal(lateCompletionDelivered, true, 'The simulated native completion must arrive after the caller timed out.');
    await assert.rejects(exportProjectWorkflow(config, api, projectPath, outputDirectory), error => error instanceof IntegrationError && error.code === 'export_session_quarantined');
    assert.equal(exportActions, 1, 'A late completion must not authorize or trigger a second export.');
    assert.equal(eventWaiters, 2, 'The quarantined retry must not subscribe to event streams again.');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
