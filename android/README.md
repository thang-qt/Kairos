# Kairos Android demo

The Compose app connects to the real Kairos HTTP backend. Sign-in, saved conversations, images, model selection, streaming, stop/retry, editing, forks, session search and settings use the same protocol as the web app. The main app offers native message rendering or an offline WebView containing the web's `MessageItem`, activity chip, tool primitives and markdown stack. The assistant overlay offers native markdown or the shared offline WebView transcript and saves normal sessions. Generation configuration is backend-authoritative (see `docs/android-backend-contract.md`): commands omit generation fields they do not genuinely override, new chats carry a `settings` draft, and acknowledgements include the frozen `effectiveConfiguration`.

## Build and install

From the repository root, with the Android devShell (`nix develop .#android`) or the supplied toolchain:

```sh
pnpm install --frozen-lockfile
cd android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

Use Android Studio or a standard Android SDK installation with JDK 17 and Node.js 22 + pnpm available on PATH. The Gradle build automatically runs `pnpm build:transcript` before packaging the APK; it must never ship a stale or missing transcript. In restricted environments where the Kotlin daemon cannot write to the home directory, add `-Pkotlin.compiler.execution.strategy=in-process` to the Gradle command.

Install `app/build/outputs/apk/debug/app-debug.apk` on the phone. No emulator or device is needed for the build or JVM tests. From a normal Android devShell, `pnpm android:apk` builds the transcript and APK.

## Download a build on your phone

The [CI workflow](https://github.com/thang-qt/Kairos/actions/workflows/ci.yml) builds on pushes to `main` and `android-prototype`. Open the latest successful run for your branch in your phone's browser while signed in to GitHub, then tap **Download Kairos APK** in the Android job summary (or the `kairos-<commit>.apk` artifact). The download is an APK directly, with no ZIP to extract. Tap the file and allow your browser to install apps when Android asks. Updates preserve app data when signed with the same key.

Downloads remain available for 30 days. Pull requests run the build/tests/lint without the personal signing key and do not publish an installable artifact. Once this workflow is on the default branch, **Run workflow** can also build a selected branch manually.

One-time repository setup: save your existing development keystore as the Actions secret `ANDROID_DEBUG_KEYSTORE_BASE64`, so every CI build uses the same signing certificate as the installed app. With GitHub CLI authenticated, run this on the computer that built the installed APK:

```sh
base64 -w0 "$HOME/.android/debug.keystore" | gh secret set ANDROID_DEBUG_KEYSTORE_BASE64 --repo thang-qt/Kairos
```

Keep a backup of that keystore. Do not commit it or its encoded contents. Builds intended for download fail clearly if the secret is missing, rather than generating a different signing key. This is a personal debug-build distribution path, not a production release pipeline.

Existing versions remain Kotlin 2.2.21, AGP 8.11.1, Gradle 8.14.4, Compose BOM 2025.04.01, activity-compose 1.10.1, WebKit 1.13.0 and lifecycle 2.9.1. Added dependencies are OkHttp 4.12.0, kotlinx-serialization-json 1.9.0, the Kotlin serialization plugin at 2.2.21 and lifecycle-viewmodel-compose at 2.9.1. Photo Picker uses the existing activity-compose dependency. SDK 35, minSdk 26, JDK 17; no NDK.

## Connect to a development server

Start Kairos from the repository root with the backend listening on all interfaces:

```sh
HTTP_ADDR=0.0.0.0:8080 pnpm dev
```

`HTTP_ADDR` defaults to `:8080`, which also listens on all interfaces. Ensure the backend's `.env.local` does not override it with a loopback-only address. Put the phone and development machine on the same LAN, allow port 8080 through the host firewall, and use the machine's LAN address, for example **http://192.168.1.20:8080**. `localhost` on the phone means the phone itself. Port 3000 is the web development UI; use the Go backend's port 8080.

On first launch:

1. Enter the server URL. Missing schemes become `https://`; explicitly enter `http://` for a LAN development server. Continue checks `/api/health` and `/api/app/capabilities`.
2. Sign in with an existing Kairos email and password. Create an account through the web app first. Configure a provider/model there too if the server has none.
3. Send a message from the empty new chat. The first send creates the saved session and starts a run atomically; it appears in the sidebar.

The server URL and appearance persist locally. Tokens use an AES-256-GCM key in Android Keystore, with random IVs and encrypted ciphertext in private SharedPreferences; expiry is stored in unix seconds. The app sends a bearer header, never cookies. A 401 clears the token and returns to sign-in. At startup `/api/me` verifies the saved token; a network failure leaves the chat available with a retry banner. Logout revokes the server token before clearing local sign-in. Change server does the same, then returns to Connect. An auth-disabled backend still rejects chat without a user session; Connect explains that authentication must be enabled.

