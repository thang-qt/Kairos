# Conversation export

Settings → Export (`/settings?tab=export`) downloads a ZIP archive containing one
JSON, Markdown, or plain text file per conversation, plus an `index.json` mapping
conversation titles and IDs to filenames. Numbered filenames prevent collisions
when conversations have the same title. The conversation sidebar still exports one
conversation at a time.

Choose all conversations, an inclusive date range, or the most recent N.
Selection uses conversation last-updated timestamps, with date boundaries in
the browser's local time. Pinned conversations do not take priority. A selected
conversation includes its complete current history, including messages outside
the date range.

Export reads every page of the authenticated user's conversations and fetches
selected histories from the server. It does not depend on loaded sidebar items
or cached messages. JSON contains conversation metadata and message records;
Markdown and plain text contain user and assistant message text. Attachment
files are not bundled, and JSON exports cannot currently be reimported through
the ChatGPT importer.

The page shows progress and supports cancellation, including during ZIP compression. A failed or cancelled export
does not download a partial file. Exports are assembled in browser memory;
large histories may take time and require a smaller date range or count.
Conversations edited during export may reflect changes made while it runs.

The single-conversation exporter also fetches complete authoritative history
before formatting, rather than reading the React query cache. A failed fetch
reports an error and produces no download. A running conversation exports its
committed server snapshot at fetch time; local optimistic turns are excluded.
Ephemeral conversations remain client-owned and are not part of persisted
conversation exports.
