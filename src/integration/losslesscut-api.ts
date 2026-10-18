import { request as httpRequest } from 'node:http';
import { IntegrationError } from './errors.js';

export type ExportStartEvent = { eventName: 'export-start'; path: string };
export type ExportCompleteEvent = { eventName: 'export-complete'; paths?: string[] };

export class LosslessCutApi {
  readonly baseUrl: string;

  constructor(
    readonly port: number,
    private readonly timeoutMs: number,
  ) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async status(fetcher: typeof fetch = fetch) {
    const address = `${this.baseUrl}/`;
    try {
      const response = await fetcher(address, {
        headers: { host: `127.0.0.1:${this.port}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await response.text()).trim();
      const reachable = response.status === 200 && body === 'See https://losslesscut.app/';
      const securityGuard = reachable && (await this.verifyRequestGuard(fetcher));
      return {
        reachable,
        securityGuard,
        address,
        detail:
          reachable && securityGuard
            ? 'LosslessCut HTTP API responds and rejects hostile Host and Origin headers. It still does not expose loaded-editor state.'
            : reachable
              ? 'LosslessCut HTTP API responds, but its Host/Origin request guard was not verified; mutations are disabled.'
              : `Unexpected API response (HTTP ${response.status}).`,
      };
    } catch (error) {
      return { reachable: false, securityGuard: false, address, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async verifyRequestGuard(fetcher: typeof fetch = fetch): Promise<boolean> {
    try {
      // Fetch deliberately overwrites the Host header from the URL. Use Node's
      // HTTP client for this one probe so we actually exercise upstream's
      // DNS-rebinding guard instead of sending another loopback Host header.
      const hostileHostStatus =
        fetcher === fetch
          ? await this.requestWithHost(`losslesscut-mcp.invalid:${this.port}`)
          : (
              await fetcher(`${this.baseUrl}/`, {
                headers: { host: `losslesscut-mcp.invalid:${this.port}` },
                redirect: 'manual',
                signal: AbortSignal.timeout(this.timeoutMs),
              })
            ).status;
      const browserOrigin = await fetcher(`${this.baseUrl}/`, {
        headers: { host: `127.0.0.1:${this.port}`, origin: 'https://losslesscut-mcp.invalid' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return hostileHostStatus === 403 && browserOrigin.status === 403;
    } catch {
      return false;
    }
  }

  private requestWithHost(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/',
          method: 'GET',
          setHost: false,
          headers: { host },
          timeout: this.timeoutMs,
        },
        response => {
          response.resume();
          response.once('end', () => resolve(response.statusCode ?? 0));
        },
      );
      request.once('timeout', () => request.destroy(new Error('Host probe timed out')));
      request.once('error', reject);
      request.end();
    });
  }

  async requireRequestGuard(): Promise<void> {
    if (!(await this.verifyRequestGuard())) {
      throw new IntegrationError('api_security_unverified', 'LosslessCut did not reject both a hostile Host header and a browser Origin header; API mutations are disabled for this build.');
    }
  }

  async action(action: 'openFiles' | 'export', body?: unknown): Promise<void> {
    const response = await this.request(`/api/action/${action}`, body, this.timeoutMs, true);
    if (!response.ok) throw new IntegrationError('api_http_error', `LosslessCut returned HTTP ${response.status} for ${action}.`);
  }

  async awaitExportStart(signal: AbortSignal): Promise<ExportStartEvent> {
    const value = await this.awaitEvent('export-start', signal);
    if (typeof value !== 'object' || value == null || !('eventName' in value) || value.eventName !== 'export-start' || !('path' in value) || typeof value.path !== 'string') {
      throw new IntegrationError('invalid_event', 'LosslessCut returned an invalid export-start event.', 'uncertain');
    }
    return { eventName: 'export-start', path: value.path };
  }

  async awaitExportComplete(signal: AbortSignal): Promise<ExportCompleteEvent> {
    const value = await this.awaitEvent('export-complete', signal);
    if (typeof value !== 'object' || value == null || !('eventName' in value) || value.eventName !== 'export-complete') {
      throw new IntegrationError('invalid_event', 'LosslessCut returned an invalid export-complete event.', 'uncertain');
    }
    if ('paths' in value && value.paths !== undefined && (!Array.isArray(value.paths) || value.paths.some(path => typeof path !== 'string'))) {
      throw new IntegrationError('invalid_event', 'LosslessCut returned invalid output paths.', 'uncertain');
    }
    return { eventName: 'export-complete', ...('paths' in value && Array.isArray(value.paths) ? { paths: value.paths as string[] } : {}) };
  }

  private async awaitEvent(eventName: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.request(`/api/await-event/${eventName}`, undefined, undefined, false, signal);
    if (!response.ok) throw new IntegrationError('api_http_error', `LosslessCut returned HTTP ${response.status} while waiting for ${eventName}.`, 'uncertain');
    try {
      return await response.json();
    } catch {
      throw new IntegrationError('invalid_event', `LosslessCut returned invalid JSON for ${eventName}.`, 'uncertain');
    }
  }

  private async request(path: string, body: unknown, timeoutMs?: number, mutation = false, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = timeoutMs == null ? undefined : setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { host: `127.0.0.1:${this.port}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const uncertain = timedOut && (mutation || path.startsWith('/api/await-event/'));
      throw new IntegrationError(
        uncertain && timedOut ? 'action_outcome_uncertain' : 'api_unavailable',
        timedOut ? `LosslessCut API request timed out: ${path}` : `Unable to reach LosslessCut API: ${error instanceof Error ? error.message : String(error)}`,
        uncertain ? 'uncertain' : 'known-failure',
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
}
