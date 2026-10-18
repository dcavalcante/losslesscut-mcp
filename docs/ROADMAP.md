# Roadmap

The smallest demonstrable MVP is already proven: an MCP client opens an authorized LLC v2 project in a real LosslessCut session, exports selected segments separately, and verifies new outputs while preserving input. The shortest path to a usable first release is to harden product startup/session readiness and concurrency, add explicit project and media inspection tools, then document installation and supported-version limits.

Status: **Done** = acceptance evidence exists; **In progress** = implemented but important acceptance/engineering work remains; **Planned** = not implemented.

## M0 — Prove native feasibility (Done)

| ID | Priority | Deliverable | Dependencies | Acceptance criteria and validation | Status | Group |
| --- | --- | --- | --- | --- | --- | --- |
| M0-1 | P0 | Pin source-built app/version and verify loopback API guard | None | Record revision/version; normal root returns expected response; hostile Host and Origin both receive 403 using actual HTTP requests. | Done | Feasibility |
| M0-2 | P0 | Execute native selected-range export | M0-1 | Generate disposable audio/video MP4 and LLC v2 project; call LosslessCut through real HTTP API; observe native events; FFprobe/decode all outputs; verify input hashes unchanged. | Done | Feasibility |
| M0-3 | P0 | Test ambiguous confirmation and app lifecycle | M0-1 | With confirmation enabled, bounded wait reports uncertain and no false success; harness captures logs/PID and terminates only owned process. | Done | Feasibility |
| M0-4 | P0 | Record architecture and integration limits | M0-1–3 | Architecture decision distinguishes native editing from FFprobe verification and documents unverified state, keyframe, event, and security behavior. | Done | Docs |

## M1 — Working MCP vertical slice (In progress)

| ID | Priority | Deliverable | Dependencies | Exit criteria / validation | Status | Group |
| --- | --- | --- | --- | --- | --- | --- |
| M1-1 | P0 | Stable typed MCP tools and error outcomes | M0 | Official MCP client lists and calls status/open/export tools over stdio; structured outputs distinguish verified, unverified, known failure, and uncertain. Unit plus native acceptance. | Done | Core |
| M1-2 | P0 | Harden API readiness and session safety | M0 | Product can establish renderer-ready state or clearly refuse workflow; prevent concurrent/conflicting MCP sessions and fail closed on external changes or unresolved session ownership. Native tests include startup race and competing app/client. | Planned | Integration |
| M1-3 | P0 | Add standalone authorized media/project inspection | M1-1 | Typed read-only tools report source streams/duration and validated LLC selected ranges; tests include path denial, malformed project, missing media, and no mutations. | Planned | Tools |
| M1-4 | P1 | Reconcile ambiguous export outcomes | M1-1 | Timeout recovery inventories output names/hashes without retrying; user receives clear actionable states; test timeout, late event, stale output, and app crash cases. | Planned | Safety |

## M2 — Core editing workflows (Planned)

| ID | Priority | Deliverable | Dependencies | Exit criteria / validation | Status | Group |
| --- | --- | --- | --- | --- | --- | --- |
| M2-1 | P1 | Reviewable project creation and segment updates | M1-3 | Create validated LLC v2 from authorized input and selected ranges; round-trip in LosslessCut; preserve unrelated project metadata; no source overwrite. Native acceptance. | Planned | Projects |
| M2-2 | P1 | Export mode and stream/container options | M1-2, M1-4 | Offer only settings exposed by supported app configuration; test selected streams, output container, names, collisions, metadata, chapters, subtitles. | Planned | Export |
| M2-3 | P1 | Version compatibility policy | M1-2 | Record tested app versions/builds; reject unknown/incompatible response behavior; CI covers pure adapter contracts and dedicated manual/native acceptance covers app compatibility. | Planned | Compatibility |

## M3 — Useful agent workflows (Planned)

| ID | Priority | Deliverable | Dependencies | Exit criteria / validation | Status | Group |
| --- | --- | --- | --- | --- | --- | --- |
| M3-1 | P2 | Approval-oriented cut workflow | M2-1, M2-2 | Agent prepares a project and concise preview summary; user can review before export; acceptance covers cancel, revise, and approve. | Planned | Workflow |
| M3-2 | P2 | Serial batch workflow, if user value is demonstrated | M1-4, M2-3 | Multiple files run sequentially with per-file status and safe recovery; interruption does not duplicate exports. Benchmark fixture suite. | Planned | Workflow |
| M3-3 | P2 | Optional media analysis suggestions | M2-1 | Silence/scene suggestions are clearly labeled analysis; ranges enter a reviewable LLC project and are never silently exported. Accuracy and false-positive evaluation. | Planned | Analysis |

## M4 — Release readiness (Planned)

| ID | Priority | Deliverable | Dependencies | Exit criteria / validation | Status | Group |
| --- | --- | --- | --- | --- | --- | --- |
| M4-1 | P1 | Installation and security guidance | M1 | Fresh Linux environment can install, configure an authorized root and guarded app, connect MCP client, and run a sample workflow from README. | Planned | Release |
| M4-2 | P2 | Cross-platform and packaging verification | M2-3 | Windows and macOS each launch isolated app, pass API security/readiness, export, verify, and clean up; otherwise platforms remain explicitly unsupported. | Planned | Release |
| M4-3 | P1 | CI and release artifacts | M1 | CI installs pinned Node/npm, formats, lints, typechecks, runs unit tests, checks packaging; native acceptance runs on a documented supported Linux runner or remains an explicit maintainer validation step. | Planned | Release |
| M4-4 | P2 | Public examples and versioned release | M4-1–3 | Example client workflow and reproducible release notes; no release claim exceeds tested capabilities/platforms. | Planned | Docs |

## Recommended implementation grouping

1. **M1-2**: renderer readiness and session/concurrency design; investigate whether a narrow upstream API improvement is needed.
2. **M1-3 + M1-4**: read-only inspection and safe export reconciliation; keep these as separate reviewable changes if they touch different modules.
3. **M2-1**: project authoring after inspection contract stabilizes.
4. **M2-2 + M2-3**: only after the existing separate-export path has reliable session ownership.
5. **M3/M4**: prioritize based on demonstrated user workflow demand and actual platform test availability.

No upstream change is a prerequisite for the current narrow acceptance-tested slice. Action result/error propagation, renderer-ready status, and export operation IDs/error details are good narrowly scoped upstream candidates because they address observed limitations; do not block the project on a broad API redesign.
