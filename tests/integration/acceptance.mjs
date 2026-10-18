import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { execFile as execFileCallback } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LosslessCutProcess } from '../../dist/integration/losslesscut-process.js';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executable = process.env['LOSSLESSCUT_EXECUTABLE'];
assert.ok(executable, 'Set LOSSLESSCUT_EXECUTABLE to the real LosslessCut executable.');
assert.equal(process.platform, 'linux', 'This acceptance harness has only been validated on Linux.');

const workspace = await mkdtemp(join(tmpdir(), 'losslesscut-mcp-acceptance-'));
const inputDir = join(workspace, 'input');
const firstOutputDir = join(workspace, 'output-success');
const secondOutputDir = join(workspace, 'output-confirmation');
const staleOutputDir = join(workspace, 'output-stale');
const crashOutputDir = join(workspace, 'output-crash');
const crossOutputOneDir = join(workspace, 'output-cross-one');
const crossOutputTwoDir = join(workspace, 'output-cross-two');
const privateOutputOneDir = join(workspace, 'output-private-one');
const privateOutputTwoDir = join(workspace, 'output-private-two');
const mcpOwnedDemoOutputDir = join(workspace, 'output-mcp-owned-demo');
const configDir = join(workspace, 'config-owned');
const ordinaryConfigDir = join(workspace, 'config-ordinary');
const confirmationConfigDir = join(workspace, 'config-confirmation');
const crashConfigDir = join(workspace, 'config-crash');
const crossConfigDir = join(workspace, 'config-cross-app');
const crossClientConfigDir = join(workspace, 'config-cross-client');
const privateConfigOneDir = join(workspace, 'config-private-one');
const privateConfigTwoDir = join(workspace, 'config-private-two');
const mcpOwnedDemoConfigDir = join(workspace, 'config-mcp-owned-demo');
const userDataDir = join(workspace, 'userdata');
const secondUserDataDir = join(workspace, 'userdata-confirmation');
const crashUserDataDir = join(workspace, 'userdata-crash');
const crossUserDataDir = join(workspace, 'userdata-cross');
const privateUserDataOneDir = join(workspace, 'userdata-private-one');
const privateUserDataTwoDir = join(workspace, 'userdata-private-two');
const mcpOwnedDemoUserDataDir = join(workspace, 'userdata-mcp-owned-demo');
const ordinaryHomeDir = join(workspace, 'ordinary-home');
const ordinaryOutputDir = join(workspace, 'output-ordinary');
const logsDir = join(workspace, 'logs');
await Promise.all(
  [
    inputDir,
    firstOutputDir,
    secondOutputDir,
    staleOutputDir,
    crashOutputDir,
    crossOutputOneDir,
    crossOutputTwoDir,
    privateOutputOneDir,
    privateOutputTwoDir,
    mcpOwnedDemoOutputDir,
    configDir,
    ordinaryConfigDir,
    confirmationConfigDir,
    crashConfigDir,
    crossConfigDir,
    crossClientConfigDir,
    privateConfigOneDir,
    privateConfigTwoDir,
    mcpOwnedDemoConfigDir,
    userDataDir,
    secondUserDataDir,
    crashUserDataDir,
    crossUserDataDir,
    privateUserDataOneDir,
    privateUserDataTwoDir,
    mcpOwnedDemoUserDataDir,
    ordinaryHomeDir,
    ordinaryOutputDir,
    logsDir,
  ].map(dir => mkdir(dir, { recursive: true })),
);
const mediaPath = join(inputDir, 'fixture.mp4');
const crossMediaPath = join(inputDir, 'fixture-cross.mp4');
let projectPath;
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

