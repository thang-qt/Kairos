# Kairos Android architecture prototype

This is a feasibility experiment: a native Compose sidebar, header and composer around **one persistent WebView** rendering the existing React message primitives, Streamdown markdown, Shiki code and KaTeX math. There is no backend, authentication or network data. No commits are made by the build.

## Build and sideload

From the repository root:

```sh
nix develop .#android
pnpm install --frozen-lockfile
pnpm build:transcript
cd android
./gradlew assembleDebug
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone and open it to install, allowing installation from that source when Android asks. Alternatively, from the repo root inside the devShell:

```sh
pnpm android:apk
```

The toolchain is JDK 17, Gradle **8.14.4**, AGP **8.11.1**, Kotlin/Compose compiler **2.2.21**, Compose BOM **2025.04.01** (foundation/UI 1.8.0), activity-compose **1.10.1**, WebKit **1.13.0**, lifecycle **2.9.1**. These stay compatible with the installed SDK 35 and Gradle 8.x. Compile/target SDK are 35, build-tools are 35.0.0, minSdk is 26. SDK auto-download is disabled; there is no NDK.

For the restricted build environment used during development, source the supplied export from the repository root instead of starting Nix:

```sh
source /tmp/claude-1001/-home-thang-Dev-Kairos/08da1aca-2512-4303-8005-c1c8f6785fad/scratchpad/android-env.sh
export ANDROID_USER_HOME="$PWD/android/.gradle-home/android-user-home"
mkdir -p "$ANDROID_USER_HOME"
pnpm android:apk
```

`ANDROID_USER_HOME` keeps SDK preferences and the debug keystore in a writable cache when the normal home directory is read-only. Normal devShell users do not need this override. The wrapper and version catalog are checked-in inputs; Gradle caches, APK/build outputs, local SDK paths and generated transcript assets are ignored.

## On-phone evaluation

The three questions are: does the native shell plus web transcript feel native and fast; does full-width sidebar swiping cooperate with horizontally scrollable content; and what do cold start, WebView readiness and streaming cost?

- Force-stop and reopen the app several times. Long-press the **header title** to show/hide the performance overlay. Record first and subsequent starts, Android version, WebView version and phone model.
- Open the menu, drag the chat from the middle of prose, reverse direction before release, and compare slow drags and fast flings. The chat slides the full screen width, the sidebar moves with slight parallax, and the chat scrim fades in. Swipe left on the sidebar to close. Check the light settle haptic.
- With gesture navigation enabled, test back from each screen edge. With the sidebar open, back should track predictive progress on supported Android versions; cancel midway and confirm it reopens. With it closed, Android owns back.
- Scroll vertically and diagonally through the transcript. The sidebar should remain still during a gesture locked vertically. Open code and table content, pan horizontally both ways, then start a new outward drag at each scroll boundary. A scrollable code/table drag should belong to the WebView; an outward drag with no horizontal room can open the sidebar. Boundary handoff during an already-claimed scroll is deliberately avoided.
- Select **Long conversation · 48 turns**. Switch repeatedly among the three fixture types in the 20-row recent list; the page must not reload. Try long history scrolling while generation runs.
- Send any text. The canned answer streams about every 30 ms with prose, a list, a long code line, a wide table, inline math and display math. Test Stop, scrolling away from the bottom during generation, then returning to the bottom to resume following.
- Open/dismiss the keyboard at the bottom and while reading older history. Bottom following should stay pinned when already following; older history should not jump to the newest answer. Try a six-line composer draft.
- Cycle all six palettes and toggle light/dark using the bottom sidebar controls. Check the native background, bubbles, markdown, code highlighting and keyboard transitions for flashes or color mismatches.
- Long-press a bubble or reply for Copy/Edit/Fork/Delete. Paste the copied text into another app. Check Chromium text selection and its handles separately; report conflicts with the native action sheet. Edit/Fork/Delete, search, attachment and settings only show `prototype` toasts.
- Tap the documentation link in a reply. It should open a browser and leave the transcript intact.

## Native assistant setup and evaluation

1. Install the updated APK, open Kairos, and tap **Default assistant** in the sidebar. On Android 10+ the row reports `RoleManager.isRoleHeld(ROLE_ASSISTANT)` and refreshes when you return from settings. Android 8–9 use the active voice-service status instead.
2. In the system voice/default-app settings, choose **Kairos prototype** as the digital assistant. Some phones require another tap on “Digital assistant app” or “Default digital assistant app.” The app opens `ACTION_VOICE_INPUT_SETTINGS`, falling back to `ACTION_MANAGE_DEFAULT_APPS_SETTINGS`. It never launches a role-request prompt: AOSP marks ASSISTANT `requestable="false"`. [AOSP role declaration](https://android.googlesource.com/platform/packages/modules/Permission/+/refs/heads/main/PermissionController/res/xml/roles.xml).
3. Switch to another app and invoke your device's assistant gesture. Depending on Android, launcher and navigation mode, this may be a swipe inward from either bottom corner, holding the home button, or holding the gesture handle. OEM shortcuts and launcher settings can reserve or disable these gestures; select Kairos first and enable the phone's assistant gesture setting if present. No hotword activation is implemented.
4. If assistant setup is unavailable or awkward, tap **Preview overlay** in Kairos's sidebar. Its translucent Activity hosts **the same `AssistantOverlay` composable**. It exercises the native UI, input, parser and handoff without requiring the role. It does not prove that a particular OEM's voice-session window delivers IME insets.

AOSP's API-35 `VoiceInteractionServiceInfo` reports a parse error when `recognitionService` is absent, as well as when `sessionService` is absent. The manifest/XML therefore declare a small `KairosRecognitionService` that immediately returns a recognizer error and never starts audio capture. There is no microphone permission or speech transcription. [AOSP metadata parser](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/service/voice/VoiceInteractionServiceInfo.java).

The assistant leaves `SHOW_WITH_ASSIST` enabled because Android only captures the screenshot as part of an assist-data request (`AssistDataRequester` gates `allowFetchScreenshot` on `fetchData` and on assist data being allowed). The session overrides `onHandleAssist(AssistState)` with a no-op, so screen text, view structure and assist content are dropped unread. It never reads show arguments. The screenshot is never automatically attached to a question.

Evaluate both the real session and preview:

- First show contains a floating composer pill and a compact Kairos/**Open Kairos** row, with the keyboard opening. There is no enclosing card or painted margin behind the pill. There is no WebView in the overlay, including on a cold process start. Measure the first frame rather than assuming it is instant.
- Send a message. A separate 24 dp reply card fades in and rises slightly above the composer, capped at 60% of screen height or the remaining area above the keyboard. Its transcript scrolls and follows streaming; the composer remains a separate floating pill with 12 dp side margins and an 8 dp gap. The reply card is absent before sending. Replies share the app's 30 ms whitespace-token engine and render natively.
- Check headings, paragraphs, medium-weight bold, italic, inline code, lists with one nesting level, horizontal code scrolling and browser links. Browser links dismiss the overlay after opening so the card does not obscure the browser. The same canned reply includes raw tables and math; the native view shows them literally with **Open in Kairos for the full view**. HTML also stays literal. Incomplete emphasis and code fences should remain stable while streaming.
- Scroll away while streaming and return to the bottom. Try Stop, a multiline draft, repeated invocations, and all six palette/light/dark combinations (set them in the full app first).
- Tap the scrim, press Escape on a hardware keyboard, and invoke back with the keyboard open and closed. Each should dismiss the overlay. API 33+ uses an overlay-priority back callback; older key-based back is intercepted before the IME.
- Tap **Open in Kairos** midway through streaming. Streaming stops and the current user/reply text transfers through a shared in-memory store into MainActivity's WebView transcript. Test with Kairos already running and after launching the assistant into a cold app process. The initial **Open Kairos** button simply opens the app when the overlay is empty.
- Long-press **✧ Kairos** to toggle the overlay's debug panel. It shows `Assistant` or `Preview` onShow → first-frame and keyboard-visible times, also logged under `KairosPerf`. The actual session adds a raw **Assistant IME inset** value to distinguish a missing window inset from a slow keyboard. Logs distinguish the real session from the preview.

### Opt-in screen attachment

Enable both **Use text from screen** and **Use screenshot** at **Settings → Apps → Default apps → Digital assistant app** (some phones show another gear/settings row). Then invoke Kairos over another app. Android supplies the screen visible **at assistant invocation**, not a continuous capture and not a fresh capture each time you tap Attach screen.

- Tap the screen icon in the composer's leading area to **Attach screen**. It replaces the prototype `+` in the overlay. The 48 dp thumbnail chip appears above the text field; tap × to remove it. Removal affects the draft only, and sending a question without the chip sends no image. Image-only sending is also supported.
- A missing screenshot makes the icon visibly disabled. Tapping it shows **Turn on 'Use text from screen' and 'Use screenshot' in Digital assistant settings**; the hint links to the same system settings flow and dismisses the assistant so settings can be used. A secure app or device policy can also prohibit screenshots even when the toggle is enabled.
- Sending shows the thumbnail in the user bubble. The shared mock streaming engine acknowledges the screenshot explicitly and says no vision model was called. It does not inspect or interpret the image.
- **Open in Kairos** transfers only attachments in sent messages through the existing in-memory conversation store. An unselected screenshot or unsent draft attachment is not transferred. The full React transcript shows the image inside the user bubble.
- **Preview overlay** supplies a synthetic gradient/notes bitmap instead of capturing anything. Use it to test attach, remove, send and handoff without the assistant role. Returning from background starts a fresh preview.

`onHandleScreenshot(screenshot: Bitmap?)` is nullable and **not deprecated in API 35** (the older assist-structure callbacks are deprecated, not this screenshot callback). It requires `SHOW_WITH_SCREENSHOT` on the system's show request. If that flag is absent, the callback may never arrive. Null is handled as unavailable (user toggle, policy or application restrictions); delivery after the UI appears updates the button but never attaches automatically. Delivery after hide/destroy is discarded. [Android screenshot callback reference](<https://developer.android.com/reference/android/service/voice/VoiceInteractionSession#onHandleScreenshot(android.graphics.Bitmap)>).

The raw bitmap remains inside the session-owned `ScreenCaptureState`. **Explicit attach** reduces it to a maximum 1080 px long edge without upscaling and compresses a JPEG into an in-memory byte array; no image data goes to files, logs or clipboard. Native thumbnails decode only that reduced copy, never the original bitmap. The source bitmap and session/draft/sent-image references are dropped on hide/destroy; the framework-provided bitmap is not manually recycled because ownership is unspecified. Only temporary software/scaling bitmaps created by Kairos are recycled. A handoff copies the reduced attachment bytes so the app can continue displaying the image after session cleanup.

For the WebView, a custom **WebViewAssetLoader path handler** serves these reduced bytes at `https://appassets.androidplatform.net/screens/<random-id>.jpg`. Bridge JSON carries only that same-origin URL plus width/height; it does not contain base64 pixels or a large Binder/intent payload. The handler uses `Cache-Control: no-store`, and WebView cache loading is disabled. This keeps images out of disk caches and avoids JSON/base64 expansion and repeated bridge copies. The app retains only the current conversation's selected images in memory, clears the image store when switching fixtures/new sessions, and loses them on process death.

