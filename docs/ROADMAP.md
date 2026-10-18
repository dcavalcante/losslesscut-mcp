# Outcome-based roadmap

## Current scope, plainly stated

LosslessCut is a broad desktop editing application; this MCP currently has **five registered tools**: API status, read-only media inspection, read-only LLC project inspection, project open (unverified), and selected-segment export (verified). Only export completes a native editing workflow. The MCP does not create or edit projects, control tracks, merge outputs, batch files, or analyze scenes/silence. See [CAPABILITIES.md](CAPABILITIES.md) for the native-vs-automation-vs-MCP inventory.

Milestone order is by product outcome. A capability with an upstream dependency remains separately scoped; MCP work continues through existing interfaces where safe.

## M0 — Native feasibility completed

**Outcome:** prove at least one real LosslessCut edit through MCP.

**Status: Done.** On Fedora/Linux, LosslessCut 3.69.0 source build `448348bd` loaded an LLC v2 fixture and exported two selected ranges through a real MCP stdio client. Native events, output paths, streams, durations, decode and unchanged input hashes were checked. Confirmation-enabled export returned an uncertain outcome without a false success claim. Test harness owns and cleans isolated application instances. Details: [FEASIBILITY.md](FEASIBILITY.md).

**Exit evidence:** `tests/integration/acceptance.mjs`; latest retained run `/tmp/losslesscut-mcp-acceptance-zrQFDx`.

## M1 — Capability mapping

**Outcome:** make the gap between LosslessCut’s native feature set and MCP automation explicit, with evidence and dependencies.

**Status: Static inventory complete; action-level mapping and native runtime verification ongoing.** [CAPABILITIES.md](CAPABILITIES.md) maps meaningful feature families from upstream README, usage/project docs, CLI, API, and source/runtime evidence. Each row states native support, external mechanism, MCP status/evidence, blocker, priority, and scoped task dependencies. The initial inventory is complete; individual keyboard/API actions and additional native behaviors still need bounded verification. Unknowns remain UNTESTED; documented UI features are not treated as remotely controllable.

**Exit criteria:** initial static feature-family inventory has all required fields and one of VERIFIED, PARTIAL, BLOCKED, UNSUPPORTED or UNTESTED; cross-links resolve; implementation claims match the tools in `src/mcp/server.ts`. Action-level checks and further native runtime evidence remain ongoing after this inventory exit.

## M2 — Private session and reliability

**Outcome:** make each consequential edit operate on an app session whose lifecycle and outcomes the MCP can bound and identify.

**Status: Planned; initial lifecycle probe recorded.** The harness starts LosslessCut with isolated config and Electron user-data paths; a second launch against that same disposable profile exited without binding another API port. This does not prove exclusive session access: the loopback API is unauthenticated, and the product MCP still attaches to a caller-managed instance. Remaining work includes occupied-port and unrelated-instance cases, failure/forced-cleanup handling, and a safe production launch/ownership boundary. Improve timeout recovery and export failure reporting. See [FEASIBILITY.md](FEASIBILITY.md).

**Exit criteria:** competing user/app sessions cannot silently receive edits; startup or export ambiguity yields a stable actionable result; integration tests cover startup races, app exit, confirmation, late events and owned-process cleanup.

## M3 — Practical editing tools

**Outcome:** let an agent inspect input, prepare a reviewable cut plan, and execute the existing native export safely.

**Status: In progress.** T3 media inspection and T4 LLC inspection are implemented and protocol-tested; they have no T1/T2 dependency. Next author/update LLC projects and exercise separate, merged, and selected output modes only when settings and results can be verified.

**Exit criteria:** a real MCP workflow inspects source media and project ranges, creates or revises a reviewable project without mutating source files, and exports only after explicit request; independent FFprobe checks and no-overwrite tests pass.

## M4 — Advanced features

**Outcome:** expand only into high-value native features with typed parameters and observable results.

**Status: Planned.** Candidates include stream/track selection, remux/container choice, chapter/EDL conversion, subtitles, snapshots/frame extraction, and scene/silence suggestions. Native feature presence alone is not acceptance. Each candidate must identify an automation path, maintain clear boundaries between LosslessCut edits and external analysis, and pass a disposable-fixture acceptance test before its status changes.

**Exit criteria:** each shipped advanced capability has isolated evidence, output validation, failure coverage, and an updated matrix row. Do not bundle unrelated feature families into a broad dispatcher.

## M5 — Portability and distribution

**Outcome:** support additional platforms and deliver a usable install/release experience without overstating coverage.

**Status: Planned.** Linux is the only platform validated here. Verify packaged Linux builds and then Windows/macOS process lifecycle, loopback security, app-data isolation, FFprobe availability, clean shutdown, and native export. Add installation/client examples and release packaging only for verified combinations.

