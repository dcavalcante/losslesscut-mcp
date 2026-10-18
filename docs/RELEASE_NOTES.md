# Proposed release notes

## v0.1.0 — proposed, not released

Initial Linux MVP for a native LosslessCut workflow:

- Inspect media streams and LLC v1/v2 projects.
- Create reviewable LLC v2 projects from validated segment ranges.
- Launch a dedicated LosslessCut process and export selected segments through its experimental local HTTP API.
- Verify new outputs with FFprobe; refuse existing output directories and report uncertain outcomes without blind retries.

Validation is limited to Fedora/Linux with source-built LosslessCut 3.69.0 (`448348bd`). Shared GUI/API exports are unsupported. The upstream loopback API has no authentication, operation IDs, or listener-ready acknowledgement. Windows/macOS and packaged LosslessCut builds are not verified.
