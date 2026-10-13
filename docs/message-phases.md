# Assistant message phases

Responses assistant messages can carry `commentary` or `final_answer`. Kairos captures the phase per output item, including labels delivered only when an item finishes, and preserves ordered text segments. Streaming content and durable round checkpoints carry `phase` and `phaseSource` on text parts.

After each successful model round, the existing agent loop labels unphased text `commentary` if the round made tool calls, otherwise `final_answer`. Those labels have `phaseSource: "derived"`. Explicit provider labels are preserved with `phaseSource: "provider"`. In-flight text receives no derived label because a later tool call can still change its classification.

Responses follow-up requests and history replay preserve provider-supplied labels on separate assistant message input items. Derived labels are never sent to a provider. Chat Completions requests remain unchanged. Unknown or unsupported phase values retain the fallback behavior.

The frontend shows only answer text in the chat. Commentary, reasoning and tool calls go to the activity sidebar, which opens from the activity chip on each assistant turn. Final-answer text appears in the chat immediately, even when it is short and still streaming. Unlabelled streaming text retains the short-text heuristic; old saved history falls back to text after the last tool call as the answer. No migration rewrites older conversations.

Validation covers Responses SSE item tracking and late labels, preservation of explicit labels in tool rounds, derived commentary/final labels, durable checkpoint/history replay, omission of derived labels from Responses requests and all labels from Chat Completions requests, and frontend routing for phased, mixed, and legacy content.

Checks passed: `pnpm check` (78 tests in 20 files), `pnpm backend:check`, focused `go test -race` coverage for phase streaming/derivation/durable replay, and `pnpm build`. Provider behavior is verified with deterministic HTTP/SSE fixtures; no live provider emitting phase was tested.
