# Runtime decisions

Kairos keeps SQLite and a single Go service. A focused transactional queue uses stable run IDs, expiring ownership tokens, and a per-conversation active-run constraint. No extra database or queue service is required. River is not needed for this small queue; retaining the existing modernc driver avoids a second persistence stack.

Provider transcripts stay in chat_messages. User-visible turns are backend projections with a stable assistant_message_id and ordered steps, checkpointed in chat_runs.turn_json. Model rounds never become separate visible turns. Existing transcripts are projected without deleting historical records.

Commands serialize through SQLite transactions. Conversation revisions fence mutations; leases fence workers. Queued work is recovered automatically. Expired active execution is marked interrupted, retaining partial output, rather than replaying uncertain external tool effects. Explicit retry replaces output in the same assistant turn. Cancellation is terminal and prevents visible late writes.

Events contain complete turn replacements, not token deltas, and are journaled with checkpoints in one transaction. Clients can replay durable cursors and reconcile with snapshots. Token updates are batched. The memory broker is a wake-up mechanism only.
