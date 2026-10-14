# Session pagination

`GET /api/sessions` returns at most 50 summaries by default. Clients can request
`limit=1..100` and pass the previous response's opaque `nextCursor` to read the
next page. An absent cursor means the list is complete. Responses omit last-message
content and image bytes.

Ordering is pinned first, then update time, creation time, and session ID, all
descending. Cursor boundaries use the same indexed tuple, including the ID to
handle tied timestamps. Every page is scoped to the authenticated user. A new
chat inserted above a cursor does not shift older page boundaries as an offset
would; changing pin or update times can move rows, so the client deduplicates IDs
and refreshes canonical ordering after mutations.

The chat list uses an infinite query and fetches the next server page on demand.
The sidebar renders rows in batches of 20. It checks available space on mount,
after each batch, on scroll, and when its viewport/content resizes. This avoids
waiting for an impossible scroll event when the initial rows do not fill a tall
sidebar. A Show more button also makes later rows accessible. Pagination errors
retain loaded chats and offer retry.

Date headings are built from the currently rendered rows, using their original
update timestamps. Older sections appear as older pages and batches load. Search
queries the complete server-side search index, including unloaded conversations.

`GET /api/sessions/{friendlyId}` resolves a direct link independently of the list
cursor. Opening an old chat therefore requires one summary lookup instead of
downloading every preceding page. Optimistic rename, delete, pin, and message
updates preserve the loaded page cursors. The previous forced cache-refresh
workaround and Go to chats button have been removed.
