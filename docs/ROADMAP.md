# Outcome-based roadmap

## Current scope, plainly stated

LosslessCut is a broad desktop editing application; this MCP currently has **six registered tools**: API status, media inspection, LLC inspection, LLC v2 project creation, project open (unverified), and selected-segment export (verified). Project creation prepares a reviewable project; export is the only verified native editing workflow. The MCP does not update existing projects, control tracks, merge outputs, batch files, or analyze scenes/silence. See [CAPABILITIES.md](CAPABILITIES.md) for the native-vs-automation-vs-MCP inventory.

Milestone order is by product outcome. A capability with an upstream dependency remains separately scoped; MCP work continues through existing interfaces where safe.

## M0 — Native feasibility completed

**Outcome:** prove at least one real LosslessCut edit through MCP.

**Status: Done.** On Fedora/Linux, LosslessCut 3.69.0 source build `448348bd` opened an LLC v2 project created through MCP and exported two selected ranges through a real MCP stdio client. Native events, output paths, streams, durations, decode and unchanged source hash were checked. Confirmation-enabled export returned an uncertain outcome without a false success claim. The harness and optional product lifecycle own and clean isolated application instances. Details: [FEASIBILITY.md](FEASIBILITY.md).

**Exit evidence:** `tests/integration/acceptance.mjs`; latest retained run `/tmp/losslesscut-mcp-acceptance-v2CVlh`.

## M1 — Capability mapping

**Outcome:** make the gap between LosslessCut’s native feature set and MCP automation explicit, with evidence and dependencies.

**Status: Static inventory complete; action-level mapping and native runtime verification ongoing.** [CAPABILITIES.md](CAPABILITIES.md) maps meaningful feature families from upstream README, usage/project docs, CLI, API, and source/runtime evidence. Each row states native support, external mechanism, MCP status/evidence, blocker, priority, and scoped task dependencies. The initial inventory is complete; individual keyboard/API actions and additional native behaviors still need bounded verification. Unknowns remain UNTESTED; documented UI features are not treated as remotely controllable.

**Exit criteria:** initial static feature-family inventory has all required fields and one of VERIFIED, PARTIAL, BLOCKED, UNSUPPORTED or UNTESTED; cross-links resolve; implementation claims match the tools in `src/mcp/server.ts`. Action-level checks and further native runtime evidence remain ongoing after this inventory exit.

## M2 — Private session and reliability

**Outcome:** make each consequential edit operate on an app session whose lifecycle and outcomes the MCP can bound and identify.

**Status: Supported mode verified; cross-process boundary documented.** `LOSSLESSCUT_EXECUTABLE`, `LOSSLESSCUT_CONFIG_DIR`, and `LOSSLESSCUT_USER_DATA_DIR` make the server start a dedicated profile, preflight its API port/security, wait for renderer readiness, and stop only its child process. Native acceptance showed two MCP servers sharing one API can race: one exported its own project and verified; the other saw the other media's event, returned uncertain, and was quarantined. No false verified result occurred in this experiment. Two independently owned private instances with separate profiles and ports then exported different projects with matching media-content evidence. Shared GUI/API attachment is unsupported for exports; local API calls remain unauthenticated and cannot be excluded. See [FEASIBILITY.md](FEASIBILITY.md) for evidence.

**Exit criteria:** startup failures never target a foreign listener; owned-process shutdown does not touch unrelated processes; startup/export ambiguity yields stable actionable results; integration tests cover app exit, confirmation, late events and owned-process cleanup. Do not claim exclusive API ownership without upstream authentication or correlation.

## M3 — Practical editing tools

**Outcome:** let an agent inspect input, prepare a reviewable cut plan, and execute the existing native export safely.

**Status: In progress.** T3 media inspection, T4 LLC inspection, and T5 new-project authoring are implemented and tested over MCP protocol. Native acceptance now runs inspect media → create two-segment LLC v2 → inspect project → export with LosslessCut → FFprobe outputs and compare source hash. T5 does not depend on private-session lifecycle or export-recovery completion; native acceptance can run with disposable profiles.

**Exit criteria:** a real MCP workflow inspects source media and project ranges, creates or revises a reviewable project without mutating source files, and exports only after explicit request; independent FFprobe checks and no-overwrite tests pass.

## M4 — Advanced features

**Outcome:** expand only into high-value native features with typed parameters and observable results.

**Status: Planned.** Candidates include stream/track selection, remux/container choice, chapter/EDL conversion, subtitles, snapshots/frame extraction, and scene/silence suggestions. Native feature presence alone is not acceptance. Each candidate must identify an automation path, maintain clear boundaries between LosslessCut edits and external analysis, and pass a disposable-fixture acceptance test before its status changes.

**Exit criteria:** each shipped advanced capability has isolated evidence, output validation, failure coverage, and an updated matrix row. Do not bundle unrelated feature families into a broad dispatcher.

## M5 — Portability and distribution

**Outcome:** support additional platforms and deliver a usable install/release experience without overstating coverage.

**Status: Linux MVP release candidate prepared.** A fresh Linux checkout followed the README through dependency installation, build, quality checks, protocol tests, package dry-run, and a real MCP-client demonstration with an MCP-owned source-built LosslessCut process. Proposed v0.1.0 notes are in [RELEASE_NOTES.md](RELEASE_NOTES.md); no tag or publication exists. Packaged LosslessCut builds and Windows/macOS process lifecycle, loopback security, app-data isolation, FFprobe availability, clean shutdown, and native export remain unverified and unsupported.

