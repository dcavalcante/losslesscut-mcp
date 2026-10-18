# Project conventions

- Keep MCP schemas, domain operations, LosslessCut integration, filesystem authorization, and configuration in separate small modules.
- Use the official TypeScript MCP SDK and Zod. Prefer narrow typed tools; never expose arbitrary keyboard actions, shell commands, or FFmpeg command strings.
- Treat the LosslessCut HTTP API as experimental and unauthenticated. Connect only to explicit loopback addresses, validate responses, and enforce bounded timeouts.
- Restrict files to configured authorized roots. Never overwrite inputs or existing outputs silently. Serialize operations that share one editor session.
- A timeout after a mutation is an uncertain outcome. Do not retry it blindly; reconcile the editor event and filesystem first.
- Use disposable synthetic fixtures for integration checks. A mocked API or FFmpeg-only run is not LosslessCut acceptance.
- Before editing, inspect Git status and existing files. Keep changes focused and commits signed where supported. Do not push, publish, or change upstream LosslessCut.
- Run the validation requested by the task and report exact evidence and untested behavior.
