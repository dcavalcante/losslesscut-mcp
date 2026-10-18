import { delimiter, resolve } from 'node:path';

export interface AppConfig {
  apiPort: number;
  apiTimeoutMs: number;
  exportTimeoutMs: number;
  allowedRoots: string[];
  configDir?: string;
  losslessCutExecutable?: string;
  userDataDir?: string;
  startupTimeoutMs: number;
  ffprobePath: string;
}

function readBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = env['LOSSLESSCUT_CONFIG_DIR'];
  const executable = env['LOSSLESSCUT_EXECUTABLE'];
  const userDataDir = env['LOSSLESSCUT_USER_DATA_DIR'];
  if ((executable || userDataDir) && !(executable && userDataDir && configDir)) {
    throw new Error('Set LOSSLESSCUT_EXECUTABLE, LOSSLESSCUT_CONFIG_DIR, and LOSSLESSCUT_USER_DATA_DIR together to let MCP own an isolated LosslessCut process.');
  }
  return {
    apiPort: readBoundedInteger(env['LOSSLESSCUT_API_PORT'], 8080, 1, 65535, 'LOSSLESSCUT_API_PORT'),
    apiTimeoutMs: readBoundedInteger(env['LOSSLESSCUT_API_TIMEOUT_MS'], 5_000, 100, 120_000, 'LOSSLESSCUT_API_TIMEOUT_MS'),
    exportTimeoutMs: readBoundedInteger(env['LOSSLESSCUT_EXPORT_TIMEOUT_MS'], 120_000, 1_000, 600_000, 'LOSSLESSCUT_EXPORT_TIMEOUT_MS'),
    allowedRoots: (env['LOSSLESSCUT_ALLOWED_ROOTS'] ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map(root => resolve(root)),
    ...(configDir ? { configDir: resolve(configDir) } : {}),
    ...(executable ? { losslessCutExecutable: resolve(executable) } : {}),
    ...(userDataDir ? { userDataDir: resolve(userDataDir) } : {}),
    startupTimeoutMs: readBoundedInteger(env['LOSSLESSCUT_STARTUP_TIMEOUT_MS'], 30_000, 1_000, 120_000, 'LOSSLESSCUT_STARTUP_TIMEOUT_MS'),
    ffprobePath: env['LOSSLESSCUT_FFPROBE_PATH'] || 'ffprobe',
  };
}