**Exit criteria:** Linux clean installation and native acceptance are recorded; hosted CI passes its deterministic quality checks; each advertised OS/app package has recorded native acceptance. The workflow has passed locally, but its GitHub-hosted run awaits an authorized push or pull request. Additional platforms remain explicitly unsupported until their native acceptance is recorded.

## Ranked next tasks

Ranks combine user value, implementation feasibility and risk. Dependencies are task IDs below. These are small evidence-led slices; the first items do not require upstream changes.

| Rank / ID | Task and outcome | User value | Feasibility | Risk | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| Done / T1 | Implement and test private LosslessCut process/profile lifecycle | High | Medium | High | M0 | **Done for Linux source build:** dedicated config/user-data and API ports; renderer readiness; same-profile second launch; occupied port; side-by-side ordinary/private native exports to distinct destinations; exact child cleanup with unrelated listener preserved. API remains unauthenticated, so no exclusive-ownership claim. |
| 1 / T2 | Exercise and document export recovery cases | High | High | Medium | M0, T1 | Native acceptance covers app exit after export-start, confirmation timeout, stale output, and concurrent calls in one MCP process; deterministic unit coverage simulates a late completion. Every ambiguous dispatch is uncertain and blocks retry on that API object; no overwrite, duplicate file, or false verified success. Cross-process attribution remains blocked upstream. |
| 3 / T3 | Add read-only media inspection tool | High | High | Low | M0 | **Done:** official MCP client/server request-response over linked transport returns FFprobe format, duration, streams/codecs; rejects unauthorized, missing and malformed media; verifies inputs unchanged and labels media facts separately from editor state. |
| 4 / T4 | Add read-only LLC project inspection tool | High | High | Low | M0 | **Done:** official MCP client/server request-response over linked transport inspects v1/v2, markers, selection and tags; rejects malformed ranges and escaped media references; verifies no input changes. |
| Done / T5 | Create a reviewable LLC v2 cut project | High | Medium | Medium | — | **Done:** real MCP protocol creates authorized LLC v2 from media and segment ranges, preserves optional names/tags/selection, refuses overwrite and out-of-root paths, validates on inspect, and does not export as a side effect. Native acceptance opens/exports a two-segment project and verifies outputs/source hash. |
| 6 / T6 | Update selected ranges and persist a project revision | High | Medium | High | T1, T4, T5 | Explicitly named output project is created without modifying original; unrelated metadata is preserved; external revision/collision check is tested; LosslessCut reopen confirms resulting selected ranges and export fixture matches. |
| 7 / T7 | Add a basic verified seek/preview control, or keep it out | Medium | Medium | Medium | T1 | Real API action is sent through a narrow typed tool; result is observable through an accepted readback/GUI evidence path. If not, matrix stays PARTIAL and no seek tool is released as successful. |
| 8 / T8 | Test merged export and output ordering | Medium | Medium | Medium | T1, T2, T5 | Disposable fixture exports selected segments in known order to one merged output; FFprobe/decode checks duration, streams and order markers; unsupported stream combinations fail clearly; separate mode remains unchanged. |
| 9 / T9 | Verify stream selection, remux and chapter/EDL behavior | Medium | Low-medium | Medium | T1, T2, T5 | Choose one narrow high-value case; test actual LLC/config representation, native reopen, resulting stream/metadata properties and negative cases. Update only that family’s status from UNTESTED when evidence exists. |
| 10 / T10 | Validate packaged Linux, then one additional platform | Medium | Medium | High | T1, T2 | App package launches with isolation and API guard, performs native acceptance, records exact app/runtime versions and cleans owned processes; unsupported packages/platforms remain unadvertised. |

Recommended immediate sequence: **T6 project revision/update → T8 merge behavior → choose one T9 stream/remux case → T10 portability**. T2 recovery is implemented with explicit uncertainty bounds; T3/T4/T5 are done. T5 authoring is independent of T1/T2 completion. Keep native GUI acceptance serialized and do not run competing application workflows concurrently.

## Separate upstream opportunities

These are not MCP milestones and do not block all project work. Investigate or submit narrowly scoped upstream proposals only with reproducible cases and maintainer review:

| Upstream opportunity | Evidence / value | Relationship to MCP work |
| --- | --- | --- |
| Renderer readiness status or explicit ready event | HTTP root responds before renderer is ready; initial API open timed out. A status signal would remove log-marker-based readiness in the harness and enable safer app ownership. | Helps T1; T3/T4 and project-file work can proceed independently. |
| Propagate renderer action failures to HTTP response | Invalid action returned HTTP 200 with empty body; source catches action errors. | Improves T1/T2 and direct open/seek diagnosis; current export still uses events and file validation. |
| Export operation IDs, listener-registration acknowledgement and structured failure details | Current events are uncorrelated and await-event provides no subscription-ready response. | Would strengthen T2 and concurrent recovery; maintain serial operations and conservative uncertainty without it. |
| Stable typed project/editor-state inspection and mutation API | Current generic keyboard-action route has no state readback and action contracts can change. | Would help T4–T7, but LLC file inspection/authoring and read-only tools should not wait for acceptance. |

Track upstream suggestions separately from product work. Do not create a fork or make MCP milestones depend on an upstream merge unless a specific capability is otherwise unsafe or impossible.
