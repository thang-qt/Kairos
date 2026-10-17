# Android beta readiness assessment

Assessment scope: the main Android client, native/WebView transcript renderers, assistant overlay, screenshot/library/camera attachments, identity changes, and the shared backend protocol. This is a repository assessment, not a certification of device behavior or a security audit of the Go server.

## Verdict

The client has a credible architecture for a controlled beta once the device gates below pass. It is not yet verified for an unrestricted production release. Compiling a debug APK and passing JVM tests cannot validate a service-backed WebView, OEM assistant invocation, external camera/picker handoffs, or process recreation.

Keep the existing Go backend as the authority for configuration, permissions, approvals, idempotency, and run transitions. Renderer choice is a device-local presentation preference; neither renderer should decide whether a tool can execute.

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