async function waitForApi(app, port, appLogPath, appErrPath, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
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

async function startLosslessCut({ port, outputDirectory, configDirectory, userDir, homeDir, exportConfirmEnabled, label, startupTimeoutMs, allowApiStartupFailure = false }) {
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
  const args = [...(userDir ? [`--user-data-dir=${userDir}`] : []), '--http-api', String(port), '--config-dir', configDirectory, '--settings-json', JSON.stringify(settings)];
  const app = spawn(executable, args, {
    cwd: workspace,
    env: { ...process.env, ...(homeDir ? { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, '.config'), XDG_CACHE_HOME: join(homeDir, '.cache') } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(stdout);
  app.stderr.pipe(stderr);
  app.once('exit', () => {
    stdout.end();
    stderr.end();
  });
  app.port = port;
  app.configDirectory = configDirectory;
  app.userDataDirectory = userDir ?? join(homeDir, '.config', 'losslesscut');
  app.logPath = appLogPath;
  app.stderrLogPath = appErrPath;
  try {
    await waitForApi(app, port, appLogPath, appErrPath, startupTimeoutMs);
    await waitForRendererReady(app, appLogPath);
  } catch (error) {
    app.startupError = error instanceof Error ? error.message : String(error);
    if (!allowApiStartupFailure) {
      await stopOwnedProcess(app);
      throw error;
    }
  }
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

function mcpClient(port, exportTimeoutMs, appConfigDir = configDir, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'dist', 'index.js')],
    env: {
      ...process.env,
      LOSSLESSCUT_API_PORT: String(port),
      LOSSLESSCUT_CONFIG_DIR: appConfigDir,
      LOSSLESSCUT_EXECUTABLE: '',
      LOSSLESSCUT_USER_DATA_DIR: '',
      LOSSLESSCUT_ALLOWED_ROOTS: workspace,
      LOSSLESSCUT_EXPORT_TIMEOUT_MS: String(exportTimeoutMs),
      ...extraEnv,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'losslesscut-mcp-acceptance', version: '0.1.0' });
  const stderrPath = join(logsDir, `mcp-${port}.stderr.log`);
  const stderr = createWriteStream(stderrPath, { flags: 'a' });
  transport.stderr?.pipe(stderr);
  transport.onclose = () => stderr.end();
  return { client, transport, stderrPath, connect: () => client.connect(transport) };
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

async function firstFrameHash(filePath, seconds = '0') {
  const { stdout } = await execFile(
    process.env['FFMPEG_PATH'] || 'ffmpeg',
    ['-v', 'error', '-ss', seconds, '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    {
      encoding: 'buffer',
      timeout: 10_000,
      maxBuffer: 1_000_000,
    },
  );
  assert.ok(Buffer.isBuffer(stdout) && stdout.length > 0, `No decoded video frame from ${filePath}`);
  return createHash('sha256').update(stdout).digest('hex');
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

async function nativeAwaitEvent(port, eventName) {
  const response = await fetch(`http://127.0.0.1:${port}/api/await-event/${eventName}`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${port}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  return response.json();
}

let app;
let ownedLifecycle;
let ordinaryApp;
let confirmationApp;
let crashApp;
let sharedApiApp;
let privateAppOne;
let privateAppTwo;
let privateOwnerOne;
let privateOwnerTwo;
let mcp;
let confirmationMcp;
let crashMcp;
let sharedMcpOne;
let sharedMcpTwo;
let privateMcpOne;
let privateMcpTwo;
let mcpOwnedDemoClient;
let firstExitCode;
let secondExitCode;
let firstAppPid;
let ordinaryAppPid;
let secondAppPid;
let mcpPid;
let confirmationMcpPid;
let firstAppLogPath;
let firstAppErrPath;
let ordinaryAppLogPath;
let ordinaryAppErrPath;
let secondAppLogPath;
let secondAppErrPath;
let lifecycleProbe;
let occupiedPortProbe;
let isolationProbe;
let crashProbe;
let staleOutputProbe;
let crossProcessProbe;
let privatePairProbe;
let mcpOwnedDemoProbe;
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
  const sourceHashes = await execFile('sha256sum', [mediaPath]);
  await execFile(
    process.env['FFMPEG_PATH'] || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x90:r=25:d=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:duration=12',
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
      crossMediaPath,
    ],
    { timeout: 30_000 },
  );
  const crossSourceHash = await execFile('sha256sum', [crossMediaPath]);

  // Hold an unrelated loopback service on a port, then launch only a disposable
  // LosslessCut child against it. The harness must never kill the listener.
  const occupiedPort = await availablePort();
  const unrelatedService = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('unrelated-service');
  });
  await new Promise((resolvePromise, reject) => {
    unrelatedService.once('error', reject);
    unrelatedService.listen(occupiedPort, '127.0.0.1', resolvePromise);
  });
  let lifecyclePortFailure;
  try {
    await LosslessCutProcess.start({
      executable,
      port: occupiedPort,
      configDir: join(workspace, 'config-lifecycle-port-conflict'),
      userDataDir: join(workspace, 'userdata-lifecycle-port-conflict'),
      startupTimeoutMs: 1_000,
    });
  } catch (error) {
    lifecyclePortFailure = error instanceof Error ? error.message : String(error);
  }
  assert.match(lifecyclePortFailure, /port .* is unavailable/);
  assert.equal(await fetch(`http://127.0.0.1:${occupiedPort}/`).then(response => response.text()), 'unrelated-service');
  const failedLaunch = await startLosslessCut({
    port: occupiedPort,
    outputDirectory: firstOutputDir,
    configDirectory: join(workspace, 'config-port-conflict'),
    userDir: join(workspace, 'userdata-port-conflict'),
    exportConfirmEnabled: false,
    label: 'port-conflict',
    startupTimeoutMs: 3_000,
    allowApiStartupFailure: true,
  });
  const unrelatedStillBound = await fetch(`http://127.0.0.1:${occupiedPort}/`).then(response => response.text());
  assert.equal(unrelatedStillBound, 'unrelated-service');
  const failedLaunchExit = await stopOwnedProcess(failedLaunch);
  const unrelatedAfterCleanup = await fetch(`http://127.0.0.1:${occupiedPort}/`).then(response => response.text());
  assert.equal(unrelatedAfterCleanup, 'unrelated-service');
  await new Promise((resolvePromise, reject) => unrelatedService.close(error => (error ? reject(error) : resolvePromise())));
  occupiedPortProbe = {
    port: occupiedPort,
    startupError: failedLaunch.startupError,
    appPid: failedLaunch.pid,
    appExit: failedLaunchExit,
    unrelatedServiceSurvivedCleanup: unrelatedAfterCleanup === 'unrelated-service',
    appLogs: failedLaunch.logPath,
    appStderr: failedLaunch.stderrLogPath,
    productLifecyclePreflightError: lifecyclePortFailure,
  };

  // Run a conventional disposable profile (temporary HOME, Electron-selected
  // user-data location) beside the explicit MCP candidate profile.
  const ordinaryPort = await availablePort();
  ordinaryApp = await startLosslessCut({
    port: ordinaryPort,
    outputDirectory: ordinaryOutputDir,
    configDirectory: ordinaryConfigDir,
    homeDir: ordinaryHomeDir,
    exportConfirmEnabled: false,
    label: 'ordinary',
  });
  ordinaryAppPid = ordinaryApp.pid;
  ordinaryAppLogPath = ordinaryApp.logPath;
  ordinaryAppErrPath = ordinaryApp.stderrLogPath;
  const ownedPort = await availablePort();
  const candidateSettings = {
    exportConfirmEnabled: false,
    enableCustomOutDir: true,
    recentCustomOutDirs: [firstOutputDir],
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
  ownedLifecycle = await LosslessCutProcess.start({
    executable,
    port: ownedPort,
    configDir,
    userDataDir,
    startupTimeoutMs: 30_000,
    cwd: workspace,
    stdoutPath: join(logsDir, 'losslesscut-owned-candidate.log'),
    stderrPath: join(logsDir, 'losslesscut-owned-candidate.stderr.log'),
    settings: candidateSettings,
  });
  app = ownedLifecycle.child;
  Object.assign(app, {
    port: ownedPort,
    configDirectory: configDir,
    userDataDirectory: userDataDir,
    logPath: join(logsDir, 'losslesscut-owned-candidate.log'),
    stderrLogPath: join(logsDir, 'losslesscut-owned-candidate.stderr.log'),
  });
  firstAppPid = app.pid;
  firstAppLogPath = app.logPath;
  firstAppErrPath = app.stderrLogPath;
  lifecycleProbe = await probeSameProfileSecondLaunch(ownedPort);
  mcp = mcpClient(ownedPort, 30_000, configDir);
  await mcp.connect();
  mcpPid = mcp.transport.pid;

  const ordinaryMcp = mcpClient(ordinaryPort, 30_000, ordinaryConfigDir);
  await ordinaryMcp.connect();

  const available = await mcp.client.callTool({ name: 'losslesscut_api_status', arguments: {} });
  assert.equal(available.structuredContent.reachable, true);
  assert.equal(available.structuredContent.securityGuard, true, JSON.stringify(available.structuredContent));
  const denied = await mcp.client.callTool({
    name: 'losslesscut_open_project',
    arguments: { projectPath: '/etc/passwd', outputDirectory: firstOutputDir },
  });
  assert.equal(denied.structuredContent.status, 'error');
  assert.equal(denied.structuredContent.code, 'path_not_authorized');

  const mediaInspection = await mcp.client.callTool({ name: 'losslesscut_inspect_media', arguments: { path: mediaPath } });
  assert.equal(mediaInspection.structuredContent.status, 'verified', JSON.stringify(mediaInspection.structuredContent));
  const created = await mcp.client.callTool({
    name: 'losslesscut_create_project',
    arguments: {
      mediaPath,
      destinationPath: join(inputDir, 'mcp-created.llc'),
      segments: [
        { start: 1, end: 3, name: 'keep-1' },
        { start: 5, end: 7, name: 'keep-2' },
      ],
    },
  });
  assert.equal(created.structuredContent.status, 'created', JSON.stringify(created.structuredContent));
  projectPath = created.structuredContent.projectPath;
  const generatedInspection = await mcp.client.callTool({ name: 'losslesscut_inspect_project', arguments: { projectPath } });
  assert.equal(generatedInspection.structuredContent.status, 'verified', JSON.stringify(generatedInspection.structuredContent));
  assert.equal(generatedInspection.structuredContent.segmentCount, 2);
  assert.equal(generatedInspection.structuredContent.segments.filter(segment => segment.selected).length, 2);
  const crossCreated = await mcp.client.callTool({
    name: 'losslesscut_create_project',
    arguments: {
      mediaPath: crossMediaPath,
      destinationPath: join(inputDir, 'mcp-created-cross.llc'),
      segments: [
        { start: 2, end: 4, name: 'cross-blue-a' },
        { start: 8, end: 10, name: 'cross-blue-b' },
      ],
    },
  });
  assert.equal(crossCreated.structuredContent.status, 'created', JSON.stringify(crossCreated.structuredContent));
  const crossProjectPath = crossCreated.structuredContent.projectPath;
  const crossProjectInspection = await mcp.client.callTool({ name: 'losslesscut_inspect_project', arguments: { projectPath: crossProjectPath } });
  assert.equal(crossProjectInspection.structuredContent.status, 'verified', JSON.stringify(crossProjectInspection.structuredContent));
  assert.equal(crossProjectInspection.structuredContent.mediaPath, crossMediaPath);

  const [firstDuplicatePair, secondDuplicatePair] = await Promise.all([
    mcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: firstOutputDir } }),
    mcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: firstOutputDir } }),
  ]);
  const exported = [firstDuplicatePair, secondDuplicatePair].find(result => result.structuredContent.status === 'verified');
  const duplicateExport = [firstDuplicatePair, secondDuplicatePair].find(result => result.structuredContent.code === 'output_directory_not_empty');
  assert.ok(exported, JSON.stringify([firstDuplicatePair.structuredContent, secondDuplicatePair.structuredContent]));
  assert.ok(duplicateExport, JSON.stringify([firstDuplicatePair.structuredContent, secondDuplicatePair.structuredContent]));
  assert.equal(exported.structuredContent.status, 'verified', JSON.stringify(exported.structuredContent));
  assert.equal(exported.structuredContent.outputs.length, 2);
  for (const output of exported.structuredContent.outputs) await assertMedia(output.path);
  assert.equal(duplicateExport.structuredContent.status, 'error');
  assert.equal(duplicateExport.structuredContent.code, 'output_directory_not_empty');
  assert.equal((await readdir(firstOutputDir)).filter(name => name.endsWith('.mp4')).length, 2, 'Repeated request must not start a second export or add outputs.');

  const staleArtifact = join(staleOutputDir, 'stale.txt');
  await writeFile(staleArtifact, 'preserve me');
  const staleHashBefore = await execFile('sha256sum', [staleArtifact]);
  const staleResult = await mcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: staleOutputDir } });
  assert.equal(staleResult.structuredContent.status, 'error');
  assert.equal(staleResult.structuredContent.code, 'output_directory_not_empty');
  assert.equal((await execFile('sha256sum', [staleArtifact])).stdout, staleHashBefore.stdout, 'Stale output must be preserved byte-for-byte.');
  staleOutputProbe = { result: staleResult.structuredContent, artifact: staleArtifact, preserved: true };
  const ordinaryExport = await ordinaryMcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: ordinaryOutputDir } });
  assert.equal(ordinaryExport.structuredContent.status, 'verified', JSON.stringify(ordinaryExport.structuredContent));
  assert.equal(ordinaryExport.structuredContent.outputs.length, 2);
  for (const output of ordinaryExport.structuredContent.outputs) await assertMedia(output.path);
  assert.ok(exported.structuredContent.outputs.every(output => output.path.startsWith(`${firstOutputDir}/`)));
  assert.ok(ordinaryExport.structuredContent.outputs.every(output => output.path.startsWith(`${ordinaryOutputDir}/`)));
  assert.notDeepEqual(
    exported.structuredContent.outputs.map(output => output.path),
    ordinaryExport.structuredContent.outputs.map(output => output.path),
  );
  assert.equal((await execFile('sha256sum', [mediaPath])).stdout, sourceHashes.stdout);
  const seekProbe = await nativeAction(ownedPort, 'goToTimecodeDirect', { time: '00:02' });
  const invalidActionProbe = await nativeAction(ownedPort, 'losslesscutMcpInvalidAction');
  assert.equal(seekProbe.status, 200);
  assert.equal(invalidActionProbe.status, 200);
  assert.equal(invalidActionProbe.body, '');

  const ownedRootStillReady = await fetch(`http://127.0.0.1:${ownedPort}/`).then(response => response.status === 200);
  const ordinaryRootStillReady = await fetch(`http://127.0.0.1:${ordinaryPort}/`).then(response => response.status === 200);
  assert.equal(ownedRootStillReady, true);
  assert.equal(ordinaryRootStillReady, true);
  isolationProbe = {
    ordinary: {
      pid: ordinaryApp.pid,
      port: ordinaryPort,
      configDir: ordinaryApp.configDirectory,
      userDataDir: ordinaryApp.userDataDirectory,
      outputDirectory: ordinaryOutputDir,
      outputs: ordinaryExport.structuredContent.outputs,
    },
    mcpCandidate: { pid: app.pid, port: ownedPort, configDir: app.configDirectory, userDataDir: app.userDataDirectory, outputDirectory: firstOutputDir, outputs: exported.structuredContent.outputs },
    bothApisReadyAfterNativeExports: { ordinary: ordinaryRootStillReady, mcpCandidate: ownedRootStillReady },
  };

  // Cross-process boundary probe: two unrelated MCP servers share one native
  // API but use distinguishable media/projects and different expected output
  // directories. The app itself is configured for crossOutputOneDir only.
  const sharedPort = await availablePort();
  sharedApiApp = await startLosslessCut({
    port: sharedPort,
    outputDirectory: crossOutputOneDir,
    configDirectory: crossConfigDir,
    userDir: crossUserDataDir,
    exportConfirmEnabled: false,
    label: 'shared-api-cross-process',
  });
  const sharedSettings = JSON.parse(await readFile(join(crossConfigDir, 'config.json'), 'utf8'));
  sharedSettings.recentCustomOutDirs = [crossOutputTwoDir];
  await writeFile(join(crossClientConfigDir, 'config.json'), `${JSON.stringify(sharedSettings, null, 2)}\n`);
  sharedMcpOne = mcpClient(sharedPort, 30_000, crossConfigDir);
  sharedMcpTwo = mcpClient(sharedPort, 30_000, crossClientConfigDir);
  await Promise.all([sharedMcpOne.connect(), sharedMcpTwo.connect()]);
  const sharedStartEvent = nativeAwaitEvent(sharedPort, 'export-start').catch(error => ({ observationError: error instanceof Error ? error.message : String(error) }));
  const sharedCompleteEvent = nativeAwaitEvent(sharedPort, 'export-complete').catch(error => ({ observationError: error instanceof Error ? error.message : String(error) }));
  const sharedCalls = await Promise.all([
    sharedMcpOne.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: crossOutputOneDir } }),
    sharedMcpTwo.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath: crossProjectPath, outputDirectory: crossOutputTwoDir } }),
  ]);
  const [sharedStarted, sharedCompleted] = await Promise.all([sharedStartEvent, sharedCompleteEvent]);
  const sharedOutputsOne = await readdir(crossOutputOneDir);
  const sharedOutputsTwo = await readdir(crossOutputTwoDir);
  const sharedOutputEvidence = [];
  for (const [directory, names] of [
    [crossOutputOneDir, sharedOutputsOne],
    [crossOutputTwoDir, sharedOutputsTwo],
  ]) {
    for (const name of names) {
      const path = join(directory, name);
      if (!name.toLowerCase().endsWith('.mp4')) continue;
      let mediaVerification;
      let frameHash;
      try {
        await assertMedia(path);
        mediaVerification = 'verified';
        frameHash = await firstFrameHash(path);
      } catch (error) {
        mediaVerification = error instanceof Error ? error.message : String(error);
      }
      sharedOutputEvidence.push({ path, name, mediaVerification, frameHash, sizeBytes: (await stat(path)).size });
    }
  }
  const expectedSourceFrameHashes = {
    sourceOne: [await firstFrameHash(mediaPath, '1'), await firstFrameHash(mediaPath, '5')],
    sourceTwo: [await firstFrameHash(crossMediaPath, '2'), await firstFrameHash(crossMediaPath, '8')],
  };
  for (const [index, result] of sharedCalls.entries()) {
    if (result.structuredContent.status !== 'verified') continue;
    const expectedProjectPath = index === 0 ? projectPath : crossProjectPath;
    const expectedMediaPath = index === 0 ? mediaPath : crossMediaPath;
    const expectedDirectory = index === 0 ? crossOutputOneDir : crossOutputTwoDir;
    assert.equal(result.structuredContent.projectPath, expectedProjectPath);
    assert.equal(result.structuredContent.mediaPath, expectedMediaPath);
    assert.equal(result.structuredContent.outputDirectory, expectedDirectory);
    assert.ok(result.structuredContent.outputs.length === 2);
    for (const [outputIndex, output] of result.structuredContent.outputs.entries()) {
      assert.ok(output.path.startsWith(`${expectedDirectory}/`), `Verified output escaped its requested directory: ${output.path}`);
      const frameHash = await firstFrameHash(output.path);
      const expectedFrame = index === 0 ? expectedSourceFrameHashes.sourceOne[outputIndex] : expectedSourceFrameHashes.sourceTwo[outputIndex];
      assert.equal(frameHash, expectedFrame, `Verified output content did not match its project's source media: ${output.path}`);
    }
  }
  const retryFromQuarantinedSharedServer = sharedCalls.find(result => result.structuredContent.status === 'uncertain');
  let quarantineProbe;
  if (retryFromQuarantinedSharedServer) {
    const owner = sharedCalls.indexOf(retryFromQuarantinedSharedServer) === 0 ? sharedMcpOne : sharedMcpTwo;
    const ownerProject = owner === sharedMcpOne ? projectPath : crossProjectPath;
    const ownerOutput = owner === sharedMcpOne ? crossOutputOneDir : crossOutputTwoDir;
    quarantineProbe = (await owner.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath: ownerProject, outputDirectory: ownerOutput } })).structuredContent;
    assert.equal(quarantineProbe.code, 'export_session_quarantined');
  }
  crossProcessProbe = {
    application: {
      pid: sharedApiApp.pid,
      port: sharedPort,
      configDirectory: sharedApiApp.configDirectory,
      userDataDirectory: sharedApiApp.userDataDirectory,
      actualOutputDirectory: crossOutputOneDir,
    },
    mcpProcesses: [sharedMcpOne.transport.pid, sharedMcpTwo.transport.pid],
    projects: [
      { projectPath, mediaPath },
      { projectPath: crossProjectPath, mediaPath: crossMediaPath },
    ],
    requestedOutputDirectories: [crossOutputOneDir, crossOutputTwoDir],
    nativeEvents: { start: sharedStarted, complete: sharedCompleted },
    mcpResults: sharedCalls.map(result => result.structuredContent),
    observedFiles: { firstDirectory: sharedOutputsOne, secondDirectory: sharedOutputsTwo, verifiedMedia: sharedOutputEvidence },
    expectedSourceFrameHashes,
    quarantineProbe,
    inputHashesUnchanged: (await execFile('sha256sum', [mediaPath])).stdout === sourceHashes.stdout && (await execFile('sha256sum', [crossMediaPath])).stdout === crossSourceHash.stdout,
  };

  await sharedMcpOne.client.close();
  await sharedMcpTwo.client.close();
  await Promise.all([sharedMcpOne.transport.close(), sharedMcpTwo.transport.close()]);
  sharedMcpOne = undefined;
  sharedMcpTwo = undefined;
  await stopOwnedProcess(sharedApiApp);
  sharedApiApp = undefined;

  await ordinaryMcp.client.close();
  await ordinaryMcp.transport.close();
  await mcp.client.close();
  await mcp.transport.close();
  await stopOwnedProcess(ordinaryApp);
  ordinaryApp = undefined;
  firstExitCode = await ownedLifecycle.stop();
  ownedLifecycle = undefined;
  app = undefined;

  // Two concurrently running product-owned private profiles should keep
  // distinguishable native exports and MCP calls on their respective APIs.
  const privatePortOne = await availablePort();
  privateOwnerOne = await LosslessCutProcess.start({
    executable,
    port: privatePortOne,
    configDir: privateConfigOneDir,
    userDataDir: privateUserDataOneDir,
    startupTimeoutMs: 30_000,
    cwd: workspace,
    stdoutPath: join(logsDir, 'losslesscut-private-one.log'),
    stderrPath: join(logsDir, 'losslesscut-private-one.stderr.log'),
    settings: { ...candidateSettings, recentCustomOutDirs: [privateOutputOneDir] },
  });
  privateAppOne = privateOwnerOne.child;
  const privatePortTwo = await availablePort();
  privateOwnerTwo = await LosslessCutProcess.start({
    executable,
    port: privatePortTwo,
    configDir: privateConfigTwoDir,
    userDataDir: privateUserDataTwoDir,
    startupTimeoutMs: 30_000,
    cwd: workspace,
    stdoutPath: join(logsDir, 'losslesscut-private-two.log'),
    stderrPath: join(logsDir, 'losslesscut-private-two.stderr.log'),
    settings: { ...candidateSettings, recentCustomOutDirs: [privateOutputTwoDir] },
  });
  privateAppTwo = privateOwnerTwo.child;
  privateMcpOne = mcpClient(privatePortOne, 30_000, privateConfigOneDir);
  privateMcpTwo = mcpClient(privatePortTwo, 30_000, privateConfigTwoDir);
  await Promise.all([privateMcpOne.connect(), privateMcpTwo.connect()]);
  const privateExportOne = await privateMcpOne.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: privateOutputOneDir } });
  assert.equal(privateExportOne.structuredContent.status, 'verified', JSON.stringify(privateExportOne.structuredContent));
  for (const [outputIndex, output] of privateExportOne.structuredContent.outputs.entries()) {
    await assertMedia(output.path);
    assert.equal(await firstFrameHash(output.path), await firstFrameHash(mediaPath, outputIndex === 0 ? '1' : '5'));
  }
  const privateExportTwo = await privateMcpTwo.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath: crossProjectPath, outputDirectory: privateOutputTwoDir } });
  assert.equal(privateExportTwo.structuredContent.status, 'verified', JSON.stringify(privateExportTwo.structuredContent));
  for (const [outputIndex, output] of privateExportTwo.structuredContent.outputs.entries()) {
    await assertMedia(output.path);
    assert.equal(await firstFrameHash(output.path), await firstFrameHash(crossMediaPath, outputIndex === 0 ? '2' : '8'));
  }
  assert.ok((await readdir(privateOutputOneDir)).every(name => !name.includes('cross')));
  assert.ok((await readdir(privateOutputTwoDir)).every(name => name.includes('cross')));
  privatePairProbe = {
    processes: [
      {
        appPid: privateAppOne.pid,
        mcpPid: privateMcpOne.transport.pid,
        port: privatePortOne,
        configDir: privateConfigOneDir,
        userDataDir: privateUserDataOneDir,
        outputDirectory: privateOutputOneDir,
        result: privateExportOne.structuredContent,
      },
      {
        appPid: privateAppTwo.pid,
        mcpPid: privateMcpTwo.transport.pid,
        port: privatePortTwo,
        configDir: privateConfigTwoDir,
        userDataDir: privateUserDataTwoDir,
        outputDirectory: privateOutputTwoDir,
        result: privateExportTwo.structuredContent,
      },
    ],
    outputFiles: { first: await readdir(privateOutputOneDir), second: await readdir(privateOutputTwoDir) },
    inputHashesUnchanged: (await execFile('sha256sum', [mediaPath])).stdout === sourceHashes.stdout && (await execFile('sha256sum', [crossMediaPath])).stdout === crossSourceHash.stdout,
  };
  await Promise.all([privateMcpOne.client.close(), privateMcpTwo.client.close()]);
  await Promise.all([privateMcpOne.transport.close(), privateMcpTwo.transport.close()]);
  privateMcpOne = undefined;
  privateMcpTwo = undefined;
  const privateExits = await Promise.all([privateOwnerOne.stop(), privateOwnerTwo.stop()]);
  privateAppOne = undefined;
  privateAppTwo = undefined;
  privateOwnerOne = undefined;
  privateOwnerTwo = undefined;

  // End-to-end release demonstration: the MCP process itself starts and
  // stops LosslessCut using only the documented environment and config file.
  const demoSettings = {
    enableCustomOutDir: true,
    recentCustomOutDirs: [mcpOwnedDemoOutputDir],
    enableOverwriteOutput: false,
    autoMerge: false,
    invertCutSegments: false,
    segmentsToChaptersOnly: false,
    enableAskForFileOpenAction: false,
    askBeforeClose: true,
    storeProjectInWorkingDir: true,
    exportConfirmEnabled: false,
    cleanupChoices: { cleanupAfterExport: false },
  };
  await writeFile(join(mcpOwnedDemoConfigDir, 'config.json'), `${JSON.stringify(demoSettings, null, 2)}\n`);
  const demoPort = await availablePort();
  const demoSourceHash = await execFile('sha256sum', [mediaPath]);
  mcpOwnedDemoClient = mcpClient(demoPort, 30_000, mcpOwnedDemoConfigDir, {
    LOSSLESSCUT_API_PORT: String(demoPort),
    LOSSLESSCUT_EXECUTABLE: executable,
    LOSSLESSCUT_CONFIG_DIR: mcpOwnedDemoConfigDir,
    LOSSLESSCUT_USER_DATA_DIR: mcpOwnedDemoUserDataDir,
  });
  await mcpOwnedDemoClient.connect();
  const demoServerPid = mcpOwnedDemoClient.transport.pid;
  const demoToolList = await mcpOwnedDemoClient.client.listTools();
  assert.ok(demoToolList.tools.some(tool => tool.name === 'losslesscut_inspect_media'));
  assert.ok(demoToolList.tools.some(tool => tool.name === 'losslesscut_create_project'));
  assert.ok(demoToolList.tools.some(tool => tool.name === 'losslesscut_export_project'));
  const demoMedia = await mcpOwnedDemoClient.client.callTool({ name: 'losslesscut_inspect_media', arguments: { path: mediaPath } });
  assert.equal(demoMedia.structuredContent.status, 'verified', JSON.stringify(demoMedia.structuredContent));
  const demoProjectCreate = await mcpOwnedDemoClient.client.callTool({
    name: 'losslesscut_create_project',
    arguments: {
      mediaPath,
      destinationPath: join(inputDir, 'release-demo.llc'),
      segments: [
        { start: 1, end: 3, name: 'demo-clip-one' },
        { start: 5, end: 7, name: 'demo-clip-two' },
      ],
    },
  });
  assert.equal(demoProjectCreate.structuredContent.status, 'created', JSON.stringify(demoProjectCreate.structuredContent));
  const demoProject = await mcpOwnedDemoClient.client.callTool({ name: 'losslesscut_inspect_project', arguments: { projectPath: demoProjectCreate.structuredContent.projectPath } });
  assert.equal(demoProject.structuredContent.status, 'verified', JSON.stringify(demoProject.structuredContent));
  const demoExport = await mcpOwnedDemoClient.client.callTool({
    name: 'losslesscut_export_project',
    arguments: { projectPath: demoProjectCreate.structuredContent.projectPath, outputDirectory: mcpOwnedDemoOutputDir },
  });
  assert.equal(demoExport.structuredContent.status, 'verified', JSON.stringify(demoExport.structuredContent));
  assert.equal(demoExport.structuredContent.outputs.length, 2);
  for (const output of demoExport.structuredContent.outputs) await assertMedia(output.path);
  const demoSourceHashAfter = await execFile('sha256sum', [mediaPath]);
  assert.equal(demoSourceHashAfter.stdout, demoSourceHash.stdout, 'MCP-owned demo export must leave the source unchanged.');
  const demoStatus = await mcpOwnedDemoClient.client.callTool({ name: 'losslesscut_api_status', arguments: {} });
  assert.equal(demoStatus.structuredContent.reachable, true);
  let transportClosedResolve;
  const transportClosed = new Promise(resolvePromise => {
    transportClosedResolve = resolvePromise;
  });
  const previousOnClose = mcpOwnedDemoClient.transport.onclose;
  mcpOwnedDemoClient.transport.onclose = () => {
    previousOnClose?.();
    transportClosedResolve();
  };
  await mcpOwnedDemoClient.client.close();
  await mcpOwnedDemoClient.transport.close();
  let shutdownTimer;
  await Promise.race([
    transportClosed,
    new Promise((_, reject) => {
      shutdownTimer = setTimeout(() => reject(new Error('MCP-owned demo server did not close after the client disconnected.')), 10_000);
    }),
  ]);
  clearTimeout(shutdownTimer);
  mcpOwnedDemoClient = undefined;
  const demoApiDown = await fetch(`http://127.0.0.1:${demoPort}/`, { headers: { host: `127.0.0.1:${demoPort}` }, signal: AbortSignal.timeout(1_000) }).then(
    () => false,
    () => true,
  );
  assert.equal(demoApiDown, true, 'LosslessCut API must stop after its owning MCP process closes.');
  mcpOwnedDemoProbe = {
    mcpServerPid: demoServerPid,
    apiPort: demoPort,
    sourcePath: mediaPath,
    sourceSha256Before: demoSourceHash.stdout.trim().split(' ')[0],
    sourceSha256After: demoSourceHashAfter.stdout.trim().split(' ')[0],
    mediaInspection: demoMedia.structuredContent,
    project: demoProject.structuredContent,
    export: demoExport.structuredContent,
    apiUnavailableAfterClientShutdown: demoApiDown,
    mcpTransportClosed: true,
  };

  const secondPort = await availablePort();
  confirmationApp = await startLosslessCut({
    port: secondPort,
    outputDirectory: secondOutputDir,
    configDirectory: confirmationConfigDir,
    userDir: secondUserDataDir,
    exportConfirmEnabled: true,
    label: 'confirmation',
  });
  secondAppPid = confirmationApp.pid;
  secondAppLogPath = confirmationApp.logPath;
  secondAppErrPath = confirmationApp.stderrLogPath;
  confirmationMcp = mcpClient(secondPort, 1_000, confirmationConfigDir);
  await confirmationMcp.connect();
  confirmationMcpPid = confirmationMcp.transport.pid;
  const uncertain = await confirmationMcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: secondOutputDir } });
  assert.equal(uncertain.structuredContent.status, 'uncertain', JSON.stringify(uncertain.structuredContent));
  assert.equal(uncertain.structuredContent.code, 'export_outcome_uncertain');
  assert.ok(
    uncertain.structuredContent.details.observedArtifacts.some(artifact => artifact.kind === 'project' && artifact.validProject === false),
    JSON.stringify(uncertain.structuredContent.details),
  );
  const remaining = await readdir(secondOutputDir);
  assert.ok(!remaining.some(name => name.endsWith('.mp4')), 'No media output should exist without export-start confirmation.');
  const retryAfterUncertain = await confirmationMcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: secondOutputDir } });
  assert.equal(retryAfterUncertain.structuredContent.code, 'export_session_quarantined');

  const crashPort = await availablePort();
  crashApp = await startLosslessCut({
    port: crashPort,
    outputDirectory: crashOutputDir,
    configDirectory: crashConfigDir,
    userDir: crashUserDataDir,
    exportConfirmEnabled: false,
    label: 'crash-during-export',
  });
  crashMcp = mcpClient(crashPort, 30_000, crashConfigDir);
  await crashMcp.connect();
  const exportStartPromise = nativeAwaitEvent(crashPort, 'export-start');
  const crashingExportPromise = crashMcp.client
    .callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: crashOutputDir } })
    .catch(error => ({ clientError: error instanceof Error ? error.message : String(error) }));
  const nativeExportStart = await exportStartPromise;
  assert.equal(nativeExportStart.eventName, 'export-start');
  const crashExit = await stopOwnedProcess(crashApp);
  crashApp = undefined;
  const crashedExport = await crashingExportPromise;
  assert.equal(crashedExport.structuredContent.status, 'uncertain', JSON.stringify(crashedExport.structuredContent));
  assert.equal(crashedExport.structuredContent.code, 'export_outcome_uncertain');
  assert.equal(crashedExport.structuredContent.details.retryAllowedOnThisSession, false);
  const crashRetry = await crashMcp.client.callTool({ name: 'losslesscut_export_project', arguments: { projectPath, outputDirectory: crashOutputDir } });
  assert.equal(crashRetry.structuredContent.code, 'export_session_quarantined');
  crashProbe = {
    exportStart: nativeExportStart,
    appExit: crashExit,
    mcpResult: crashedExport.structuredContent,
    retry: crashRetry.structuredContent,
    observedDirectory: await readdir(crashOutputDir),
  };

  secondExitCode = await stopOwnedProcess(confirmationApp);
  confirmationApp = undefined;
  const unavailable = await confirmationMcp.client.callTool({ name: 'losslesscut_api_status', arguments: {} });
  assert.equal(unavailable.structuredContent.reachable, false);
  await confirmationMcp.client.close();
  await confirmationMcp.transport.close();

  const report = {
    status: 'passed',
    applicationPids: [ordinaryAppPid, firstAppPid, crossProcessProbe?.application.pid, privatePairProbe?.processes[0].appPid, privatePairProbe?.processes[1].appPid, secondAppPid],
    mcpPids: [mcpPid, crossProcessProbe?.mcpProcesses[0], crossProcessProbe?.mcpProcesses[1], privatePairProbe?.processes[0].mcpPid, privatePairProbe?.processes[1].mcpPid, confirmationMcpPid],
    firstApplicationExit: firstExitCode,
    confirmationApplicationExit: secondExitCode,
    applicationLogs: [ordinaryAppLogPath, firstAppLogPath, secondAppLogPath],
    stderrLogs: [ordinaryAppErrPath, firstAppErrPath, secondAppErrPath],
    isolatedProfile: { configDir, userDataDir },
    occupiedPort: occupiedPortProbe,
    staleOutput: staleOutputProbe,
    duplicateExport: duplicateExport.structuredContent,
    crashDuringExport: crashProbe,
    sharedApiCrossProcess: crossProcessProbe,
    twoMcpOwnedInstances: privatePairProbe,
    twoMcpOwnedInstanceExits: privateExits,
    mcpOwnedPrivateDemo: mcpOwnedDemoProbe,
    concurrentProfileIsolation: isolationProbe,
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
  await Promise.all([
    ownedLifecycle?.stop() ?? stopOwnedProcess(app),
    privateOwnerOne?.stop(),
    privateOwnerTwo?.stop(),
    stopOwnedProcess(ordinaryApp),
    stopOwnedProcess(confirmationApp),
    stopOwnedProcess(crashApp),
    stopOwnedProcess(sharedApiApp),
  ]);
  await Promise.all([
    mcp ? mcp.client.close().catch(() => undefined) : Promise.resolve(),
    confirmationMcp ? confirmationMcp.client.close().catch(() => undefined) : Promise.resolve(),
    crashMcp ? crashMcp.client.close().catch(() => undefined) : Promise.resolve(),
    sharedMcpOne ? sharedMcpOne.client.close().catch(() => undefined) : Promise.resolve(),
    sharedMcpTwo ? sharedMcpTwo.client.close().catch(() => undefined) : Promise.resolve(),
    privateMcpOne ? privateMcpOne.client.close().catch(() => undefined) : Promise.resolve(),
    privateMcpTwo ? privateMcpTwo.client.close().catch(() => undefined) : Promise.resolve(),
    mcpOwnedDemoClient ? mcpOwnedDemoClient.client.close().catch(() => undefined) : Promise.resolve(),
  ]);
  if (process.env['LOSSLESSCUT_KEEP_TEST_OUTPUT'] !== '1') await rm(workspace, { recursive: true, force: true });
  else console.log(`Acceptance evidence retained at ${workspace}`);
}
