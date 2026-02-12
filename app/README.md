## Bap App

### Development

```bash
bun install
bun run dev
```

### Testing

```bash
bun run test               # all Vitest unit tests
bun run test:unit          # unit test suite only
bun run test:unit:watch    # unit tests in watch mode
bun run test:e2e           # Playwright e2e smoke tests
bun run test:coverage      # generate coverage report for unit tests
bun run test:coverage:check  # enforce 60% coverage threshold
bun run test:all           # run unit + e2e sequentially
```
