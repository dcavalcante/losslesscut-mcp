# Feasibility and evidence

Research checked 2026-10-18 against LosslessCut `master` docs/source and the local Fedora environment.

## Findings

| Capability | Class | Evidence / limit |
| --- | --- | --- |
| Open media/project through `openFiles` action | Supported, untested | Documented API example and `openFilesActionArgsSchema` in upstream renderer types. Real request not run here. |
| Invoke a UI keyboard action through HTTP | Supported, untested | `POST /api/action/:action`; most actions await renderer acknowledgement, not all. Experimental API. |
| Await export start/complete | Supported, untested | Docs name both events. Main source installs a handler per await request and removes it on resolve/abort. No subscription acknowledgement and no explicit failure reason. |
| Inspect media streams | Verified locally (tool availability) | `/usr/bin/ffprobe` exists. No media probe executed in this kickoff. It is direct media tooling, not LosslessCut integration. |
| Read/write `.llc` segment plans | Supported, untested | Upstream Zod schemas show v1/v2 and segment fields. No compatibility fixture has been reopened in the real app here. |
| Import/export CSV segment plans | Supported, untested | Docs specify comma-separated seconds and labels; blank end denotes a marker. |
| Current editor state / stream selections over API | Unsupported by documented surface | API is action-based; no documented state query. Source inspection found events for export only, not a general state endpoint. |
| Structured export failure diagnosis | Unsupported by documented event contract | `export-complete` has `paths` on success; failure reason is not documented. Empty/malformed events must be treated as failure/uncertainty. |
| Multi-input timeline / named grouped outputs / general batch engine | Unsupported natively | Upstream docs say the editor works per source, not as a conventional multi-clip timeline or full batch tool. |
| Arbitrary lossy editing through LosslessCut | Unsupported in normal workflow | Upstream docs describe cuts/remux and say many transformations requiring re-encoding are not supported. |

## Local application and spike

- Fedora Linux; `losslesscut` resolves to `/var/lib/snapd/snap/bin/losslesscut`; installed snap image is `/snap/losslesscut/143`. The LosslessCut version could not be read because the snap launcher fails before app startup.
- `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` are present. Desktop session variables exist. At inspection time no LosslessCut process was running.
- The initial MCP server built and completed a real stdio `initialize`/`tools/list` handshake. A real `tools/call` to `losslesscut_api_status` received `fetch failed` from `127.0.0.1:8080`, consistent with the absent API process. This verifies only MCP plumbing and negative discovery, not LosslessCut integration.
- `snap list`/launch fails before the app starts: `snap-confine is packaged without necessary permissions and cannot continue; required permitted capability cap_dac_override not found in current capabilities`. Directly executing the snap binary fails Chromium sandbox initialization (`Operation not permitted`). I did not disable the Electron sandbox or attempt to bypass Snap confinement.
- Therefore no successful API connection, GUI open, edit/export, event ordering, resulting media probe, or LosslessCut acceptance test was performed. No mocked success is claimed. The real-app spike is blocked by the installed package/runtime sandbox under this execution environment; retry with an official upstream Linux AppImage or a supported desktop context in a later exclusive integration session.

## Project setup validation

- The TypeScript project built and `npm test` passed three API-status unit cases (expected LosslessCut root signature, unrelated local response, and connection error). A fresh `npm ci` from the generated lockfile succeeded. Validation ran under Node.js 26.8.1/npm 11.19.0, not the pinned Node.js 22.23.3/npm 10.9.9; the declared-toolchain check correctly rejects this host.
- A real MCP stdio initialize and tools/call exchange passed. The API status call returned `reachable: false` because the editor API was not running.
- This host has Node.js 26.8.1 and npm 11.19.0 (other installed local Node versions are 24.x), while the project pins Node.js 22.23.3 and npm 10.9.9. The toolchain check correctly rejects the host Node version.
- The initial offline attempt lacked cached registry metadata, but a registry-enabled install later generated `package-lock.json` and `npm ci` installed the locked dependencies. Biome format, lint, TypeScript check, build, and unit tests pass. Validation on the declared Node/npm versions remains outstanding.
- The new workspace was initialized as a local Git repository and uses the configured signing setup. No remote was added and nothing was pushed.

## Existing solutions and product rationale

