# Conversation import

In the web app, open **Settings → Import** and choose a ChatGPT export ZIP.
Kairos shows upload and import progress. A cancelled or failed import may have
saved complete conversations; retrying skips those already imported. Delete an
imported conversation to import it again. Reimporting an updated source
conversation does not merge it into the existing copy.

## What is imported

Kairos imports the selected conversation branch, including titles, timestamps,
user and assistant text, exported reasoning, and supported local images.
Alternate branches, audio/video files, PDFs, other document attachments, account
instructions, and structured citation metadata are excluded. Text transcriptions
can be retained when present in the export.

PNG, JPEG, WebP, and GIF images are supported. Missing, oversized, or unsupported
images are skipped. External image URLs are not fetched. Some ChatGPT-specific
layouts become plain text or Markdown, so their appearance can change.

Historical model names are retained, but replies use your selected Kairos model
and settings. Importing does not contact a model provider. Continuing an imported
conversation sends its history to the selected provider like any other chat.

## Privacy and server access

Archives are uploaded to your Kairos server, where their contents are validated
before conversations are saved. Temporary uploads are removed after the request
finishes; a server crash may leave a temporary file for the administrator to
remove. Account profile data and unrelated files are ignored.

By default, import is available only from localhost. To allow imports from
another device, set `ALLOW_REMOTE_IMPORT=true` on the server and restart it.
Authentication and upload limits still apply.

## Limits

- Maximum uploaded ZIP: 512 MiB.
- Maximum expanded archive: 2 GiB and 20,000 entries.
- Maximum conversation JSON file: 256 MiB.
- Maximum conversation records per archive: 100,000.
- Maximum image: 20 MiB; retained text and images per conversation: 64 MiB.
- One active import or preview per server.

Large individual conversations can require substantial server memory. If an
import fails because of a limit, reduce the archive size or split its contents.
Kairos JSON conversation exports cannot currently be reimported through the
ChatGPT importer.
