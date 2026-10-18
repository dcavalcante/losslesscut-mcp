# LosslessCut MCP

An MCP server for preparing and exporting precise cuts through LosslessCut's native editor and project format. It is not a generic FFmpeg tool server: LosslessCut performs edits and exports; FFprobe inspects and verifies media.

**Current MVP:** open a validated LosslessCut `.llc` v2 project, export its selected segments as separate files, and verify the native export events, output paths, streams, and durations. Verified on Fedora/Linux with the source-built LosslessCut 3.69.0 at revision `448348bd`.

The MCP feature surface is intentionally small: **five tools total, with one verified native editing workflow**. It can inspect media and LLC projects read-only, but it does not create or edit projects, control tracks, merge outputs, process batches, generate snapshots, or run scene/silence analysis. LosslessCut’s broader native feature set and the automation evidence for each family are in the [capability inventory](docs/CAPABILITIES.md).

## Tools

- `losslesscut_api_status` checks the API root and verifies the upstream Host/Origin guard.
- `losslesscut_inspect_media` runs FFprobe on an authorized media file and reports container and stream facts; it does not inspect editor state.
- `losslesscut_inspect_project` reads and validates an authorized LLC v1/v2 project, its segment ranges, and any referenced media path.
- `losslesscut_open_project` opens an authorized `.llc` project. The result is explicitly unverified because LosslessCut currently returns HTTP 200 even when renderer actions fail.
- `losslesscut_export_project` opens a project, exports its selected segments, and verifies newly created outputs with FFprobe. Ambiguous or confirmation-blocked runs return `uncertain`; do not blindly retry them.

The media and project inspection tools work without a running LosslessCut process. Open/export tools attach to a LosslessCut process the operator has started. The integration test harness owns its own isolated app instances, configuration, Electron user-data, fixtures, logs, and cleanup; the product server does not yet launch or supervise the desktop app.

## Quick start

Requirements: Node.js 22.23.3, npm 10.9.9, and FFprobe. The MCP protocol inspection test and native export acceptance also use FFmpeg to generate disposable fixtures. Native acceptance requires a Linux LosslessCut build with `--http-api` support.

```sh
npm ci
npm run check
npm test
npm run test:protocol
npm start
```

Configure your MCP client to run `node /path/to/losslesscut-mcp/dist/index.js` with:

```text
LOSSLESSCUT_API_PORT=8080
LOSSLESSCUT_ALLOWED_ROOTS=/absolute/path/to/authorized/media
LOSSLESSCUT_CONFIG_DIR=/absolute/path/to/the/running/LosslessCut/config
LOSSLESSCUT_EXPORT_TIMEOUT_MS=120000
```

Start LosslessCut with `--http-api 8080` and the same `--config-dir`. Configure a dedicated LosslessCut profile with overwrite disabled, separate-segment export selected, open confirmation disabled, cleanup-after-export disabled, and the requested empty output directory as its custom output directory. Export is refused unless these settings can be read and checked. Keep the API bound to loopback and use an upstream build that rejects hostile Host and browser Origin headers; the server disables mutations if that guard is not verified. This API has no authentication against other local processes.

To run the real acceptance test on Fedora/Linux:

```sh
LOSSLESSCUT_EXECUTABLE=/path/to/losslesscut npm run test:acceptance
```

The harness starts and terminates only the instances it owns. Set `LOSSLESSCUT_KEEP_TEST_OUTPUT=1` to preserve generated inputs, outputs, and logs. See [architecture](docs/ARCHITECTURE.md), [feasibility evidence](docs/FEASIBILITY.md), [capability matrix](docs/CAPABILITIES.md), and [roadmap](docs/ROADMAP.md).

## License

MIT. LosslessCut is a separate GPL-2.0-licensed application; this project communicates through its HTTP API and project files and does not copy or link its implementation.
