# Kairos for Android

An Android client for your Kairos server, with streaming chat, image attachments,
conversation history, and an optional system-assistant overlay. It requires
Android 8.0 or later and a running Kairos server.

## Install and update

Public Android releases will be available on the
[releases page](https://github.com/thang-qt/Kairos/releases?q=android-v&expanded=true).
See [publishing](publishing.md) for signed releases, Obtainium setup, and F-Droid
submission requirements. The CI builds below remain development builds.

Open the [CI builds](https://github.com/thang-qt/Kairos/actions/workflows/ci.yml)
in your phone's browser while signed in to GitHub. Choose the latest successful
run for the branch you use, then tap **Download Kairos APK** in the build summary
or download the `kairos-<commit>.apk` artifact. Tap the downloaded file to install
it, allowing your browser to install apps if Android asks.

These are development APKs. Downloads remain available for 30 days. Install a
newer APK over the existing app to keep your settings and sign-in. Updates must
use the same signing key; do not uninstall the app to update it.

## Connect to your server

1. Enter your Kairos server's URL and choose **Continue**. Addresses default to
   HTTPS; include `http://` explicitly for a local HTTP server.
2. Sign in with your Kairos account. Create an account and configure a model in
   the web app first if needed.
3. Choose a model and send a message. New launches open a new chat; saved
   conversations remain available in the sidebar.

For a server running on your computer, connect the phone to the same network
and use the computer's LAN address with the backend port, such as
`http://192.168.1.20:8080`. The server must listen on the network interface and
its firewall must allow the connection. `localhost` on the phone refers to the
phone itself. Port 3000 serves the development web UI; use the backend port.

Use HTTPS for remote servers. HTTP connections are not encrypted. The server
URL, appearance, and sign-in are remembered. **Change server** signs out of the
current server before returning to connection setup.

## Everyday use

- Open the sidebar to find, search, rename, pin, or delete saved conversations.
- Use the model picker and conversation settings to choose how a chat runs.
- Attach images from Photos or Camera. Long-press a message for its available
  actions, including copy, edit, retry, and fork.
- Tap an answer's activity chip to inspect thinking, tool calls, and results.
- Review remote-tool approval requests before allowing or denying them.
- Use a throwaway chat when you do not want a saved conversation. Remote MCP
  tools are unavailable in throwaway chats.

Recent conversations and model information are cached on the device. You can
read cached history without a connection, but sending requires the server.
Returning to a conversation reconnects to its saved server history. Signing out
or changing servers clears the previous account's cached data and drafts.

## Use Kairos as your assistant

Open **Settings → Assistant** and follow **Set as default assistant**. On devices
that do not show a role prompt, select Kairos in Android's default digital
assistant settings. Invoke it using your device's assistant gesture; available
gestures and setup screens vary by manufacturer.

The overlay opens with a composer. Send a message to show the reply, tap the
activity chip for details, or swipe the handle upward to open the conversation
in the full app. Tap outside or use Back to dismiss it. Dismissing the overlay
does not stop an accepted server run.

The attachment menu offers **Screen**, **Photos**, and **Camera**. To use Screen,
enable **Use screenshot** in Android's digital assistant settings. Screenshots
are attached only when you choose them. Secure apps may prevent screen capture.
Photos and Camera temporarily open their system screens and then return to
Kairos. Images are resized before sending.

## Appearance and rendering

Appearance settings offer six palettes and Light, Dark, or System mode.
**Conversation → App rendering** and **Assistant → Overlay rendering** select
rendering independently:

- **WebView** uses the shared Kairos message renderer, including code, tables,
  and math. This is the full app's default.
- **Native** uses Android text and image rendering. This is the overlay's default.

Devices without the required WebView features fall back to Native rendering.

## Limitations and troubleshooting

Provider administration, account changes, conversation import, and bulk export
are available in the web app. Android does not include voice transcription,
hotword activation, document attachments, or a durable offline send queue.
Background streaming is not guaranteed; reopen a conversation to reconnect.

- **Cannot connect:** check the server URL, network, backend port, and firewall.
- **Sign-in stops working:** sign in again; expired or revoked tokens are cleared.
- **Assistant does not open:** check Android's default assistant setting and your
  device's gesture configuration.
- **Screen attachment is unavailable:** enable screenshot access in assistant
  settings; some apps prohibit capture.
- **Photo selection does not return:** finish or cancel the system picker/camera
  before starting another selection. If Android loses the result, fully close
  and reopen Kairos.
