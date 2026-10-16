# Performance audit implementation

The backend and frontend audit fixes are committed individually after verification.

| Finding                 | Implemented change                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import command lock     | Per-conversation transactions and asset coordination replace the archive-wide command lock.                                                               |
| FTS deletion scans      | Indexed relational mappings identify FTS documents by rowid.                                                                                              |
| Idle dispatcher scans   | Wake notifications and scheduled lease/job deadlines replace the 100 ms loop; active queries have indexes.                                                |
| Idle SSE queries        | Commit notifications wake session subscribers, with slow fallback polling and cursor replay. Cancellation exits cleanly.                                  |
| Streaming turn rebuilds | Incremental projections and append patches preserve durable recovery, with less frequent full snapshots.                                                  |
| Duplicate message JSON  | Canonical message JSON supplies a generated content projection; lightweight summaries omit message bodies.                                                |
| Event retention         | Revision changes remove obsolete events while retaining current-revision replay.                                                                          |
| F1–F3 streaming UI      | Reference fast paths, stable per-turn tool maps, cached turn lookup/revision metadata, consolidated cursor updates and throttled sidebar synchronization. |
| F4 persistent cache     | Bounded size estimation rejects oversized histories without serializing the entire conversation.                                                          |
| F5 code highlighting    | Debounced highlighting and lazy grammars; current plain text remains visible while highlighting catches up.                                               |
| F6 pinned messages      | Construct either grouped or flat elements.                                                                                                                |
| F7 bulk exports         | Compress entries with backpressure before fetching another history; recent exports stop pagination once enough sessions are found.                        |
| F8 attachments          | Asynchronous canvas encoding replaces synchronous data URL compression.                                                                                   |
| B1 generation deltas    | Text buffers and checkpoint gating avoid constructing snapshots for discarded deltas.                                                                     |
| B2 search               | SQLite produces bounded snippets instead of transferring complete matching documents.                                                                     |
| B4 static files         | Routes that do not need redirect decisions bypass database authentication.                                                                                |
| B5 approvals            | Approval reads filter validity without running cleanup updates on each poll.                                                                              |

Stored images retain `private, no-store` (B3). A reusable image cache needs account/logout/deletion invalidation to preserve the existing privacy behavior.

Verification includes frontend formatting, lint, type checking and tests; backend formatting, vet and tests; cancellation stress tests; replay/recovery tests; and allocation microbenchmarks for incremental generation. These establish correctness and reduced work in tested paths, not production latency improvements. Remote profiling and Chrome/React performance captures remain deployment validation.

Remaining scaling costs include immutable history array copies, final compressed export bytes in browser memory, and current-revision replay retention. The canonical message migration performs a one-time schema/data conversion; migrations should be included when evaluating upgrade duration on a large database.
