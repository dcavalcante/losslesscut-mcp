import { LosslessCutApi } from './integration/losslesscut-api.js';

export interface ApiStatus {
  reachable: boolean;
  securityGuard: boolean;
  address: string;
  detail: string;
}

export async function checkLosslessCutApi(fetcher: typeof fetch = fetch, port = 8080): Promise<ApiStatus> {
  return new LosslessCutApi(port, 2_000).status(fetcher);
}
