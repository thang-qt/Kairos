# Kairos

Kairos is a self-contained chat app with:

- a static React frontend built by Vite
- a Go backend serving both `/api/*` and the compiled frontend
- no Node server runtime in production

## Commands

```bash
pnpm dev
pnpm dev:frontend
pnpm dev:backend
pnpm build
pnpm preview
pnpm test
pnpm lint
go test ./...
```

## Development

- Run `pnpm dev` to start both the frontend dev server on port `3000` and the Go backend on port `8080`.
- Run `pnpm dev:frontend` when you only need the Vite frontend.
- Run `pnpm dev:backend` when you only need the Go backend.
- The Vite dev server proxies `/api/*` requests to the Go backend.

## Production Build

1. Run `pnpm build` to compile the frontend into `internal/server/static`.
2. Run `go build ./cmd/kairosd` to produce the backend binary with the frontend assets embedded.

The resulting Go binary serves both the SPA routes and the API from the same origin.

## License

See [LICENSE](LICENSE).
