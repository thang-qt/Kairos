# Android beta readiness assessment

Assessment scope: the main Android client, native/WebView transcript renderers, assistant overlay, screenshot/library/camera attachments, identity changes, and the shared backend protocol. This is a repository assessment, not a certification of device behavior or a security audit of the Go server.

## Verdict

As of the 2026-10-19 reassessment and isolation follow-up, the account-isolation findings below have code fixes and regression coverage. Public OSS beta distribution should still wait for recorded device gates and a release artifact/update path. The architecture is a credible base and does not need a rewrite. It is not yet verified for an unrestricted production release. Compiling a debug APK and passing JVM tests cannot validate a service-backed WebView, OEM assistant invocation, external camera/picker handoffs, or process recreation.

Keep the existing Go backend as the authority for configuration, permissions, approvals, idempotency, and run transitions. Renderer choice is a device-local presentation preference; neither renderer should decide whether a tool can execute.

## 2026-10-19 reassessment

The startup fixes were committed as `be88cf2`: fresh ViewModels no longer reopen the disk-cached last conversation, and new chats initialize their model from the cached catalog or restored settings draft. Android saved-state navigation restoration remains separate from a fresh launch. The user confirmed installing the rebuilt APK on a Pixel 9 Pro; this does not constitute a completed device matrix.

Baseline verification recorded during the reassessment:

- `pnpm check`: passed, 57 test files / 253 tests.
- `assembleDebug testDebugUnitTest`: passed, 15 JVM suites / 72 tests, no failures.
- `lintDebug`: passed with 55 warnings and no errors. Warnings still need triage; success is not a clean lint report.
- `pnpm backend:check`: formatting, vet, and tests passed.
- Physical-device lifecycle, accessibility, API 26, and second-OEM results remain unrecorded. There are no checked-in Android instrumentation tests under `src/androidTest`.

Isolation follow-up verification on this checkout:

- `pnpm check`: passed, 57 test files / 253 tests.
- `assembleDebug testDebugUnitTest lintDebug`: passed; Android JVM suite 19 XML suites / 82 tests. Lint completed with 57 warnings and no errors; review the report before release.
- No backend files changed, and the backend check was not rerun for this follow-up.
- Physical-device picker/camera recreation, 401 teardown, and OEM behavior remain unverified.

### Isolation findings and follow-up status

1. **High: late responses could repopulate cleared identity state. Fixed in code.** Repositories now capture a shared identity stamp before requests and check it before publication, persistence, mutation rollback, and deferred refresh work. The stamp includes a persisted generation, server, token, and cache generation; pending-send journal operations also require the original cache generation. Delayed session/model response and stale mutation rollback tests exercise repository publication and persistence across a clear and a new identity. These tests establish the code boundary, not a reproduced cross-account exploit.
2. **High: drafts and new-chat settings could survive account changes. Fixed in code.** Chat state and restored `SavedStateHandle` values are bound to a digest of the current server/account identity. Logout, server/account transitions, and 401 teardown clear drafts, new-chat settings, selection, editor state, and operation-owned UI state. Old task errors and `finally` blocks cannot overwrite a newer operation. A saved-state regression verifies restoration for the matching identity and clearing for a different identity; device-driven logout and token-expiry flows remain in the gate list.
3. **Medium: main-app attachment results could attach to a newer chat. Fixed in code; device validation remains open.** Picker and camera launches persist the original identity, identity generation, selection generation, session ID, and source. The single outstanding ticket remains occupied through selection/account invalidation and decoding until that launcher's callback drains, so a second request cannot inherit a late result. The result is rechecked after decode and camera files are cleaned on completion or rejection. JVM tests cover account/session/selection/source matching and ticket ownership. External picker/camera recreation and OEM delivery behavior still need device validation. If Android never returns an outstanding launch result, new attachments remain blocked until the owning activity state is discarded; releasing the ticket early could misattribute a late callback.

### Architecture and OSS maintainability

