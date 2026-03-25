# Self-Contained Migration Progress

## Goal

Make Kairos a self-contained chat app with:

- a static frontend build
- one Go backend serving both `/api/*` and the frontend assets
- no Node/React server runtime in production

## Current Findings

- The frontend already behaves like a browser client and talks to the backend over HTTP and SSE.
- The frontend now builds as static assets into `internal/server/static`.
- The Go backend now serves both `/api/*` and the SPA/static assets.
- The frontend assumes same-origin `/api` requests and cookie auth, which fits a single-origin self-contained app.

## Execution Plan

1. Convert the frontend from React Start runtime assumptions to a plain static Vite + TanStack Router SPA.
2. Make the Go backend serve the built frontend with SPA fallback while keeping `/api/*` untouched.
3. Update docs and config to describe the new single-app deployment shape.
4. Build and verify the end-to-end setup.

## Progress

- [x] Audit the current frontend/backend/runtime split.
- [x] Remove React Start server runtime from the frontend build.
- [x] Add static asset serving to the Go backend.
- [x] Update docs and environment guidance.
- [x] Verify `pnpm build`, `pnpm test`, and `go test ./...`.
