# Capability matrix

Statuses describe evidence in LosslessCut 3.69.0 source build `448348bd` on Fedora/Linux and the current MCP. **Verified** means native behavior was exercised; **Supported, untested** is confirmed by upstream interface/source only; **Experimental** is plausible but evidence or guarantees are insufficient; **Unsupported** means the current integration deliberately does not offer it; **Partial** means the operation was invoked but its result cannot be observed reliably.

| Capability | Native interface | Status | Current MCP behavior / evidence |
| --- | --- | --- | --- |
| API reachability | `GET /` | **Verified** | Checks exact root response; root does not imply renderer readiness. |
| API browser boundary | Host/Origin guard | **Verified** | Live hostile Host and Origin probes both returned 403; mutation disabled if either probe fails. |
| Open LLC v2 project | `openFiles` action | **Verified** | Real MCP acceptance opened fixture used for native export. Open tool reports `unverified` because API action errors are swallowed and editor state is not queryable. |
| Load media and inspect streams/duration | FFprobe + project media path | **Verified** | Export workflow inspects media and verifies output streams/durations. No standalone inspection tool yet. |
| Seek/playhead movement | `goToTimecodeDirect` action | **Partial** | Action invocation returned HTTP 200; playhead result could not be observed through API or available GUI surface. |
| Create `.llc` v2 selected segments | Native project file | **Verified** | Disposable project with two selected ranges loaded and exported through LosslessCut. MCP currently consumes projects; a create/edit project tool remains planned. |
| Edit live segments / select ranges in GUI | Generic actions/UI state | **Experimental** | API can dispatch actions, but editor state, action result, and supported action parameters are not reliably exposed. |
| Save/round-trip projects | Native project files / save action | **Supported, untested** | LLC v2 is documented and parsed; full arbitrary project round-trip and external modification semantics are not acceptance-tested. |
| Export selected segments separately | `export`, `export-start`, `export-complete` | **Verified** | Two native files exported via actual MCP stdio call and verified with FFprobe and decode. |
| Confirmation-blocked export | `export` action + events | **Verified** | No start event arrived before bounded timeout; MCP reported `uncertain`, produced no file, and did not claim success. Dialog was not visually inspected. |
| Merged export | LosslessCut export configuration | **Supported, untested** | Native setting exists; not included in MVP or accepted test. |
| Output naming and destination | LosslessCut config/UI | **Verified** | Dedicated profile and custom empty output directory worked. MCP requires overwrite false, separate outputs, explicit authorized directory, and empty directory. |
| Preserve input | Hashes and filesystem checks | **Verified** | Source media and project SHA-256 hashes were identical before and after export. |
| Track/stream selection, container remux | LosslessCut project/settings | **Supported, untested** | Upstream supports stream selection/remux options; no MCP tools or acceptance evidence. |
| Chapters, subtitles, metadata preservation | Project/import/export | **Supported, untested** | Formats and UI exist upstream; preservation across this workflow has not been validated. |
| CSV/EDL import/export | CLI/project conversion | **Supported, untested** | Upstream documents CSV and other formats; LLC v2 is chosen for MVP because it retains project metadata. |
| Detect silence or scene boundaries | FFmpeg/analysis tooling | **Unsupported** | Not part of LosslessCut API integration or MVP. A future analysis tool must remain explicitly distinct from native edit operations. |
| Re-encode effects, transitions, mixing | Media transformation | **Unsupported** | LosslessCut MCP is not exposing generic FFmpeg editing. |
| Batch process many sources | Multiple projects/exports | **Unsupported** | No run queue or cross-source state handling; serialize one operation first. |
| Reliable action errors and editor-state readback | HTTP API | **Unsupported** | Upstream action route returns empty success and catches errors; no state query. MCP refuses to label open as verified. |
| Reliable cross-client operation attribution | Events | **Unsupported** | No operation IDs or listener-ready acknowledgement. Current serialization is process-local; external GUI actions can race. |
| App lifecycle in acceptance | Executable + CLI flags | **Verified** | Harness starts isolated apps, waits for root and renderer marker, captures logs/PIDs, tests, and terminates owned processes. Product MCP lifecycle management is not implemented. |
| Windows/macOS packaging | Native application | **Unsupported** | Not run or claimed by this project. |
