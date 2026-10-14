# Conversation import

Settings → Import (`/settings?tab=import`) accepts a ChatGPT export ZIP.
Choose an archive and click Import. The page shows upload progress, then live
conversation import progress. The server validates the archive before writing.
A cancelled or failed import
may have saved complete conversations. Retry; deduplication
skips those conversations. Delete an imported conversation to allow it to be
imported again. Reimporting an updated source conversation does not merge it.

## Privacy and storage

The browser and server require localhost/loopback access. Files are sent directly
to the local backend. The server spools uploads into
owner-only temporary files and removes them when the request finishes. An abrupt
process or machine crash can leave a temporary file behind in the OS temporary
directory. Archive members are never extracted to filesystem paths.

Import makes no provider calls and returns only aggregate counts. Source text,
filenames, and identifiers are excluded from import errors and logs. Account
profile, custom instructions, and other unrelated export files are ignored.
External Markdown images are blocked when displaying imported messages and
reasoning. Imported raster images use the existing inline base64 database format.
S3 is not implemented. Continuing an imported conversation uses the normal chat
flow and sends history to the selected provider.

## Mapping

The ChatGPT adapter reads `conversations.json` and split files matching
`conversations-<number>.json` or `conversations_<number>.json`, including nested
archive directories. It follows `current_node` and `parent` pointers, rejects
cycles/missing parents, and imports only the selected path. Alternate nodes are
counted and excluded.

Titles, creation/update times, explicit pin times, user/assistant text, exported
thought text, reasoning recaps, and supported local raster images are retained.
Audio/video binaries, PDFs, other attachments, account instructions, unsupported
message types, and structured citations/search metadata are excluded. Text in
multimodal object parts, such as audio transcriptions, can be retained.

Image references resolve only to unambiguous archive basenames (with an optional
`.dat` suffix). Image type comes from the bytes, not the extension. PNG, JPEG,
WebP, and GIF are supported. Missing, oversized, or unsupported image references
are counted and skipped. Images embedded as Markdown URLs are not fetched.

Historical model slugs go into message `model`, independently of the current model
catalog. `modelName` gets a conservative display label, such as `gpt-6-thinking`
→ `GPT-6 Thinking` or `gpt-4o-mini` → `GPT-4o Mini`. Unknown model IDs are preserved.
Session generation settings use Kairos defaults;
ChatGPT model slugs never select a provider for new replies. Consecutive assistant
records form one history turn, with reasoning and answer steps retained.

ChatGPT's generated UI is normalized during import. Box/row/title/text layouts
become fenced text blocks, retaining visible text and literal HTTP(S) button URLs.
Icons and executable button expressions are discarded. `Link` elements become
ordinary Markdown links; unresolved `Cite` references receive an explicit
unavailable-citation marker. Unknown self-closing components remain literal text.
Code examples are preserved. These conversions apply to the next import; there
is no retrospective database rewrite.

Message timestamps convert seconds to milliseconds. Missing or non-monotonic
times receive stable ordering timestamps; the original converted timestamp is
retained in message `details.sourceTimestamp`. Source message IDs and format are
also retained in `details`. Conversation provenance lives in `chat_imports`,
unique per user, format, and source conversation ID.

## Limits and large archives

- 512 MiB uploaded file; a 200 MiB ZIP is supported.
- 2 GiB total declared expanded ZIP size and 20,000 archive entries.
- 256 MiB per conversation JSON file; 100,000 conversation records per archive.
- 20 MiB per image; 64 MiB retained text and image bytes per conversation.
- One active import/preview per server process.

The browser sends the File directly instead of reading it into a large string or
ArrayBuffer. The server uses ZIP random access over the temporary file, streams
JSON arrays one conversation at a time, and loads referenced images individually.
Memory still scales with the largest individual conversation, its inline image
data, JSON decoder buffers, and serialization overhead. It does not scale with
the entire uploaded ZIP. Inline base64 storage increases database size.

Import requests validate the entire archive before writes, then decode it again
for persistence. Each conversation and its provenance commit in one transaction.
If storage or cancellation interrupts the second pass, earlier complete
conversations remain saved and retry is safe. The archive is uploaded once per
import request; no staged private archive is retained between requests.

## Adding a format

Implement `conversationImporter` in a format-specific Go file. `Source()` returns
a stable format ID; `Walk()` emits normalized `importConversation` and
`importMessage` records plus retention/skipping counts. A nil image store means
preview: validate local assets and count images without encoding them. The
adapter must validate its format, identifiers, graph, and resource limits, and
must never fetch external assets or expose source data in errors.

Register the factory in `conversationImporters` and add its label, accepted file
types, and mapping/limit descriptions to frontend `conversationImportFormats`.
Shared transport uses `POST /api/imports/{source}?mode=import` with
`Accept: text/event-stream` for live progress. Events contain only aggregate
validation/import progress and the final report. Browser upload progress uses
XMLHttpRequest upload events. Transactional persistence, cancellation, and
per-format deduplication are reused. The counts-only `mode=preview` API remains
available for validation tools, without a separate UI step.
Use synthetic fixtures only. `importImageStore` provides a boundary for future
storage work; S3 references will also require corresponding message/rendering
support and an explicit decision about off-machine data storage.