Phone checks: try the toggle off and on, a `FLAG_SECURE`/protected app, a slow or late screenshot, attach/remove/reattach, send with and without an image, image-only send, mid-stream handoff, and dismiss/reinvoke. The new invocation should have no old thumbnail or sent-image history. Check Preview too, including both keyboard states and outside taps in the transparent gaps between UI elements.

### Session owners and IME behavior

`VoiceInteractionSession` does not implement AndroidX's lifecycle, saved-state or ViewModel-store owners. `SessionViewOwner` attaches/restores an empty saved-state registry before `ON_CREATE`; the three owners are installed on **both window decor and ComposeView before attachment**. Compose UI 1.8.0's window recomposer looks above the ComposeView for its lifecycle owner, so setting owners only on the child is insufficient. On show the owner becomes RESUMED; on hide it returns to CREATED; on destroy it becomes DESTROYED, clears its ViewModel store and disposes the composition. Hide clears the raw screenshot, draft attachment and native message list, then disposes the composition to release remembered thumbnails. The same ComposeView/window owners are reused on the next show, with freshly installed content and a new conversation/focus generation. These APIs compile with the pinned Compose/lifecycle versions; runtime lifecycle behavior still needs the real-session phone check.

AOSP creates a focusable, full-screen voice-session window. This prototype explicitly clears non-focusable/alternate-IME flags, sets `SOFT_INPUT_ADJUST_RESIZE`, and uses `WindowCompat.setDecorFitsSystemWindows(false)`. The window's inset listener returns insets **unconsumed**, allowing Compose's `WindowInsets.ime`/`imePadding` to move the reply card and floating composer together above the keyboard. Navigation-bar padding fills the remaining safe area. `onComputeInsets` retains the framework's “do not resize the underlying app” content inset and makes the full scrim touchable; it is not used as a guessed keyboard-height substitute. [AOSP window setup](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/service/voice/VoiceInteractionSession.java).