Searches for `losslesscut-mcp` did not surface an existing dedicated LosslessCut MCP project or npm package in the results checked. Comparable media MCP projects exist, including `media-mcp-editor` and `mcp-video-editing`, and several expose broad FFmpeg workflows. Their existence does not replace a LosslessCut-specific adapter: this project's reason to exist is to create/reuse native `.llc` cut plans, operate LosslessCut's editor/export path, and return verifiable outputs while keeping direct probing clearly labeled. This rationale remains provisional until the real workflow is demonstrated.

## Candidate workflow assessment

| Workflow | Value | Mechanism / evidence | Priority and status |
| --- | --- | --- | --- |
| Inspect streams/duration | Lets an agent plan valid cuts and verify results | FFprobe direct; executable exists locally, no probe run yet | P0 support utility; direct media tooling |
| Open media or project | Puts planned work in the user's native editor | `openFiles` API and CLI documented/source typed | P0; supported, untested |
| Create segments and save/load project | Gives the agent a reusable, reviewable cut plan | `.llc` v2 source schema; filesystem project authoring plus real app import needed | P0; source-backed, untested |
| Export selected ranges | Completes the core editing task | API `export` action and export events | P0; event ordering and failure results untested |
| Remove unwanted sections | High-value interview/recording cleanup | Represent retained ranges in native project and use inverse segments if supported by project state | P1; exact project setting semantics unverified |
| Merge retained segments | Produces one trimmed result instead of separate clips | Native UI exposes merge mode, but project persistence/API control of export mode is not yet confirmed | P1; verify before supporting |
| Batch multiple source files | Useful for repetitive cleanup | CLI/API are basic; editor is not designed as batch toolkit | P2; candidate, serial isolated projects only |
| Select streams / remux container | Useful where tracks/container must change | UI documented; API state/configuration path not established | P2; untested/experimental |
| Detect silence or scene boundaries | Helps propose cut points | Built-in UI detectors; no API result endpoint documented | P3; unsupported for automation unless export/import format provides a verified path |
| Review and approve cut plan | Prevents accidental media changes | MCP can present a native project and await an explicit client export call | P1 product behavior; acceptance/design still required |
| Arbitrary transforms such as crop/re-encode/effects | Broader video editing | LosslessCut docs say common re-encoding operations are not supported in normal edit path | Out of scope; use a separately named integration if later needed |

## Risks to resolve with acceptance evidence

1. Event listener registration vs export action ordering: the API does not acknowledge registration. Build a test that catches a fast synthetic export event without fixed sleeps; if impossible, constrain support or ask upstream for an acknowledgement/event subscription mechanism.
2. Shared GUI and concurrency: only one operation can safely mutate the active editor session. The MCP must serialize conflicting operations and surface manual GUI interference.
3. Ambiguous exports: event timeout, no `paths`, process exit, or output mismatch must not trigger blind retries. Reconcile file and process state, then report uncertainty.
4. Version and project compatibility: `.llc` v2 shape is source-backed but not a compatibility promise. Keep representative fixtures by tested app version.
5. File safety: symlink traversal, same-name outputs, stale files, and unexpected destinations need explicit checks.
6. Formats: FFprobe-readable does not guarantee LosslessCut playback/export support. Test containers/codecs individually.
7. Licensing: LosslessCut's source repository is GPL-2.0; this server uses its separate HTTP interface and does not copy/link upstream code. Review dependency licenses before release.

## References

- [LosslessCut HTTP API](https://github.com/mifi/lossless-cut/blob/master/docs/api.md)
- [LosslessCut CLI](https://github.com/mifi/lossless-cut/blob/master/docs/cli.md)
- [LosslessCut usage and project formats](https://github.com/mifi/lossless-cut/blob/master/docs/index.md)
- [HTTP server implementation](https://github.com/mifi/lossless-cut/blob/master/src/main/httpServer.ts)
- [Event wiring and app lifecycle](https://github.com/mifi/lossless-cut/blob/master/src/main/index.ts)
- [Project and segment types](https://github.com/mifi/lossless-cut/blob/master/src/renderer/src/types.ts)
- [Segment serialization](https://github.com/mifi/lossless-cut/blob/master/src/renderer/src/segments.ts)
- [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server)
