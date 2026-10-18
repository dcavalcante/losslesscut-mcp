import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { execFile as execFileCallback } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executable = process.env['LOSSLESSCUT_EXECUTABLE'];
assert.ok(executable, 'Set LOSSLESSCUT_EXECUTABLE to the real LosslessCut executable.');
assert.equal(process.platform, 'linux', 'This acceptance harness has only been validated on Linux.');

const workspace = await mkdtemp(join(tmpdir(), 'losslesscut-mcp-acceptance-'));
const inputDir = join(workspace, 'input');
const firstOutputDir = join(workspace, 'output-success');
const secondOutputDir = join(workspace, 'output-confirmation');
const configDir = join(workspace, 'config');
const userDataDir = join(workspace, 'userdata');
const secondUserDataDir = join(workspace, 'userdata-confirmation');
const logsDir = join(workspace, 'logs');
await Promise.all([inputDir, firstOutputDir, secondOutputDir, configDir, userDataDir, secondUserDataDir, logsDir].map(dir => mkdir(dir, { recursive: true })));
const mediaPath = join(inputDir, 'fixture.mp4');
const projectPath = join(inputDir, 'fixture.llc');
async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolvePromise, reject) => server.close(error => (error ? reject(error) : resolvePromise())));
  return address.port;
}

async function waitForApi(app, port, appLogPath, appErrPath) {
  const deadline = Date.now() + 30_000;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    if (app.exitCode != null) throw new Error(`LosslessCut exited during startup with ${app.exitCode}; inspect ${appLogPath} and ${appErrPath}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { host: `127.0.0.1:${port}` }, signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (response.status === 200 && body.trim() === 'See https://losslesscut.app/') return;
      lastError = `HTTP ${response.status}: ${body}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  throw new Error(`LosslessCut API did not become ready: ${lastError}`);
}

async function waitForRendererReady(app, appLogPath) {
  // Upstream starts HTTP before creating the renderer. App.tsx reports this
  // FFprobe startup check only after its renderer-ready IPC effect has run.
  const marker = 'ffprobe -v 0 -of json -show_program_version';
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (app.exitCode != null) throw new Error(`LosslessCut exited before renderer readiness; inspect ${appLogPath}`);
    if ((await readFile(appLogPath, 'utf8').catch(() => '')).includes(marker)) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`LosslessCut API was ready but the renderer readiness marker did not appear in ${appLogPath}`);
}