There is no device/emulator here, so actual session IME delivery and OEM gesture behavior have **not** been verified. The resize configuration and raw-inset/keyboard metrics are deliberate on-phone verification hooks. Check that the real session reports a positive IME inset and that its card rises; compare with Preview if it does not. First-frame timing is a composition/frame/post proxy, not a GPU presentation timestamp. Native-only startup removes WebView work, but Compose/process initialization and keyboard startup still cost time.

### Composer fade regression check

The full-app fade is now a separate layer behind the composer. Its top extends approximately one third of the measured composer-body height above the composer; its ramp reaches solid surface halfway through that fade region, then extends solid through the navigation/IME inset to the physical bottom. Keyboard height does not stretch the gradient ramp. The composer retains its own translucent surface/outline, and the transcript receives composer body + bottom inset so the last message can scroll clear of it.

With a long transcript, test a one-line and six-line composer with the keyboard open and closed, in light and dark mode. Watch the strip under the composer and behind the gesture handle during keyboard animation: no transcript text should show through. Scroll the last reply fully above the composer and confirm bottom following still works.

## Measurements and bridge

Logcat tag **KairosPerf** and the title-toggled overlay show process-start → first Compose draw (also `reportFullyDrawn`), synchronous WebView creation, native page-ready duration, web first-frame proxy, init → transcript render, and sampled token → render latencies (tokens 1, 10, 30, 60, 120). The process clock is Android's process start uptime. The page's `firstPaintMs` is measured from navigation using two animation frames, not a browser Paint Timing API entry.

