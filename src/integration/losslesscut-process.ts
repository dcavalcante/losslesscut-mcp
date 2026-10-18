import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, realpath } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { LosslessCutApi } from './losslesscut-api.js';

const rendererReadyMarker = 'ffprobe -v 0 -of json -show_program_version';

export interface LosslessCutProcessOptions {
  executable: string;
  port: number;
  configDir: string;
  userDataDir: string;
  startupTimeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdoutPath?: string;
  stderrPath?: string;
  settings?: Record<string, unknown>;
}

function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', error => reject(new Error(`LosslessCut API port ${port} is unavailable: ${error.message}`)));
    server.listen(port, '127.0.0.1', () => server.close(error => (error ? reject(error) : resolvePromise())));
  });
}

export class LosslessCutProcess {
  private constructor(
    readonly child: ChildProcess,
    readonly api: LosslessCutApi,
    private readonly streams: WriteStream[],
    readonly stdoutPath?: string,
    readonly stderrPath?: string,
  ) {}

  static async start(options: LosslessCutProcessOptions): Promise<LosslessCutProcess> {
    await access(options.executable);
    await Promise.all([mkdir(options.configDir, { recursive: true }), mkdir(options.userDataDir, { recursive: true })]);
    const [canonicalConfigDir, canonicalUserDataDir] = await Promise.all([realpath(options.configDir), realpath(options.userDataDir)]);
    if (canonicalConfigDir === canonicalUserDataDir) throw new Error('LosslessCut config and Electron user-data directories must be separate.');
    await assertPortAvailable(options.port);
    const streams = [options.stdoutPath, options.stderrPath].filter((path): path is string => path != null).map(path => createWriteStream(path, { flags: 'a' }));
    const app = spawn(
      options.executable,
      [
        `--user-data-dir=${options.userDataDir}`,
        '--http-api',
        String(options.port),
        '--config-dir',
        options.configDir,
        ...(options.settings ? ['--settings-json', JSON.stringify(options.settings)] : []),
      ],
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdoutStream = options.stdoutPath == null ? undefined : streams[0];
    const stderrStream = options.stderrPath == null ? undefined : streams[options.stdoutPath == null ? 0 : 1];
    app.stdout?.pipe(stdoutStream ?? process.stderr);
    app.stderr?.pipe(stderrStream ?? process.stderr);
    const owned = new LosslessCutProcess(app, new LosslessCutApi(options.port, 1_000), streams, options.stdoutPath, options.stderrPath);
    let stdout = '';
    let processStartError: Error | undefined;
    app.once('error', error => {
      processStartError = error;
    });
    app.stdout?.on('data', chunk => {
      stdout = (stdout + String(chunk)).slice(-64_000);
    });
    try {
      await owned.waitUntilReady(
        options.startupTimeoutMs ?? 30_000,
        () => stdout.includes(rendererReadyMarker),
        () => processStartError,
      );
      return owned;
    } catch (error) {
      if (processStartError) {
        for (const stream of streams) stream.end();
      } else {
        await owned.stop();
      }
      throw new Error(
        `LosslessCut failed to reach API and renderer readiness: ${error instanceof Error ? error.message : String(error)}${options.stdoutPath ? `; stdout: ${options.stdoutPath}` : ''}${options.stderrPath ? `; stderr: ${options.stderrPath}` : ''}`,
      );
    }
  }

  async stop(): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
    const { child } = this;
    const result =
      child.exitCode != null || child.signalCode != null
        ? { exitCode: child.exitCode, signal: child.signalCode }
        : await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolvePromise => {
            const timer = setTimeout(() => {
              child.kill('SIGKILL');
            }, 5_000);
            child.once('exit', (exitCode, signal) => {
              clearTimeout(timer);
              resolvePromise({ exitCode, signal });
            });
            child.kill('SIGTERM');
          });
    for (const stream of this.streams) stream.end();
    return result;
  }

  private async waitUntilReady(timeoutMs: number, rendererReady: () => boolean, processStartError: () => Error | undefined): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastDetail = 'API or renderer is not ready';
    while (Date.now() < deadline) {
      if (processStartError()) throw processStartError();
      if (this.child.exitCode != null || this.child.signalCode != null) throw new Error(`LosslessCut exited with code ${this.child.exitCode} and signal ${this.child.signalCode}`);
      const status = await this.api.status();
      if (!status.reachable) lastDetail = status.detail;
      else if (!status.securityGuard) lastDetail = 'API security guard verification failed';
      else if (!rendererReady()) lastDetail = 'API is ready but renderer readiness marker has not appeared';
      else return;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
    }
    throw new Error(`Startup timed out after ${timeoutMs}ms: ${lastDetail}`);
  }
}
