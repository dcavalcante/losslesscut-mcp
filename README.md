# LosslessCut MCP

An MCP server for asking the LosslessCut desktop editor to prepare and export precise, lossless media cuts. The goal is to keep LosslessCut's native project and export behavior at the center, rather than wrapping arbitrary FFmpeg commands.

**Status: feasibility and project setup.** The stdio server has one diagnostic API status tool; no media editing tools are implemented yet. Real editor acceptance is blocked in this environment (see [feasibility](docs/FEASIBILITY.md)). The initial target is Fedora/Linux.

## Direction

LosslessCut has an experimental loopback HTTP API for opening files, invoking UI actions, and awaiting export events. Projects use a documented JSON5 `.llc` format; project files contain segment ranges. The proposed first usable workflow is to inspect a media file, create a disposable native project with selected time ranges, open it in LosslessCut, export the cuts, and verify the output with FFprobe. Only the API-backed editor actions count as native integration. FFprobe is used for inspection and verification, not to perform edits.

The API is unauthenticated, editor-state introspection is limited, and export completion currently has no demonstrated failure detail. Do not enable the API on an untrusted multi-user machine. See [architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md).

## Development

Requirements: Node.js 22.23.3, npm 10.9.9, LosslessCut with `--http-api` enabled, and FFmpeg/FFprobe for disposable acceptance fixtures. Current setup:

```sh
npm install
npm run build
npm start
```

Then add this process as a stdio MCP server in your client. The only implemented tool currently checks `127.0.0.1:8080`; it cannot edit media yet. The server must use stdio for MCP and must never write logs to stdout.

The first release will document the app launch/API configuration explicitly and will not claim Windows or macOS support until tested. Current setup and feature status are tracked in the linked docs.

## License

MIT. LosslessCut is a separate GPL-2.0-licensed application; this project communicates with its documented local API and does not copy or link its implementation.