async function startLosslessCut({ port, outputDirectory, userDir, exportConfirmEnabled, label }) {
  const appLogPath = join(logsDir, `losslesscut-${label}.log`);
  const appErrPath = join(logsDir, `losslesscut-${label}.stderr.log`);
  const settings = {
    exportConfirmEnabled,
    enableCustomOutDir: true,
    recentCustomOutDirs: [outputDirectory],
    enableOverwriteOutput: false,
    autoMerge: false,
    invertCutSegments: false,
    segmentsToChaptersOnly: false,
    enableAskForFileOpenAction: false,
    hideNotifications: 'all',
    hideOsNotifications: 'all',
    enableUpdateCheck: false,
    askBeforeClose: true,
    cleanupChoices: { trashTmpFiles: true, askForCleanup: false, closeFile: false, cleanupAfterExport: false },
  };
  const stdout = createWriteStream(appLogPath, { flags: 'a' });
  const stderr = createWriteStream(appErrPath, { flags: 'a' });
  const app = spawn(executable, [`--user-data-dir=${userDir}`, '--http-api', String(port), '--config-dir', configDir, '--settings-json', JSON.stringify(settings)], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(stdout);
  app.stderr.pipe(stderr);
  app.once('exit', () => {
    stdout.end();
    stderr.end();
  });
  await waitForApi(app, port, appLogPath, appErrPath);
  await waitForRendererReady(app, appLogPath);
  app.logPath = appLogPath;
  app.stderrLogPath = appErrPath;
  return app;
}

async function probeSameProfileSecondLaunch(primaryPort) {
  const port = await availablePort();
  const stdoutPath = join(logsDir, 'losslesscut-same-profile-second.log');
  const stderrPath = join(logsDir, 'losslesscut-same-profile-second.stderr.log');
  const stdout = createWriteStream(stdoutPath, { flags: 'a' });
  const stderr = createWriteStream(stderrPath, { flags: 'a' });
  const second = spawn(executable, [`--user-data-dir=${userDataDir}`, '--http-api', String(port), '--config-dir', configDir], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  second.stdout.pipe(stdout);
  second.stderr.pipe(stderr);
  second.once('exit', () => {
    stdout.end();
    stderr.end();
  });

  const deadline = Date.now() + 8_000;
  let secondApiResponded = false;
  while (Date.now() < deadline && second.exitCode == null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { host: `127.0.0.1:${port}` }, signal: AbortSignal.timeout(250) });
      secondApiResponded = response.status === 200;
      if (secondApiResponded) break;
    } catch {
      // A refused connection is the expected outcome when the second launch
      // hands off to the primary process and exits without binding this port.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }

  const secondExit = await stopOwnedProcess(second);
  const primaryStillReady = await fetch(`http://127.0.0.1:${primaryPort}/`, { headers: { host: `127.0.0.1:${primaryPort}` } }).then(
    response => response.status === 200,
    () => false,
  );
  assert.equal(primaryStillReady, true, 'The primary isolated session must remain ready after a same-profile launch probe.');
  assert.equal(secondApiResponded, false, 'A duplicate same-profile launch must not create a second API session.');
  assert.ok(secondExit.exitCode != null || secondExit.signal != null, 'The duplicate probe process must be reaped.');
  return { secondPid: second.pid, secondExit, secondApiResponded, primaryStillReady, stdoutPath, stderrPath };
}

async function stopOwnedProcess(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return { exitCode: child?.exitCode ?? null, signal: child?.signalCode ?? null };
  const exited = new Promise(resolvePromise => child.once('exit', (exitCode, signal) => resolvePromise({ exitCode, signal })));
  child.kill('SIGTERM');
  const result = await Promise.race([exited, new Promise(resolvePromise => setTimeout(() => resolvePromise('timeout'), 5_000))]);
  if (result === 'timeout') {
    child.kill('SIGKILL');
    return await exited;
  }
  return result;
}

function mcpClient(port, exportTimeoutMs) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'dist', 'index.js')],
    env: {
      ...process.env,
      LOSSLESSCUT_API_PORT: String(port),
      LOSSLESSCUT_CONFIG_DIR: configDir,
      LOSSLESSCUT_ALLOWED_ROOTS: workspace,
      LOSSLESSCUT_EXPORT_TIMEOUT_MS: String(exportTimeoutMs),
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'losslesscut-mcp-acceptance', version: '0.1.0' });
  return { client, transport, connect: () => client.connect(transport) };
}

async function assertMedia(filePath) {
  const { stdout } = await execFile(process.env['FFPROBE_PATH'] || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', filePath], {
    timeout: 10_000,
    maxBuffer: 1_000_000,
  });
  const data = JSON.parse(stdout);
  const types = new Set(data.streams.map(stream => stream.codec_type));
  assert.ok(types.has('video'));
  assert.ok(types.has('audio'));
  assert.ok(Number(data.format.duration) > 1.5 && Number(data.format.duration) < 2.2);
  await execFile(process.env['FFMPEG_PATH'] || 'ffmpeg', ['-v', 'error', '-i', filePath, '-f', 'null', '-'], { timeout: 10_000, maxBuffer: 1_000_000 });
}

