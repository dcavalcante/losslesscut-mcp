# Feasibility and test evidence

Research and runtime snapshot: 2026-10-18. Runtime evidence below is from Fedora/KDE, source-built LosslessCut 3.69.0 (`/home/daniel/Projects/lossless-cut`, revision `448348bd`) with its normal Electron sandbox enabled.

The current-upstream feature audit for this planning pass reviewed LosslessCut’s [README feature list](https://github.com/mifi/lossless-cut#features), [usage and project documentation](https://github.com/mifi/lossless-cut/blob/master/docs/index.md), [CLI documentation](https://github.com/mifi/lossless-cut/blob/master/docs/cli.md), [HTTP API documentation](https://github.com/mifi/lossless-cut/blob/master/docs/api.md), and the linked main-process/renderer source. The resulting feature-by-feature implementation map is maintained in [CAPABILITIES.md](CAPABILITIES.md); this file preserves runtime feasibility evidence and known interface constraints.

## Verdict

**A genuinely useful, narrow LosslessCut MCP works through current interfaces.** A real MCP client opened an LLC v2 project through the LosslessCut HTTP API, triggered native export of two selected ranges, observed export events, and verified both generated MP4 files using FFprobe and a full FFmpeg decode. Source media and project hashes were unchanged. The product MVP is therefore native project opening plus verified separate-segment export, with fail-closed uncertainty handling.

The limits are material: the API does not expose editor state; action errors can be swallowed despite HTTP 200; export confirmation can block; event subscriptions have no ready acknowledgement or request ID; and operation serialization covers only one MCP process. The product attaches to an already running LosslessCut instance; only the acceptance harness currently owns launch and cleanup.

## Existing solutions

The bounded GitHub/npm search for this kickoff found several general-purpose FFmpeg/video MCP projects, including [media-mcp-editor](https://github.com/ofekfell/media-mcp-editor) and [mcp-video-editing](https://github.com/mfortne/mcp-video-editing), but did not surface a dedicated LosslessCut MCP package or repository. That search is not proof none exists. These projects establish that generic media editing through MCP is already served; the meaningful reason for this project is native LosslessCut `.llc` project and GUI export integration with verified outcomes, not a competing generic FFmpeg dispatcher.

## Reproducible native acceptance

Command:

```sh
LOSSLESSCUT_EXECUTABLE=/home/daniel/Projects/lossless-cut/dist/linux-unpacked/losslesscut \
LOSSLESSCUT_KEEP_TEST_OUTPUT=1 npm run test:acceptance
```

The harness generated a 12-second H.264/AAC MP4 with one-second keyframes and an LLC v2 project with selected ranges `[1,3]` and `[5,7]`. It created separate temporary app config and Electron user-data directories, selected an available loopback port, waited for HTTP and renderer readiness, ran the workflow through MCP stdio using the official MCP client, FFprobed and decoded outputs, then terminated only the application children it started.

Latest passing evidence: `/tmp/losslesscut-mcp-acceptance-vz0g87`.

- Two outputs: `fixture-00.00.01.000-00.00.03.000-keep-1.mp4` and `fixture-00.00.05.000-00.00.07.000-keep-2.mp4`.
- Each is 2.026667 seconds with H.264 video and AAC audio; FFmpeg decoded both without error.
- The original fixture and LLC project SHA-256 values matched before and after.
- The API status probe verified hostile Host and browser Origin rejection.
- After export, the harness dispatched documented `goToTimecodeDirect` with `{ "time": "00:02" }`; HTTP returned 200, but no playhead readback exists, so the seek effect remains unverified.
- A deliberately invalid action also returned HTTP 200 with an empty body. This reproduces upstream's failure-reporting gap and justifies treating empty action responses as requests, not proof of success.
- Both app instances exited after harness SIGTERM cleanup. No LosslessCut process remained.
- With export confirmation enabled, the API returned HTTP 200 for the action but emitted no export-start event before the bounded timeout; MCP returned `uncertain` and no output. This is correctly treated as an unknown outcome, not success.

Earlier runs exposed two useful failure modes. First, HTTP root returns 200 before the renderer is ready; an initial open attempt timed out. The harness now waits for the source-derived FFprobe startup log marker emitted after renderer-ready. Second, a fixture with only one keyframe caused stream-copy exports longer than the requested ranges (about 3 and 7 seconds). A one-second GOP produced requested two-second ranges within container timing. LosslessCut's stream-copy boundaries follow keyframes; source fixture characteristics matter.

The CUA inventory exposed no native app surface, so no visual observation of the confirmation dialog or loaded segment timeline was possible. The confirmation behavior is established by configuration, missing native export-start event, and the uncertain outcome; we do not claim visual GUI confirmation or introspection of loaded segments.

## Confirmed interface behavior

| Area | Evidence and consequence |
| --- | --- |
| HTTP security | Current source guard rejects untrusted Host and any Origin; live tests return 403 for both. The guard is not present in the checked v3.69.0 tag, so the integration checks the running instance and disables mutations if absent. Local processes remain unauthenticated. |
| API root readiness | Root returns `See https://losslesscut.app/` even before renderer initialization. HTTP 200 is connectivity only. |
| Actions | `openFiles` and `export` are routed through renderer actions; the response is empty. Source catches/logs action failures, so HTTP 200 is not action proof. The acceptance harness reproduced an invalid action returning HTTP 200 with an empty body. |
| Seeking | `goToTimecodeDirect` exists upstream. A real request with `{ "time": "00:02" }` returned 200, but without editor-state readback or visible GUI this run cannot verify the resulting playhead position. |
| Events | `export-start` and `export-complete` are observable. Successful complete event includes paths. Confirmation-blocked export produced no start event and timed out. No listener-ready acknowledgement, operation ID, or useful failure payload exists. |
| Projects | LLC v2 project with relative `mediaFileName`, selected segment ranges, names, and selection loaded and exported natively. This does not prove live state introspection or project round-trip fidelity for all fields. |
| Export destination/safety | A dedicated config set the custom output directory, overwrite false, separate output mode, open confirmation false, and cleanup-after-export false. MCP required an empty authorized directory and checked reported paths and media. |
| CLI/lifecycle | Harness launched executable with `--http-api`, isolated `--config-dir`, and isolated `--user-data-dir`, preserved Electron sandbox, captured logs/PIDs, and terminated owned processes. This does not yet make the production server a process manager. |

## Read-only inspection and lifecycle spike

The `losslesscut_inspect_media` and `losslesscut_inspect_project` tools were exercised as real MCP client/server requests over the official SDK linked transport. A deterministic two-second H.264/AAC MP4 was inspected by the real FFprobe executable; LLC v1 and v2 fixtures returned expected segments, marker, selection and tags. Negative cases covered unauthorized and missing paths, malformed media/project input, invalid ranges, and an LLC reference escaping the authorized root. SHA-256 hashes and directory contents confirmed no inputs were changed and no companion files were created. The script is `tests/integration/inspection-protocol.mjs` (`npm run test:protocol`).

The native harness then launched the source-built LosslessCut process with separate disposable config and Electron user-data directories, HTTP readiness polling, and the renderer readiness marker. While this primary process was ready, the harness launched PID `1202260` with the same profile and a different HTTP port. The second process exited with code 0, did not serve its port, and primary PID `1202075` remained ready. Both app instances owned by the harness (PIDs `1202075` and `1202465`) exited on SIGTERM cleanup; the duplicate probe was reaped with exit code 0. The harness recorded stdout/stderr paths and the temporary profile directories. This confirms same-profile single-instance behavior for this source build; it does not establish isolation from unrelated profiles, exclusive API ownership, or product-side lifecycle management. The API remains unauthenticated to other local processes.

## Upstream source and primary references

- [LosslessCut API documentation](https://github.com/mifi/lossless-cut/blob/master/docs/api.md)
- [LosslessCut CLI documentation](https://github.com/mifi/lossless-cut/blob/master/docs/cli.md)
- [LosslessCut project format](https://github.com/mifi/lossless-cut/blob/master/docs/index.md)
- [HTTP API route](https://github.com/mifi/lossless-cut/blob/master/src/main/httpServer.ts)
- [HTTP request guard](https://github.com/mifi/lossless-cut/blob/master/src/main/httpServerUtil.ts)
- [Renderer actions and events](https://github.com/mifi/lossless-cut/blob/master/src/renderer/src/App.tsx)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Open risks

1. A user or second MCP server can change the attached GUI session while the workflow runs; there is no upstream session lock, state query, or operation ID.
2. Renderer action failures are swallowed, and the HTTP listener is available before renderer readiness. The harness has a source-derived readiness signal, but the installed product server cannot reliably infer it from the API.
3. Export event ordering and attribution are inherently imperfect without listener acknowledgement/correlation IDs. The current serial workflow passes acceptance but cannot rule out stale events from external GUI activity.
4. Lossless stream copy can extend boundaries to keyframes; output duration is verified but may differ from requested boundaries for inputs with sparse keyframes.
5. Application startup/display behavior is validated only in this Fedora desktop session. Windows/macOS, packaged release builds, and Snap packaging have not been verified by this project.
6. A successful FFprobe stream/duration check does not prove every metadata track, subtitle, chapter, or codec property was preserved.
