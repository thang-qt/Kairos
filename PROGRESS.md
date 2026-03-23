# Progress

## Current Focus

Run Kairos on a generic in-browser chat backend with mock conversation and streaming behavior, with the old OpenClaw server transport removed.

## Status

- Completed

## Completed This Step

- Completed:
  Add a generic chat backend interface and persisted mock frontend backend for conversations, history, send, rename, delete, and streaming updates.
- Completed:
  Refactor the chat hooks and screen to consume the backend interface instead of `/api/*` routes and the OpenClaw gateway.
- Completed:
  Remove the leftover OpenClaw-only routes/server code and clean up generic chat copy in the UI.

## Next Task

Convert Kairos from the TanStack Start server runtime to a plain frontend build oriented around static assets, then add a real HTTP adapter shaped for a future Go `net/http` service that can serve the built assets and power chat over standard HTTP and streaming endpoints.

Current branch feature work:
- Completed:
  Add inline fork navigation at branch points so sibling branches can be switched from the message flow while keeping forks as separate conversations under the hood.
- Completed:
  Add a desktop-only conversation navigator on the right side of the chat scroll area so long threads can jump between user turns without opening the sidebar.

## Planned Follow-Up

After the static frontend conversion is done, add a selectable HTTP backend adapter while keeping the mock backend available for local UI development.
