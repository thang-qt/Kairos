# Assistant message phases

Responses assistant messages can carry `commentary` or `final_answer`. Kairos captures the phase per output item, including labels delivered only when an item finishes, and preserves ordered text segments. Streaming content and durable round checkpoints carry `phase` and `phaseSource` on text parts.

After each successful model round, the existing agent loop labels unphased text `commentary` if the round made tool calls, otherwise `final_answer`. Those labels have `phaseSource: "derived"`. Explicit provider labels are preserved with `phaseSource: "provider"`. In-flight text receives no derived label because a later tool call can still change its classification.

Responses follow-up requests and history replay preserve provider-supplied labels on separate assistant message input items. Derived labels are never sent to a provider. Chat Completions requests remain unchanged. Unknown or unsupported phase values retain the fallback behavior.

The frontend shows only answer text in the chat. Commentary, reasoning and tool calls go to the activity sidebar, which opens from the activity chip on each assistant turn. Final-answer text appears in the chat immediately, even when it is short and still streaming. Unlabelled streaming text retains the short-text heuristic; old saved history falls back to text after the last tool call as the answer. No migration rewrites older conversations.

For native clients, explicit backend phases are the contract. The web heuristics
are presentation compatibility for unclassified in-flight provider output and
legacy history, not a second classification policy to implement in Android. A
client can display unphased text provisionally and update it when the backend
supplies the phase. Do not write a guessed phase back to the server or use it to
control execution. See the [chat API contract](chat-api-contract.md).