**Exit criteria:** a clean installation follows README end-to-end; CI covers deterministic quality checks; each advertised OS/app package has recorded native acceptance or remains explicitly unsupported.

## Ranked next tasks

Ranks combine user value, implementation feasibility and risk. Dependencies are task IDs below. These are small evidence-led slices; the first items do not require upstream changes.

| Rank / ID | Task and outcome | User value | Feasibility | Risk | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / T1 | Probe private LosslessCut session lifecycle and choose a safe product mode | High | Medium | High | M0 | A disposable real app can be identified as MCP-owned or rejected as unrelated; test occupied port, existing GUI instance, startup failure, renderer readiness, normal shutdown and forced cleanup; never kill an unowned PID. Record exact ownership boundary before expanding mutations. |
| 2 / T2 | Exercise and document export recovery cases | High | High | Medium | M0 | Acceptance covers app exit during export, confirmation timeout, late completion, stale file, malformed/failed event and duplicate request. Results never trigger blind retry or false verified success; report includes captured logs and output inventory. |
| 3 / T3 | Add read-only media inspection tool | High | High | Low | M0 | **Done:** official MCP client/server request-response over linked transport returns FFprobe format, duration, streams/codecs; rejects unauthorized, missing and malformed media; verifies inputs unchanged and labels media facts separately from editor state. |
| 4 / T4 | Add read-only LLC project inspection tool | High | High | Low | M0 | **Done:** official MCP client/server request-response over linked transport inspects v1/v2, markers, selection and tags; rejects malformed ranges and escaped media references; verifies no input changes. |
| 5 / T5 | Create a reviewable LLC v2 cut project | High | Medium | Medium | T1, T3, T4 | MCP creates a new project from authorized media and validated ranges in an authorized destination; refuses overwrite, validates resulting LLC in LosslessCut, preserves source, then native export reproduces the planned ranges. |
| 6 / T6 | Update selected ranges and persist a project revision | High | Medium | High | T1, T4, T5 | Explicitly named output project is created without modifying original; unrelated metadata is preserved; external revision/collision check is tested; LosslessCut reopen confirms resulting selected ranges and export fixture matches. |
| 7 / T7 | Add a basic verified seek/preview control, or keep it out | Medium | Medium | Medium | T1 | Real API action is sent through a narrow typed tool; result is observable through an accepted readback/GUI evidence path. If not, matrix stays PARTIAL and no seek tool is released as successful. |
| 8 / T8 | Test merged export and output ordering | Medium | Medium | Medium | T1, T2, T5 | Disposable fixture exports selected segments in known order to one merged output; FFprobe/decode checks duration, streams and order markers; unsupported stream combinations fail clearly; separate mode remains unchanged. |
| 9 / T9 | Verify stream selection, remux and chapter/EDL behavior | Medium | Low-medium | Medium | T1, T2, T5 | Choose one narrow high-value case; test actual LLC/config representation, native reopen, resulting stream/metadata properties and negative cases. Update only that family’s status from UNTESTED when evidence exists. |
| 10 / T10 | Validate packaged Linux, then one additional platform | Medium | Medium | High | T1, T2 | App package launches with isolation and API guard, performs native acceptance, records exact app/runtime versions and cleans owned processes; unsupported packages/platforms remain unadvertised. |

Recommended immediate sequence: **T3/T4 (complete, independent) → T1/T2 reliability → T5 → T6/T8 → T9 → T10**. T3 and T4 do not depend on T1 or T2. Keep native GUI acceptance serialized and do not run competing application workflows concurrently.

## Separate upstream opportunities

These are not MCP milestones and do not block all project work. Investigate or submit narrowly scoped upstream proposals only with reproducible cases and maintainer review:

| Upstream opportunity | Evidence / value | Relationship to MCP work |
| --- | --- | --- |
| Renderer readiness status or explicit ready event | HTTP root responds before renderer is ready; initial API open timed out. A status signal would remove log-marker-based readiness in the harness and enable safer app ownership. | Helps T1; T3/T4 and project-file work can proceed independently. |
| Propagate renderer action failures to HTTP response | Invalid action returned HTTP 200 with empty body; source catches action errors. | Improves T1/T2 and direct open/seek diagnosis; current export still uses events and file validation. |
| Export operation IDs, listener-registration acknowledgement and structured failure details | Current events are uncorrelated and await-event provides no subscription-ready response. | Would strengthen T2 and concurrent recovery; maintain serial operations and conservative uncertainty without it. |
| Stable typed project/editor-state inspection and mutation API | Current generic keyboard-action route has no state readback and action contracts can change. | Would help T4–T7, but LLC file inspection/authoring and read-only tools should not wait for acceptance. |

Track upstream suggestions separately from product work. Do not create a fork or make MCP milestones depend on an upstream merge unless a specific capability is otherwise unsafe or impossible.
