# Progress

## Current Focus

Extract the `apps/webclaw` app into the repository root as a standalone app, remove the landing page and other redundant monorepo pieces, and rename the app from WebClaw to Kairos.

## Status

- Completed

## Next Task

Introduce a generic chat backend boundary for Kairos, then replace the current OpenClaw-specific app calls incrementally with a pluggable frontend implementation starting with mock conversation, message, and streaming behavior.

## Planned Follow-Up

After the backend boundary and mock frontend backend are in place, add a real HTTP adapter shaped for a future Go `net/http` service that can serve the compiled frontend assets and power the chat API over standard HTTP and streaming endpoints.