function nativeAction(port, action, body) {
  return new Promise((resolvePromise, reject) => {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/action/${action}`,
        method: 'POST',
        setHost: false,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(serialized === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) }),
        },
        timeout: 5_000,
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('end', () => resolvePromise({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    request.once('timeout', () => request.destroy(new Error(`LosslessCut action timed out: ${action}`)));
    request.once('error', reject);
    request.end(serialized);
  });
}

let app;
let confirmationApp;
let mcp;
let confirmationMcp;
let firstExitCode;
let secondExitCode;
let firstAppPid;
let secondAppPid;
let mcpPid;
let confirmationMcpPid;
let firstAppLogPath;
let firstAppErrPath;
let secondAppLogPath;
let secondAppErrPath;
let lifecycleProbe;
try {
  await execFile(
    process.env['FFMPEG_PATH'] || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=25:duration=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=523:sample_rate=48000:duration=12',
      '-shortest',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '25',
      '-keyint_min',
      '25',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      mediaPath,
    ],
    { timeout: 30_000 },
  );
  await writeFile(
    projectPath,
    `${JSON.stringify(
      {
        version: 2,
        mediaFileName: 'fixture.mp4',
        cutSegments: [
          { start: 1, end: 3, name: 'keep-1', selected: true },
          { start: 5, end: 7, name: 'keep-2', selected: true },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const sourceHashes = await execFile('sha256sum', [mediaPath, projectPath]);
  const port = await availablePort();
  app = await startLosslessCut({ port, outputDirectory: firstOutputDir, userDir: userDataDir, exportConfirmEnabled: false, label: 'success' });
  firstAppPid = app.pid;
  firstAppLogPath = app.logPath;
  firstAppErrPath = app.stderrLogPath;
  lifecycleProbe = await probeSameProfileSecondLaunch(port);
  mcp = mcpClient(port, 30_000);
  await mcp.connect();
  mcpPid = mcp.transport.pid;

  const available = await mcp.client.callTool({ name: 'losslesscut_api_status', arguments: {} });
  assert.equal(available.structuredContent.reachable, true);
  assert.equal(available.structuredContent.securityGuard, true, JSON.stringify(available.structuredContent));
  const denied = await mcp.client.callTool({
    name: 'losslesscut_open_project',
    arguments: { projectPath: '/etc/passwd', outputDirectory: firstOutputDir },
  });
  assert.equal(denied.structuredContent.status, 'error');
  assert.equal(denied.structuredContent.code, 'path_not_authorized');

  const exported = await mcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: firstOutputDir } });
  assert.equal(exported.structuredContent.status, 'verified', JSON.stringify(exported.structuredContent));
  assert.equal(exported.structuredContent.outputs.length, 2);
  for (const output of exported.structuredContent.outputs) await assertMedia(output.path);
  assert.equal((await execFile('sha256sum', [mediaPath, projectPath])).stdout, sourceHashes.stdout);
  const seekProbe = await nativeAction(port, 'goToTimecodeDirect', { time: '00:02' });
  const invalidActionProbe = await nativeAction(port, 'losslesscutMcpInvalidAction');
  assert.equal(seekProbe.status, 200);
  assert.equal(invalidActionProbe.status, 200);
  assert.equal(invalidActionProbe.body, '');

  await mcp.client.close();
  await mcp.transport.close();
  firstExitCode = await stopOwnedProcess(app);
  app = undefined;

  const secondPort = await availablePort();
  confirmationApp = await startLosslessCut({ port: secondPort, outputDirectory: secondOutputDir, userDir: secondUserDataDir, exportConfirmEnabled: true, label: 'confirmation' });
  secondAppPid = confirmationApp.pid;
  secondAppLogPath = confirmationApp.logPath;
  secondAppErrPath = confirmationApp.stderrLogPath;
  confirmationMcp = mcpClient(secondPort, 1_000);
  await confirmationMcp.connect();
  confirmationMcpPid = confirmationMcp.transport.pid;
  const uncertain = await confirmationMcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: secondOutputDir } });
  assert.equal(uncertain.structuredContent.status, 'uncertain', JSON.stringify(uncertain.structuredContent));
  const remaining = await readdir(secondOutputDir);
  assert.ok(!remaining.some(name => name.endsWith('.mp4')), 'No media output should exist without export-start confirmation.');

  secondExitCode = await stopOwnedProcess(confirmationApp);
  confirmationApp = undefined;
  const unavailable = await confirmationMcp.client.callTool({ name: 'losslesscut_api_status', arguments: {} });
  assert.equal(unavailable.structuredContent.reachable, false);
  await confirmationMcp.client.close();
  await confirmationMcp.transport.close();

  const report = {
    status: 'passed',
    applicationPids: [firstAppPid, secondAppPid],
    mcpPids: [mcpPid, confirmationMcpPid],
    firstApplicationExit: firstExitCode,
    confirmationApplicationExit: secondExitCode,
    applicationLogs: [firstAppLogPath, secondAppLogPath],
    stderrLogs: [firstAppErrPath, secondAppErrPath],
    isolatedProfile: { configDir, userDataDir },
    sameProfileSecondLaunch: lifecycleProbe,
    evidenceDirectory: workspace,
    exported: exported.structuredContent.outputs,
    actionProbes: {
      seek: { ...seekProbe, resultObserved: false },
      invalidAction: { ...invalidActionProbe, errorReportedByHttp: false },
    },
    confirmationPath: uncertain.structuredContent,
  };
  await writeFile(join(logsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all([stopOwnedProcess(app), stopOwnedProcess(confirmationApp)]);
  await Promise.all([mcp ? mcp.client.close().catch(() => undefined) : Promise.resolve(), confirmationMcp ? confirmationMcp.client.close().catch(() => undefined) : Promise.resolve()]);
  if (process.env['LOSSLESSCUT_KEEP_TEST_OUTPUT'] !== '1') await rm(workspace, { recursive: true, force: true });
  else console.log(`Acceptance evidence retained at ${workspace}`);
}
