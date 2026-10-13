# Runtime decisions

Kairos keeps SQLite and a single Go service. A focused transactional queue uses stable run IDs, expiring ownership tokens, and a per-conversation active-run constraint. No extra database or queue service is required. River is not needed for this small queue; retaining the existing modernc driver avoids a second persistence stack.

Completed provider transcripts stay in chat_messages. User-visible turns are backend projections with a stable assistant_message_id and ordered steps, checkpointed in chat_runs.turn_json. Model rounds never become separate visible turns. Existing transcripts are projected without deleting historical records.

Commands serialize through SQLite transactions. Conversation revisions fence mutations; leases fence workers. Queued work is recovered automatically. Expired active execution is marked interrupted, retaining partial output, rather than replaying uncertain external tool effects. Explicit retry replaces output in the same assistant turn. Cancellation is terminal and prevents visible late writes.

Full turns establish state in snapshots and terminal events. Streaming events journal compact path changes and string suffixes with their checkpoints in one transaction. Clients apply ordered cursors and reconcile with authoritative snapshots. After delivering a snapshot, the server only streams events newer than its cursor. Token checkpoints are batched at 100 ms, with immediate first progress. The old memory broker is removed. SQLite is the event source; each SSE connection polls ordered events every 50 ms and begins with a complete snapshot.

See [agent-runtime.md](agent-runtime.md) for state transitions, API contracts, migration and operational details.
