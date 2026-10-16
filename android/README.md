# Kairos Android demo

The Compose app connects to the real Kairos HTTP backend. Sign-in, saved conversations, images, model selection, streaming, stop/retry, editing, forks, session search and settings use the same protocol as the web app. The transcript is an offline WebView containing the web's `MessageItem`, activity chip, tool primitives and markdown stack. The assistant overlay renders markdown natively and saves normal sessions.

## Build and install

From the repository root, with the Android devShell (`nix develop .#android`) or the supplied toolchain:

```sh
source /tmp/claude-1001/-home-thang-Dev-Kairos/08da1aca-2512-4303-8005-c1c8f6785fad/scratchpad/android-env.sh
export ANDROID_USER_HOME="$PWD/android/.gradle-home/android-user-home"
pnpm build:transcript
cd android
./gradlew assembleDebug testDebugUnitTest
```

Source that environment **from the repository root**: it sets `GRADLE_USER_HOME` relative to the current directory. `ANDROID_USER_HOME` keeps Android preferences and the debug keystore in the writable cache. In restricted environments where the Kotlin daemon cannot write to the home directory, add `-Pkotlin.compiler.execution.strategy=in-process` to the Gradle command. No dependency versions need changing for that workaround.

Install `app/build/outputs/apk/debug/app-debug.apk` on the phone. No emulator or device is needed for the build or JVM tests. From a normal Android devShell, `pnpm android:apk` builds the transcript and APK.

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

The SSE connection is cancelled when its surface leaves. Reconnect uses backoff and `Last-Event-ID`; every connection replaces state from the authoritative reconcile snapshot, subject to the web's revision/cursor gates. Full turns reconcile by id or clientId; compact patches copy only their modified JSON paths. Command acknowledgements remove invalidated turns and fence old events. Streaming sends only changed assistant turns to the WebView, at most once per message per display frame. Snapshot identity/order changes use init; theme and insets update independently.

JVM fixtures under `app/src/test/resources` mirror Go JSON tags and exercise the same reducer cases in Kotlin and Vitest. Root checks are `pnpm check` and `pnpm backend:check`.

## Default assistant and preview

In Settings, choose **Default assistant** to open Android's voice/default-app settings and select Kairos. AOSP does not allow requesting the assistant role through the usual role prompt, so this retains the system settings flow. Invoke the device's assistant gesture over another app. OEM setup and gestures vary.

Enable both **Use text from screen** and **Use screenshot** in the digital assistant settings to make Android's invocation screenshot available. Kairos drops assist text/structure unread and never attaches screenshots automatically. Tap the screen icon to attach; remove it to send without an image. PNG selections remain PNG; other images and screenshots become JPEG, reduced to at most 1280px and progressively compressed toward 300KB. Images remain in memory until sent to the backend; no temporary files or message logging.

**Preview overlay** uses the same native overlay with a synthetic screenshot, without requiring the assistant role. Its sends are real backend requests and create saved sessions. Open in Kairos and swipe-up pass only the session id as an intent extra, so the full app reloads authoritative history and continues streaming. Hiding/destroying the overlay closes its own SSE connection without cancelling the server run. Signed-out overlays show an Open Kairos sign-in card. Only cold-start/overlay first-frame timing remains in Logcat under `KairosPerf`.

## Phone checks and remaining limitations

- Connect over LAN HTTP, try invalid URL/credentials, sign in, force-stop/reopen, and verify persisted sign-in. Revoke/expire the token and verify the next request returns to sign-in. Try starting offline, losing Wi-Fi during a run, reconnect and Retry; no duplicated tokens or turns.
- Send text, image-only, PNG and non-PNG images. Check MIME handling, thumbnail removal and history after reopening. Stop a live run, retry a failed/interrupted answer, and inspect Cancelled/Failed/Interrupted status.
- Choose a model; rename/pin/delete a conversation; search; edit/cancel a user message; fork both user and assistant turns; delete a user turn and everything after it. Confirm generated titles update and groups/active rows remain correct.
- Long-press Copy, tap the activity chip, and compare thinking/tool steps, tool results, markdown/code/math and history images with the web.
- Test sidebar swipes, code/table horizontal scrolling, vertical scrolling, bottom following, keyboard, predictive back and all six palettes in Light/Dark/System. Change system appearance while the app is open.
- Test the assistant and Preview with/without screenshot permission, late screenshots, secure apps, attach/remove/send, Stop, dismissal and mid-stream Open in Kairos/swipe-up. Check signed-out overlay, process restart and shared session history in the sidebar.
- Confirm sign-out and Change server revoke the token and clear the old account's conversation state.

## Mobile scope

The phone app is a chat client, not a server console. Everything needed to use Kairos from a device is native; everything that belongs to administration or desktop ergonomics stays on the web:

**On mobile:** sign-in and server connection, streaming chat with edit/retry/fork/delete/stop, throwaway (ephemeral) chats that stream from /api/ephemeral/messages without creating a session, image attachments via the Photo Picker, per-conversation settings (system prompt, web search, math tools, reasoning effort, sampling, penalties, max output), the model picker with set-as-default, grouped conversation sidebar with paged loading and search, MCP tool approvals, appearance (six palettes, Light/Dark/System), the default-assistant overlay, and local caches for conversations, models, settings and recent history.

**Web/desktop only (not on the phone):** conversation import (archive upload), bulk export, provider administration (API keys, model sync), account email/password changes, keyboard shortcuts, the service worker/offline cache, and the standalone transcript export page.

The settings and activity panels use the same surface tokens as the web (`primary-*` palette steps, `font-medium` maximum weight, tabular numerals) ported by `scripts/gen-android-theme.mjs`. Sheets are Material bottom sheets without outlines — the scrim and surface step carry the separation; search is a full-screen page that owns the status-bar inset.

This is a debug demo: no in-app signup or provider administration, speech recognition/hotword, or durable offline outbox/background streaming (the session-list sync runs only while the app is foregrounded). Streaming resumes from backend history when a surface returns. The activity sheet is a simple native list of reasoning text and tool name/status. Date dividers are omitted. OEM assistant/IME behavior, actual visual rendering, Photo Picker and Keystore behavior still require phone testing.
