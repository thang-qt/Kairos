# Kairos

Kairos is a standalone chat app extracted from the original WebClaw app source.

## Commands

```bash
pnpm dev
pnpm build
pnpm preview
pnpm test
pnpm lint
```

## Current Direction

The current extraction keeps the existing app structure while moving it to the repository root.
Kairos now runs on a generic mock chat backend in the frontend. The next step is to swap the remaining app runtime toward a static asset build and add a real HTTP adapter for a future Go `net/http` service.

## License

See [LICENSE](LICENSE).
