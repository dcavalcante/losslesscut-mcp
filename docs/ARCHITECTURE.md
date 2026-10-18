# Architecture

## Product boundary

LosslessCut MCP orchestrates native `.llc` projects and LosslessCut exports for precise cuts. LosslessCut performs the edit. FFprobe inspects source media and verifies outputs; FFmpeg is used only by acceptance tests to create disposable media. The MCP does not expose arbitrary shell commands, generic LosslessCut actions, or direct FFmpeg edits.

## Integration decision

Use a TypeScript stdio MCP server, official MCP SDK, Zod schemas, a narrow loopback HTTP adapter, `.llc` v2 validation, and FFprobe verification. The supported export mode has the product server own a dedicated LosslessCut process with its own config, user-data directory, and API port. Shared GUI/API attachment is unsupported for exports because independent clients can race the app's shared state and events. The native acceptance harness verifies the process owner and uses disposable isolated instances.

The upstream API is experimental and has no authentication. It binds to loopback and current source checks both `Host` and `Origin`, but local processes remain trusted. `losslesscut_api_status` probes the guard; the server disables mutation unless both hostile Host and browser Origin requests are rejected. The hostile Host probe uses raw Node HTTP because Fetch normalizes Host to the URL host. Never expose the endpoint to a LAN or shared multi-user host.

## MVP export flow

1. Resolve `.llc` and media paths and ensure both are under configured authorized roots. Validate selected v2 ranges and require a separate, already existing, empty output directory.
2. Read the LosslessCut `config.json`; require this output directory, overwrite disabled, separate selected-segment outputs, open confirmation disabled, and cleanup-after-export off.
3. Verify the request guard, open the project through `openFiles`, and subscribe to native export-start and export-complete events before invoking `export`.
4. Serialize operations within this MCP process. Require a matching media path, one reported output per selected segment, new paths inside the authorized output directory, regular files, and successful FFprobe stream/duration checks.
5. On timeout or uncertain events, stop and report uncertainty. Do not retry until the user reconciles the output directory.

The app exposes no loaded-project, busy, or segment-state query. The HTTP action route returns an empty success response and upstream catches renderer action errors. Therefore project opening cannot be claimed verified, and export proof comes from observed native events plus filesystem and FFprobe evidence. Upstream events lack operation IDs and listener-registration acknowledgements; serialize and treat stray events or timing ambiguity as unresolved.

## Boundaries

- `src/mcp`: typed MCP tools and structured results.
- `src/integration`: LosslessCut HTTP calls, project parsing, workflow safety, stable error outcomes.
- `src/config.ts`: explicit loopback port, authorized roots, timeouts, and FFprobe path.
- `tests/integration/acceptance.mjs`: Linux-only application lifecycle and real MCP client integration.

Writes require explicit authorized roots and an empty output directory. No silent overwrite or blind retry. Operation serialization and uncertain-session quarantine are process-local; the experiment showed a second MCP server can issue a competing action through the same API. The private owner reduces accidental overlap but cannot authenticate or exclude other local API clients.

## Alternatives

| Approach | Decision |
| --- | --- |
| LosslessCut HTTP API | Native open/export and events; experimental, state-poor, unauthenticated locally, and event correlation limited. |
| CLI actions | Useful for launching and opening, but `--keyboard-action` is fire-and-forget; not used for deterministic sequencing. |
| `.llc` v2 project files | Reviewable native cut plan and segment interchange; used to define selected ranges, not treated as proof of live editor state. |
| CSV / other EDL formats | Not MVP: less project metadata and no stronger state or export guarantees demonstrated. |
| Direct FFmpeg | Not used for edits. FFprobe is used for inspection/verification only. |
| Upstream changes | Potentially valuable for action error propagation, renderer readiness, and correlated export IDs/errors; not needed to demonstrate the current serialized MVP. |

## Platform boundary

The first verified environment is Fedora/Linux. Application discovery, launch, shutdown, and logs are acceptance-harness concerns today. Do not claim Windows or macOS support until the lifecycle and native export pass on those platforms.