Cleartext HTTP is allowed for development. Public HTTP hosts show “Not encrypted. Use only on a network you trust.” The WebView never holds the bearer token, fetches messages or loads remote resources; history images are inline base64, and asset-sourced history images (`/api/assets/{id}`, used by imported conversations) are proxied through the authenticated bridge without exposing the token to the page.

## Packages and streaming

### Layering

```text
Go backend (authoritative behavior and durable state)
  └─ Kotlin data layer: BackendApi, DTOs, SSE EventStream, disk caches, stores
      └─ Feature repositories: sessions, models, conversation history, ephemeral, approvals
          └─ ChatViewModel (one per activity), OverlayConversation (per overlay session)
              └─ Navigation Compose destinations
                  └─ Compose UI / shared transcript WebView
```

The backend defines behavior; the data layer is the only layer that speaks HTTP and owns caches; the ViewModel owns UI-adjacent state (drafts, focus, sheets, screen transitions); composables render. ChatViewModel is still the widest owner (~540 lines) because it coordinates auth, chat, search, and settings state. The planned split keeps repositories as-is and moves the coordination into focused ViewModels (`AuthViewModel` for connect/sign-in/server change, `ChatStateViewModel` for conversation selection and drafts, `SettingsViewModel` for the settings sheets and drafts) while Navigation Compose remains the single back-stack owner. Do not duplicate backend rules in Kotlin to close a parity gap — extend the backend contract instead.

- `app/`: application container, activity and sealed root screen state.
- `data/`: stores, typed API envelopes, raw JSON turns, SSE framing, repositories, web reducer port, session grouping, and disk caches.
- `chat/`: chat ViewModel and commands.
- `transcript/`: offline WebView bridge, protocol mirror, authenticated asset proxy and unchanged touch arbitration.
- `assistant/`: voice/session services, overlay, screenshot encoding and preview.
- `ui/`: existing palette/icon system, shared controls, chrome and screens.
- `markdown/`: unchanged native renderer.

## Caching and sync

Cold starts render warm, not blank. All caches live under `filesDir/kairos-data` and are wiped on sign-out, change-server and token expiry:

- **Conversations**: the sidebar uses the paged `GET /api/sessions?limit=50&cursor=…` endpoint. Loaded pages (with their opaque cursors) persist to disk, so the list is instant on relaunch; `loadMore()` appends pages on demand and older pages keep their cursors across refreshes. A single summary is fetched from `GET /api/sessions/{friendlyId}` when an id is missing from the loaded pages (deep links, older sessions).
- **Models and settings**: the `/api/models` catalog and chat settings persist; the UI shows the cached catalog immediately and reconciles in the background.
- **Conversation history**: the newest authoritative snapshot per recently opened session persists under an 8 MiB LRU budget. Opening a chat applies the cached snapshot before the first network response, and the revision/cursor gates keep a stale snapshot from ever downgrading live state.
- **Session list sync**: while the app is foregrounded, a user-scoped SSE stream (`GET /api/me/sessions/events`) nudges a debounced refresh — conversations rename, pin, delete or appear across devices without polling. Any data frame means “something changed”; the payload stays empty by design.

Persistence is plain JSON with atomic writes (temp file plus rename); writes happen on IO dispatchers and never block the UI thread. Cache contents are trusted as floor values only: server history, revisions and cursors remain authoritative.

A single identity-scoped pending-send journal stores only a SHA-256 digest of the exact command inputs and its idempotency key, not the message or image bytes. If the app is killed after an uncertain network response, submitting the identical command reuses that key; definitive acceptance or client rejection clears it. The last selected saved conversation is cached per identity and re-opened after a cold start. Full offline sending is intentionally not implemented.

The SSE connection is cancelled when its surface leaves. Reconnect uses backoff and `Last-Event-ID`; every connection replaces state from the authoritative reconcile snapshot, subject to the web's revision/cursor gates. Full turns reconcile by id or clientId; compact patches copy only their modified JSON paths. Command acknowledgements remove invalidated turns and fence old events. Streaming sends only changed assistant turns to the WebView, at most once per message per display frame. Snapshot identity/order changes use init; theme and insets update independently.

JVM fixtures under `app/src/test/resources` mirror Go JSON tags and exercise the same reducer cases in Kotlin and Vitest. Root checks are `pnpm check` and `pnpm backend:check`.

## Default assistant and attachments

