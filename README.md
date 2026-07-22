# RelayDock Console

RelayDock control-plane web console. The application is built with React, TypeScript, and Vite.

## Requirements

- Node.js 22
- npm 10 or newer

## Development

```bash
npm ci
npm run dev
```

The development server listens on `0.0.0.0:5173` and proxies `/api` requests to `http://127.0.0.1:12889`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The production build is written to `dist/`. To publish a bundled Arcway backend release, replace the backend repository's `internal/web/dist/` directory with this output before building the Go binary.

End-to-end tests can be run with `npm run test:e2e` after installing the required Playwright browser. Set `PRODUCTION_BASE_URL` to include the optional production deployment smoke tests.

## License

This project retains the upstream MIT license. See [LICENSE](LICENSE).