The main boundaries are appropriate: Go owns durable behavior; Kotlin repositories own HTTP and history projections; Compose owns presentation; WebView is an offline rendering adapter. Cursor/revision reconciliation, digest-only pending-send journaling, encrypted bearer storage, disabled app backup, bounded image loading, and separate activity/overlay WebViews are useful foundations. Keep those boundaries.

The highest-value structural change, an explicit authenticated-session lifetime, is now represented by a shared identity stamp used at asynchronous state boundaries. The application container still owns repositories across account transitions, so the generation checks must remain in place as those boundaries evolve. Cancellation helps, but publication must also reject late completions. This is more valuable than adding modules or a dependency-injection framework.

After the isolation fixes, split the broad `ChatViewModel` by auth, chat coordination, and settings responsibility. Its size is not itself a release blocker; the reason to split is to make identity cleanup and operation ownership testable. Separate `Repositories.kt` into focused repository files as those seams are tested. Add small transport/cache abstractions where needed for deterministic delayed-response tests, rather than mocking Android UI to test repository correctness.

Maintaining native and shared-WebView renderers creates two presentation test matrices, even though both share the data layer. Keep one authoritative reducer/contract and test both renderers against representative history fixtures. Do not duplicate approval or model policy in either renderer. Existing JVM contract tests are useful, but they do not exercise actual navigation, service windows, or WebView readiness.

For an OSS beta, the repository already has an MIT license, contribution guidance, an Android build guide, a pinned Gradle wrapper, Nix tooling, and CI build/test/lint jobs. The missing release surface is Android-specific: a stable signing/update process, incrementing version codes (currently `1`, version `0.2-demo`), a tagged APK/checksum workflow, and a documented supported backend/API range. A first beta may use a manual release process if it is recorded and repeatable; a large release platform is unnecessary. Review bundled dependency/font notices before shipping artifacts; this assessment does not establish their licensing completeness.

Add an Android entry point to the root README, concise bug-report instructions with Android/WebView versions and renderer choice, and a private security-reporting path. Document local cached-data behavior, HTTP deployment support, deliberate feature exclusions, and how testers recover or report failures without sharing prompts/tokens. Telemetry is optional; useful diagnostics can remain local and user-redacted.

Public-beta exit criteria: preserve the isolation regressions, record the controlled-beta device checks below, and publish an installable artifact with a stable update identity. Instrumentation should first cover account changes, fresh launch versus restoration, renderer switching, and overlay/picker handoffs. Broader UI decomposition and polish can follow during beta.

## Assessment and refactor

| Area               | Finding                                                                                                                                             | Required boundary                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend protocol   | Requests use shared contracts; history and SSE reconcile using cursor/revision gates. The pending-send journal stores digests and idempotency keys. | Preserve these mechanisms in both renderers and the overlay.                                                                                                           |
| WebView ownership  | The application container retained a WebView while activities replaced its context and callbacks. Native mode also constructed it.                  | Views belong to the owning activity or overlay composition, are lazy for WebView mode, and are destroyed with that owner. Repositories belong to the application.      |
| Image loading      | Native message components fetched unbounded response bodies and decoded full bitmaps.                                                               | A dedicated loader owns authenticated requests, cancellation, identity checks, byte limits, and downsampling. UI components display results.                           |
| Overlay operations | Send completion, errors, and delayed open-app callbacks could outlive hide/show or account changes.                                                 | An operation epoch fences asynchronous UI updates; backend runs remain independently authoritative.                                                                    |
| Picker handoff     | A persisted URI lacked an identity, expiry, request owner, and saved session reference.                                                             | A short-lived identity-bound ticket owns each result. Stale results cannot consume a newer ticket. Session IDs survive process recreation; draft text stays in memory. |
| Attachments        | Camera URIs need explicit grants and cleanup; decoding can finish after the overlay reopens.                                                        | Private FileProvider cache files are removed after use/cancellation. Delivery checks the invocation generation and ticket ownership.                                   |
| Transcript build   | The Gradle task could reuse assets after source changes.                                                                                            | Track shared renderer, style, config, generator, and lockfile inputs before APK packaging.                                                                             |
| MCP presentation   | Hashed aliases and large raw output appeared as activity summaries.                                                                                 | Labels come from saved backend metadata or the tool catalog. Input/output details expand separately. Labels never grant permissions.                                   |
| Tests and CI       | CI already runs frontend checks, backend checks, and Android debug build/JVM tests/lint.                                                            | Extend regression coverage at ownership, identity, handoff, and image-boundary seams; keep the CI jobs required for merge.                                             |