The full app prewarms its WebView at the start of `MainActivity.onCreate`, before Activity composition. Application startup, the voice services and the preview activity create no WebView; this avoids paying the transcript initialization cost before a native assistant frame. `WebViewAssetLoader` serves only local assets at `https://appassets.androidplatform.net/assets/transcript/transcript.html`. Its background matches the initial default/light surface before loading. Swapping fixtures sends `init`, never a reload. The generated palette file comes from `src/styles.css`; the script converts default OKLCH colors into clamped sRGB hex and extracts all light/dark primary, surface and ink tokens.

Native → web uses **`WebViewCompat.postWebMessage`**, restricted to the exact asset origin. This transports JSON as data and avoids building executable JavaScript strings. The page receives `message` events with no source Window; Android's native sender may supply an empty source origin. Web → native uses **`WebViewCompat.addWebMessageListener`**, the exact allowed origin, and main-frame/source-origin checks. JavaScript is enabled, file/content access is disabled, no JavaScript interface is installed, and external links/resources never load in the WebView. The APK has no Internet permission. The shared remote font import is blocked by CSP, leaving system fonts as offline fallbacks.

`src/transcript/protocol.ts` defines the small message and bridge types; Kotlin mirrors the message fields. Commands are `init`, `append`, `delta`, `done`, `theme`, `insets`; events are `ready`, `longPress`, `link`, `hscroll`, `atBottom`. Instrumentation adds optional command `trace` and a `paint` acknowledgement. `hscroll` adds `phase` (`start`, `move`, `end`) so native can reserve a code/table region until its drag direction is known. The paint acknowledgement follows React commit and two animation frames. It is a **render/frame proxy**, includes the acknowledgement trip back to native, and is not a GPU/display presentation timestamp. Asynchronous Shiki highlighting may complete later. This prototype must be measured on a phone before drawing performance conclusions.