In Settings, choose **Default assistant** to open Android's assistant management screen directly, falling back to Default apps if the narrower screen is unavailable. The row refreshes the current assistant choice on resume and has an explicit navigation affordance. It does not rely on a role-request prompt that may silently return when the role is already held or not requestable. See [Android's assistant role documentation](https://developer.android.com/reference/androidx/core/role/RoleManagerCompat#ROLE_ASSISTANT). Invoke the device's assistant gesture over another app; OEM setup and gestures vary.

Enable both **Use text from screen** and **Use screenshot** in the digital assistant settings to make Android's invocation screenshot available. Kairos drops assist text/structure unread and never attaches screenshots automatically. The composer's attachment panel offers Screen, Photos and Camera. External pickers run in a transparent trampoline activity after the assistant has hidden, and their results land in an identity-bound pending handoff. The active voice interaction service reopens its own session without requesting a new screenshot of the picker; if the service is unavailable, the selection remains ready for the next invocation. PNG selections remain PNG; other images and screenshots become JPEG, reduced to at most 1280px and progressively compressed toward 300KB. Decoded image bytes stay in memory until sent to the backend. Only a short-lived Photo Picker URI is saved in private preferences to recover an overlay handoff after process death; it is cleared and its read grant released after consumption or sign-out. Camera capture uses an explicitly granted FileProvider cache URI; its JPEG is deleted after decoding or cancellation, with stale captures cleaned on the next capture. Screen and library image bytes stay in memory. No message logging is used.

The assistant opens directly to a standalone rounded input pill and keyboard. A separate response card appears above it, sizes to short replies, and caps its height for longer replies. Replies stay anchored at the top in Native and WebView mode. There is no branding/header bar, close button, expand button, or empty reply pane. The attachment panel has large Screen, Photos and Camera tiles. Its sheets render inside the assistant window. Choosing Photos or Camera dismisses the menu and hides the assistant before launching the external picker, which returns through an identity-bound handoff. Swiping the small handle grows the response area with a bounded spring before opening the saved conversation in Kairos. Dismiss by tapping outside or using Back; hiding disconnects the surface without cancelling the server run.

Settings → Conversation → App rendering and Settings → Assistant → Overlay rendering save independent device-local choices between **Native** (Android markdown, text selection, images and activity) and **WebView** (the shared offline React transcript, including code, tables and math). The main app defaults to WebView; the overlay defaults to Native. Both modes share the composer, attachments, approvals and session lifecycle, and both open the activity sheet. Image/camera picker handoffs preserve the current overlay session and draft. WebView mode creates an isolated authenticated asset bridge only when replies are visible, applies the current palette, and destroys it when the overlay closes; it never takes the full app's WebView. Devices missing the required WebView messaging features fall back to native with an explanation.

MCP activity uses the same server-and-tool labels as the web (for example, `Files · read_file`), including running calls. Saved result metadata takes precedence over the current catalog; unavailable labels fall back to “remote tool” rather than a hashed alias. Arguments stay compact and input/output details expand on demand.

The activity sheet mirrors the web's activity panel: a timeline of thinking (collapsible, live while streaming), narration, and tool steps with web-search/fetch titles ("Searching \"…\"", "Read 3 pages"), source chips, result previews and failures, plus the turn's elapsed or total duration. After a successful send the composer drops focus and the IME closes so the reply is readable; opening the sidebar also dismisses the keyboard. Scrolling up in the transcript loads older history progressively like the web, and the in-message timestamp is dropped on the phone.

## Phone checks and remaining limitations

- Connect over LAN HTTP, try invalid URL/credentials, sign in, force-stop/reopen, and verify persisted sign-in. Revoke/expire the token and verify the next request returns to sign-in. Try starting offline, losing Wi-Fi during a run, reconnect and Retry; no duplicated tokens or turns.
- Send text, image-only, PNG and non-PNG images. Check MIME handling, thumbnail removal and history after reopening. Stop a live run, retry a failed/interrupted answer, and inspect Cancelled/Failed/Interrupted status.
- Choose a model; rename/pin/delete a conversation; search; edit/cancel a user message; fork both user and assistant turns; delete a user turn and everything after it. Confirm generated titles update and groups/active rows remain correct.
- Long-press Copy, tap the activity chip, and compare thinking/tool steps, tool results, markdown/code/math and history images with the web.
- Test sidebar swipes, code/table horizontal scrolling, vertical scrolling, bottom following, keyboard, predictive back and all six palettes in Light/Dark/System. Switch app rendering between Native and WebView and verify persistence after restart. Change system appearance while the app is open.
- Test Native and WebView overlay rendering, persistence after restart, bounded swipe-up height, current-answer-only display, editable prompt starters, activity clicks, and with/without screenshot permission, late screenshots, secure apps, attach/remove/send, Stop, dismissal and mid-stream Open in Kairos/swipe-up. Check signed-out overlay, process restart and shared session history in the sidebar.
- Confirm sign-out and Change server revoke the token and clear the old account's conversation state.

## Mobile scope

The phone app is a chat client, not a server console. Everything needed to use Kairos from a device is native; everything that belongs to administration or desktop ergonomics stays on the web:

**On mobile:** sign-in and server connection, streaming chat with edit/retry/fork/delete/stop, throwaway (ephemeral) chats that stream from /api/ephemeral/messages without creating a session, image attachments via the Photo Picker, per-conversation settings (system prompt, web search, math tools, reasoning effort, sampling, penalties, max output), the model picker with set-as-default, grouped conversation sidebar with paged loading and search, MCP tool approvals, appearance (six palettes, Light/Dark/System), the default-assistant overlay, and local caches for conversations, models, settings and recent history.

**Web/desktop only (not on the phone):** conversation import (archive upload), bulk export, provider administration (API keys, model sync), account email/password changes, keyboard shortcuts, the service worker/offline cache, and the standalone transcript export page.

The settings and activity panels use the same surface tokens as the web (`primary-*` palette steps, `font-medium` maximum weight, tabular numerals) ported by `scripts/gen-android-theme.mjs`. Sheets are Material bottom sheets without outlines — the scrim and surface step carry the separation; search is a full-screen page that owns the status-bar inset. MCP approvals need no polling: the history payload carries pending approvals, decisions stream back as `mcp-approval` events, and reconcile/terminal events prune approvals of finished runs — the same event path the web uses, in both the app and the overlay.

This is a debug demo: no in-app signup or provider administration, speech recognition/hotword, or durable offline outbox/background streaming (the session-list sync runs only while the app is foregrounded). Streaming resumes from backend history when a surface returns. The activity sheet renders the web's timeline semantics natively; thinking/tool visibility settings live on the web only. Date dividers are omitted. The assistant role cannot be requested on stock AOSP, so the settings fallback remains on those devices. OEM assistant/IME behavior, actual visual rendering, Photo Picker and Keystore behavior still require phone testing.

### Web/Android parity matrix

Status against the latest web implementation. "Shared" means the same React component runs offline in the transcript WebView, so parity is structural rather than reimplemented.

| Feature                                                  | Status      | Notes                                                                             |
| -------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| Conversation creation (empty + first message atomically) | Implemented | `POST /api/sessions` carries the new-chat `settings` draft; backend-authoritative |
| Conversation list, grouping, pagination                  | Implemented | Paged endpoint, pinned-first ordering, sidebar auto load-more                     |
| Conversation search                                      | Implemented | Full-screen search route over `/api/sessions/search`                              |
| Conversation rename/pin/delete/fork                      | Implemented | Backend-enforced; sidebar and message actions                                     |
| History rendering, streaming, reconnect                  | Implemented | Reducer port + authoritative snapshots; transcript is the web `MessageItem`       |
| Send with idempotency + process-death recovery           | Implemented | Pending-send journal stores only a digest and the key                             |
| Edit, retry, stop, delete turns                          | Implemented | Same endpoints and rules; retry eligibility comes from `canRetry`                 |
| Model selection                                          | Implemented | Picker with set-as-default; model presets applied by the backend                  |
| Per-conversation settings                                | Implemented | Settings sheet persists via `PATCH …/settings`                                    |
| New-chat settings drafts                                 | Implemented | Saved across process death; consumed on first send                                |
| Markdown, code, LaTeX, tables, images                    | Shared      | Offline WebView renders the web's `MessageItem`                                   |
| Tool steps, sources, activity timeline                   | Implemented | Native activity sheet ports `splitAssistantActivity`                              |
| MCP approvals                                            | Implemented | Streamed `mcp-approval` events in app and overlay; no polling                     |
| Ephemeral chats                                          | Implemented | Client-owned history; resolved `settings` draft per send                          |
| Image attachments                                        | Implemented | Photo Picker (JPEG ≤1280px, ≤300KB), overlay screenshots                          |
| Document/file attachments                                | Incomplete  | Not offered by the mobile composer; beta exclusion                                |
| Offline first paint of cached chats                      | Implemented | Disk snapshots render before network; never downgrade live state                  |
| Background sync when app is closed                       | Excluded    | Session-list sync is foreground-only by design                                    |
| Conversation export                                      | Excluded    | Web/desktop only for beta                                                         |
| Provider/account administration                          | Excluded    | Web/desktop only                                                                  |
| Keyboard shortcuts                                       | Excluded    | Touch-first; native gestures instead                                              |
| Date dividers                                            | Omitted     | The transcript renders `MessageItem` without the list-level divider pass          |
| Thinking/tool visibility settings                        | Omitted     | Web-only for beta                                                                 |
| TalkBack, large fonts, system insets                     | Unverified  | Requires device testing before release                                            |

Anything marked incomplete or omitted above is deliberate for beta; everything else degrades to the documented behavior rather than reimplementing backend rules in Kotlin.

## Architecture and release readiness

See [the Android readiness assessment](../docs/android-readiness.md) for ownership boundaries, the refactor findings, controlled-beta device checks, and remaining production release gates. Passing automated checks alone does not verify assistant/WebView behavior on a phone.