The first physical-device pass exposed an assistant-specific window constraint: Material modal dialogs use an Activity window type and crash inside the voice interaction service window. Overlay sheets now portal into the existing assistant window. Streaming WebView input also needs immutable response parameters at the composable boundary; reading a mutable controller only from a side effect can skip updates under Compose strong skipping. These are regression targets for the remaining instrumentation gate.

## Ownership model

- Application: authenticated API client, identity-scoped repositories/caches, preferences, model catalog, MCP presentation labels.
- Activity: navigation and its optional transcript WebView; activity destruction releases its view and callbacks.
- Conversation repository: authoritative history projection, stream subscription, command acknowledgement, revision/cursor reconciliation.
- Overlay conversation: local draft, current invocation, pending UI operation ownership, repository subscription. Hiding disconnects the surface without cancelling a durable server run.
- Overlay composition: its isolated optional WebView, local scroll/selection state, and visual layout. It never reparents the main app's WebView.
- Picker ticket: only URI, request ID, hashed identity, creation time, completion state, and optional session ID. No bearer tokens, image bytes, or draft text.

## Controlled beta gates

Run these on a physical phone and an API-26-compatible target, with a second recent Android/OEM target where possible. Record the device, Android version, WebView version, and observed result.

1. Switch app and overlay rendering independently. Verify chat/activity clicks after switching conversations, reloads, and theme changes. Native mode must not create a hidden WebView.
2. Open/dismiss/reopen the assistant while sending, streaming, stopping, waiting for approval, and opening the full app. Verify no stale error, navigation callback, or prior account content reaches the new invocation.
3. Pick a library image or camera photo after a response. Test cancellation, unavailable camera, rotation in the picker, assistant destruction, and process recreation. Resume the correct session; expire old tickets and reject results from another account/server.
4. Sign out/change server while images load or a picker is open. Confirm old images, labels, cached history, pending selections, and credentials are cleared or rejected.
5. Exercise long replies, large images, malformed images, horizontal code/table scrolling, manual scroll-up during streaming, keyboard changes, and low-memory background/foreground transitions. Capture frame/memory observations without logging message contents.
6. Verify the current-answer-only overlay, composer-only initial view, composer source menu, fixed swipe-height cap, and default-assistant behavior with screenshot permission both enabled and disabled.
7. Disconnect/reconnect during send and stream. Re-submit the same ambiguous command and verify backend idempotency prevents duplicate runs.

## Remaining production gates

- Configure a signed Android release/update pipeline with managed signing credentials, meaningful version codes, and a tested install/update path. The current project still identifies itself as a demo and the existing deliverable is a debug APK.
- Add instrumentation coverage for activity recreation, renderer switching, service-backed WebView readiness, and picker/camera result recovery. Pure/JVM tests cover logic, not Android window behavior.
- Complete and record the device matrix above, including startup, long-stream scrolling, image memory pressure, and renderer resource cleanup.
- Decide and test the supported transport/deployment policy. The client intentionally supports LAN HTTP today; do not describe that configuration as production HTTPS enforcement.
- Define opt-in crash/error reporting and support diagnostics that exclude prompts, images, tokens, and tool output. This refactor does not install telemetry or send user data to a new service.
- Keep dependency maintenance, backend authorization testing, account isolation, and release rollback procedures as release responsibilities; this client refactor does not substitute for them.

Known limitation: session references can recover a picker handoff after process death, but unsent composer text and in-memory screenshots are deliberately not persisted. Surface dismissal may interrupt a client request; recovery still relies on the existing backend history and idempotency contract.
