# Roadmap

The roadmap is evidence-led and intentionally small. Status is **Blocked** only where an external app/runtime is needed; implementation planning can continue independently.

## M0 — Feasibility and architecture

| ID | Deliverable | Priority | Depends on | Acceptance / validation | Status | Grouping |
| --- | --- | --- | --- | --- | --- | --- |
| M0-01 | Confirm LosslessCut HTTP, CLI, project, and event contracts | P0 | — | Document source-backed API shapes, security, state visibility, and event limitations | Done | Research |
| M0-02 | Inspect local Fedora app and perform real cut/export spike | P0 | M0-01 | Open disposable media, apply a cut, observe terminal outcome, verify output with FFprobe, record app version | Blocked: snap confinement | Exclusive app acceptance |
| M0-03 | Choose narrow native integration and boundaries | P0 | M0-01, M0-02 | Architecture records selected path, limits, and minimum demonstrable workflow | Done with M0-02 caveat | Architecture |

**Smallest MVP proof:** a disposable `.llc` plan with two retained time ranges is opened in LosslessCut and exported to distinct files; the server observes completion and FFprobe confirms duration/streams while the input hash remains unchanged. Critical path: unblock app launch → establish event ordering → exercise `.llc` import/export → implement vertical slice.

## M1 — Working MCP vertical slice

| ID | Deliverable | Priority | Depends on | Acceptance / validation | Status | Grouping |
| --- | --- | --- | --- | --- | --- | --- |
| M1-01 | MCP stdio lifecycle, typed tool schemas, config and stable errors | P0 | M0-03 | Fresh MCP client lists/calls tools; stdout contains protocol only; invalid args rejected | In progress: lifecycle and status tool smoke-tested; config/error contract remains | Server foundation |
| M1-02 | Allowlisted loopback adapter: probe API, open authorized media/project | P0 | M0-02, M1-01 | Real app accepts file open; host/origin/redirect and timeout negatives tested | Planned | Adapter |
| M1-03 | One end-to-end native cut/export workflow | P0 | M1-02 | Disposable input preserved; export event observed; output paths and FFprobe facts match requested ranges | Planned | Exclusive app acceptance |
| M1-04 | Explicit authorized roots and no-overwrite output policy | P0 | M1-01 | Traversal/symlink/outside-root, existing output, and cancellation negatives refuse safely | Planned | Safety |

## M2 — Core editing workflows

| ID | Deliverable | Priority | Depends on | Acceptance / validation | Status |
| --- | --- | --- | --- | --- | --- |
| M2-01 | Version-aware `.llc` plan creation, inspection, and load/save | P1 | M1-03 | Fixture round-trip in each supported app version; unsupported schema fails closed | Planned |
| M2-02 | Merged vs separate exports and labels | P1 | M1-03 | Real-app acceptance for output count/order/names and stream/duration checks | Planned |
| M2-03 | Operation serialization and uncertain-outcome recovery | P1 | M1-03 | Concurrent requests serialize; induced timeout is reconciled without duplicate export | Planned |
| M2-04 | Track and container options only where exposed and verified | P2 | M2-01 | Typed options with real app acceptance per option; unsupported fields refused | Planned |

## M3 — Useful agent workflows

| ID | Deliverable | Priority | Depends on | Acceptance / validation | Status |
| --- | --- | --- | --- | --- | --- |
| M3-01 | Multi-file workflows built from isolated native projects | P2 | M2-03 | Disposable multi-file run reports per-file outcomes and safely resumes only known failures | Planned |
| M3-02 | Media analysis aids such as silence/scene suggestions | P3 | M1-03 | Separate analysis from editing; clearly mark FFmpeg-derived suggestions and validate on fixtures | Candidate |
| M3-03 | Review and approval handoff for proposed cut ranges | P2 | M1-03 | Plan preview includes source/ranges/output estimates; export requires explicit user intent | Candidate |

## M4 — Release readiness

| ID | Deliverable | Priority | Depends on | Acceptance / validation | Status |
| --- | --- | --- | --- | --- | --- |
| M4-01 | Install/config docs, examples, security note, and tested app matrix | P1 | M1-03 | Fresh setup follows README and completes a native acceptance workflow | Planned |
| M4-02 | CI, dependency/license audit, packaging and release process | P1 | M1-01 | Reproducible clean install/build/tests; release artifact starts over stdio | Planned |
| M4-03 | Windows/macOS support | P3 | M4-01 | Platform-specific install, lifecycle, and real-app acceptance each pass | Candidate |

## Development order

1. Resolve app test access and investigate event-registration ordering (M0-02/M1-03).
2. Implement tool schemas/config and loopback/filesystem safety (M1-01/M1-04).
3. Implement native open/export adapter and the one real vertical slice (M1-02/M1-03).
4. Add project authoring and only then broaden workflows (M2 onward).

The next development wave should split independent setup work from the exclusive real GUI acceptance task. Keep concurrency conservative until the app spike and toolchain have been checked on this host.
