export interface ApiStatus {
  reachable: boolean;
  address: string;
  detail: string;
}

export async function checkLosslessCutApi(fetcher: typeof fetch = fetch): Promise<ApiStatus> {
  const port = 8080;
  const address = `http://127.0.0.1:${port}/`;
  try {
    const response = await fetcher(address, {
      method: 'GET',
      headers: { host: `127.0.0.1:${port}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.text()).trim();
    const reachable = response.status === 200 && body === 'See https://losslesscut.app/';
    return {
      reachable,
      address,
      detail: reachable ? 'LosslessCut HTTP API root responded. The open file and editor state are not exposed by this check.' : `Unexpected API response (HTTP ${response.status}).`,
    };
  } catch (error) {
    return {
      reachable: false,
      address,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
