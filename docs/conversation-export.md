# Conversation export

In the web app, open **Settings → Export** to download a ZIP containing one JSON,
Markdown, or plain text file per conversation. The archive includes an index
mapping titles and conversation IDs to filenames. To export one conversation,
use its sidebar menu.

Choose all conversations, an inclusive date range, or the most recent N.
Date filters use each conversation's last-updated time in your browser's local
time zone. Pinned conversations do not take priority. Selected conversations
include their complete current history, including messages outside the date
range and conversations not yet loaded in the sidebar.

JSON includes conversation metadata and message records. Markdown and plain text
include user and assistant message text. Attachment files are not bundled.
Kairos JSON exports cannot currently be reimported through the ChatGPT importer.
Throwaway conversations are not included.

The page shows progress and supports cancellation. Failed or cancelled exports
do not download partial archives. Large exports are assembled in browser memory;
use a smaller date range or conversation count if necessary. Conversations
changed during export may reflect those changes, and a running answer may be
incomplete in the exported copy.