Compose uses `AnchoredDraggableState` / `anchoredDraggable` and its default velocity-aware fling behavior on native surfaces. AndroidView consumes Compose pointer events, so `TranscriptTouchHost` applies touch slop and direction locking, waits for the DOM's horizontal-scroll decision, and routes a claimed horizontal drag to the **same anchored state**, settling with velocity and decay. Chromium receives a normal touch cancellation when native claims the drag. Native reserves system-gesture insets (at least 24 dp on both edges). Vertical/multitouch gestures stay with the WebView. The extra asynchronous decision may introduce a small initial delay: evaluate it, especially under heavy markdown rendering.

Long press is a passive 500 ms timer, canceled after 10 CSS pixels of movement or when selection appears. There is no `preventDefault` on touch events and text selection remains enabled. Chromium may claim selection before or after the timer depending on WebView version. If the actions sheet and selection conflict on the phone, record the behavior; this prototype does not disable selection or patch around the conflict.

## Structure and verification

- `transcript.html`, `vite.transcript.config.ts`, `src/transcript/`: separate offline Vite entry, reducer, bridge, touch arbitration and thin memoized message presentation. No router, React Query or API; the transcript-specific theme hook replaces the shared renderer's preferences-store import only in this build.
- `scripts/gen-android-theme.mjs`: generates `ui/theme/KairosPalettes.kt` from web CSS.
- `scripts/gen-android-icons.mjs`: generates `ui/icons/KairosIcons.kt` (Compose ImageVectors) from the same `@hugeicons/core-free-icons` the web uses. Add a name to its `ICONS` list to use a new icon; `pnpm build:transcript` reruns it.
- `android/`: main/preview activities, voice interaction services/session, native shell/theme/assistant, shared mock streaming, bridge, touch host, performance logging, wrapper and version catalog.

```sh
pnpm build:transcript
(cd android && ./gradlew assembleDebug testDebugUnitTest)
pnpm check
```

Three screenshot JVM tests cover size/aspect bounds, null delivery/settings hints/cleanup, deep-copy handoff and image-store replacement. Six JVM parser tests cover block/inline parsing, one-level nesting, annotated styles/links, raw unsupported content, unfinished emphasis/fences (including partial closing fences), and every prefix of a mixed streaming input. The bridge reducer has Vitest coverage for conversation replacement, append, delta, done, immutable unchanged rows, unknown IDs, theme, insets and attachment metadata. There is no emulator/device available in this workspace; build success does not establish gesture, IME or startup performance correctness.

## Known limitations

- Debug-only, sideloadable feasibility build. No real sessions, search/settings, persistence, auth, backend, releases/signing workflow. Android's standard debug signing is used.
- All 20 recent rows map to three fixtures; switching discards local changes. The long fixture has 48 message turns (24 user/assistant exchanges). New session starts empty. Streaming is native whitespace-token simulation, not model tokens or a network connection.
- The existing rich renderer/highlighter bundle is substantial and intentionally reused. There is no long-history virtualization. Cold parse/highlighter costs and dropped frames require on-phone evaluation.
- Install a current Android System WebView. The origin-scoped listener/message APIs are feature-checked; an unsupported provider shows an update notice. Tailwind v4 colors and modern CSS also require a recent provider.
- Screenshot attachment is an in-memory prototype, with synchronous reduction/compression on explicit attach. It has no real vision call and no refresh capture; late/missing OEM screenshot delivery needs phone testing.
- Native overlay conversations are ephemeral; each assistant invocation starts collapsed/empty and process death loses the in-memory handoff. The recognition stub does not implement voice input. OEM assistant-picker/gesture and session IME behavior require on-phone checks.
- No claim of actual display-paint timing; no refresh-rate/fps profiler. Perf counters are observational proxies as described above.
- No mid-gesture handoff from a code/table pan to the drawer. Text-selection/long-press competition and asynchronous gesture-decision latency remain explicit feasibility questions.
- The app handles orientation/uiMode configuration changes with the same WebView and updates anchors/insets. Process death starts from the default fixture/theme; backgrounding does not simulate network cancellation.
