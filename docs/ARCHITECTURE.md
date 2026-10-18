# Architecture and integration decision

## Decision

Use a local stdio MCP server in TypeScript. Keep the LosslessCut adapter as a narrow HTTP client against the user's explicitly enabled API (default `127.0.0.1:8080`), and use FFprobe directly for media inspection and output verification. Create native `.llc` projects only after the supported schema and import behavior are covered by acceptance tests. The server will not start, terminate, or silently take over a GUI session in the first release.

The end-to-end target is: authorize input/output locations → inspect media → prepare a native project with requested cut ranges → open/import it in the running editor → initiate native export → observe completion → verify outputs → return paths and media facts. Output publication must use unique paths or explicit overwrite consent. Preserve source media.

## What upstream exposes

- The experimental HTTP API is enabled with `--http-api`, listens on IPv4 loopback, and has no authentication. Its request guard rejects browser `Origin` headers and checks an allowlisted `Host` to mitigate DNS rebinding and browser CSRF. This limits network reach but does not isolate other local processes.
- `POST /api/action/:action` dispatches a keyboard action; it is not a stable, typed RPC surface. It waits for renderer action completion, but upstream says only most actions wait.
- `POST /api/await-event/:eventName` waits for `export-start` and `export-complete`. Source shows a per-request event listener and abort cleanup when the request closes. Completion includes `paths` on success; the event type permits missing paths, while the docs describe completion as either success or failure. No structured failure reason is exposed in the event contract.
- `openFiles` is an action with a string-array parameter. CLI arguments also open files/projects; CLI keyboard actions return immediately and require waiting, so they are not suitable for sequencing edits without the HTTP API.
- Source defines `.llc` versions 1 and 2. V2 contains `version`, optional `mediaFileName`, and `cutSegments` with numeric `start`, optional numeric `end`, `name`, optional string-valued `tags`, and optional `selected`. Upstream maps serialized segments to start/end/name/tags/selected. CSV import/export has one range per row (start seconds, end seconds, label; blank end is a marker).
- The editor does not expose a documented read-only API for current file, tracks, segments, settings, or export configuration. The HTTP API is an action surface, not state introspection.

These contracts are experimental/upstream-version-sensitive. Pin tested app versions in acceptance reports, validate inputs/responses locally, and fail closed on unknown behavior.

## Integration alternatives

| Approach | Use | Limits and decision |
| --- | --- | --- |
| LosslessCut HTTP API | Open/import, invoke allowlisted actions, await export events | Preferred native control path. Experimental, shared mutable GUI state, no authentication, no rich state/error reporting. |
| LosslessCut CLI | Initial launch with media or project paths; discover app executable | Useful for user-managed startup. Keyboard actions are fire-and-forget. Do not infer readiness from arbitrary sleeps. |
| `.llc` / CSV | Build or inspect cut plans and exchange projects | `.llc` is JSON5 and versioned. Direct file editing bypasses the GUI; use temporary project copies and verify reopen in the actual editor. CSV is simpler but loses project metadata. |
| FFmpeg / FFprobe | Probe streams, verify outputs, possibly supply explicit diagnostics | FFprobe is appropriate for metadata and result verification. Any direct FFmpeg edit must be labeled non-native and is out of MVP scope. |
| Upstream modification | Only if tests prove a narrow API gap blocks safe operation | No fork or patch is justified yet. Prefer proposing an upstream API improvement if a demonstrated blocker persists. |

## Boundaries and safety

- MCP stdio transport and tool schemas are separate from domain planning, LosslessCut HTTP, media probing, and filesystem policy.
- Configuration should explicitly name the API URL/port, executable (if used), allowed roots, and timeouts. The HTTP adapter accepts loopback IPv4/localhost only, disables redirects, sends no `Origin`, uses an explicit local `Host`, and refuses arbitrary destinations.
- Resolve real paths and reject symlink escapes from authorized roots. Read-only inspection does not imply write authorization.
- Serialize all operations mutating one editor session. Do not promise session isolation if a human also controls the GUI.
- Arm event observation before issuing export. Upstream provides no acknowledgement that the long-poll listener is registered, so action/event ordering must be tested; a timeout or empty/malformed completion is an uncertain outcome, not a retry signal.
- Require existing output checks before export and verify returned output paths stay within the authorized destination. Never delete input media or overwrite implicitly.
- Use AbortSignal and bounded timeouts. On cancellation after a mutation, report uncertainty and ask the client to inspect/reconcile rather than retry.

## Development platform

First acceptance target is Fedora/Linux. Keep executable discovery and process lifecycle behind a Linux adapter boundary. Do not infer Windows/macOS support from upstream cross-platform claims. The HTTP API starts with the app and depends on a real desktop renderer; headless FFmpeg runs cannot prove editor acceptance.
