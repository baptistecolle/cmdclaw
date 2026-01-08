# Repository Guidelines

Guide for ViralPilot's Next.js codebase.

## 1. Project Overview
- **Simplicity first** - reuse primitives before adding deps; validate inputs early; keep components small and composable.
- **Minimize dependencies** – Always ask: "Can we do this with what we have?"
- **Consistency wins** – Follow existing patterns; document any necessary divergence
- **Fail fast** – Validate inputs early, throw meaningful errors
- **Let code speak** – If you need long comments, refactor until intent is obvious

## 2. Tech Stack & Dependencies
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: TailwindCSS
- **Components**: animate-ui (preferred) with shadcn fallback
- **State**: Zustand
- **API Layer**: tRPC
- **Database**: Drizzle ORM + Postgres
- **Jobs**: BullMQ + Redis
- **Auth**: Better-Auth
- **Analytics**: PostHog
- **Animation**: motion
- **Lucide React** - Icon library

## 3. Project Structure
```
├── public/                  # Static assets
├── scripts/
│   └── bullmq-worker.ts     # BullMQ entrypoint; keep logic in src/server/queues
├── src/
│   ├── app/                 # Routes/pages (login, upload, admin)
│   ├── components/          # Reusable UI
│   │   ├── animate-ui/      # Preferred animate-ui components
│   │   └── ui/              # shadcn fallback components
│   ├── hooks/               # Shared hooks
│   ├── lib/                 # Utilities and helpers
│   ├── server/              # DB, auth, helpers
│   │   ├── api/             # API helpers and integrations
│   │   ├── db/              # Drizzle schema and queries
│   │   └── queues/          # BullMQ processors/config; import into scripts/bullmq-worker.ts
│   ├── trpc/                # tRPC config
│   └── env.js               # Runtime env loader
├── tests/
│   ├── unit/                # Vitest suites
│   └── e2e/                 # Playwright specs
├── docker-compose.yml       # Local Postgres/Redis
└── drizzle.config.ts        # Drizzle kit configuration
```

## 4. Build, Test, and Development Commands
- **Dev/Prod**: `bun dev`, `bun build`, `bun start`.
- **Quality**: `bun lint`, `bun lint:fix`, `bun format:check`, `bun format:write`, `bun typecheck`.
- **Database**: `bun db:generate`, `bun db:migrate`, `bun db:push`, `bun db:seed`, `bun db:reset`, `bun db:recreate`.
- **Workers**: keep `scripts/bullmq-worker.ts` thin; move processors/queues to `src/server/queues`.
- **Testing**: `bun test` (Vitest) and `bun test:e2e` (Playwright).

## 5. Coding Style & Naming Conventions
- TypeScript + React 19; components in `PascalCase`, hooks in `useCamelCase`, files mirror exports.
- Default to 2-space indentation; avoid `any`; follow App Router patterns and functional components.
- Use `clsx`/`tailwind-merge` for class composition; colocate styles with components; avoid editing generated Drizzle artifacts.

## 6. Design Requirements

- **Light mode**: The whole website should only be in light mode
- **Mobile-first**: Ensure all components work on mobile
- **Consistency**: Use CSS variables for all colors

## 7. Pre-commit Process
1. Run `bun typecheck` to check for type errors
2. Run `bun lint` to check code quality
3. Run `bun check` to check compilation errors
4. Fix all errors and warnings before committing

## 8. Commit & Pull Request Guidelines
- Commits: short, present-tense, scoped (e.g., `template ready`); avoid bundling unrelated work.
- PRs: include a brief summary, linked issue (if any), testing notes, and screenshots/GIFs for UI changes.
- Highlight schema or env changes prominently and update onboarding notes when new variables are required.

## 9. Drizzle Guidelines:
1. **Prefer application logic** for data transformations (COALESCE, calculations, formatting)
2. **Use Drizzle built-ins** for simple aggregations (`count`, `sum`, `avg`, `min`, `max`) when performance matters
3. **Never use `sql` templates** for complex logic or calculations
4. **Correlated subqueries**: Drizzle doesn't support referencing outer query columns in subqueries - fetch data with joins/aggregations, then process in TypeScript
5. **When in doubt, rethink your approach**, fetch raw data and process in TypeScript. When you are not sure about the data, ask the user for clarification

### Drizzle Built-in Operators - CRITICAL:

**Avoid using the `sql` tagged template literal whenever Drizzle provides a built-in operator.** Using Drizzle operators provides type safety, better maintainability, and prevents SQL injection.

**Commonly forgotten Drizzle operators:**
- Use `isNull()` and `isNotNull()` instead of `sql\`IS NULL\``
- Use `ilike()` for case-insensitive pattern matching instead of `sql\`LOWER(column)\``
- Use `and()` and `or()` for logical operations, NEVER JavaScript `&&` or `||`
- Other operators: `like()`, `not()`, `inArray()`, `between()`, `gt()`, `gte()`, `lt()`, `lte()`

**NEVER use JavaScript `&&` or `||` in `.where()` clauses.** Using JavaScript operators causes incorrect SQL generation and breaks filters, creating potential security issues (e.g., organization filters being ignored).

## 10. Component Creation Guidelines

When creating components:
1. Check if similar component exists in `components/`
2. **Always prefer animate-ui components** - Before using native browser APIs or custom implementations, check if a shadcn component exists (e.g., use `AlertDialog` instead of `confirm()`, `Dialog` instead of modals, `Select` instead of native select). Feel free to install new components from the animate-ui CLI and use those as a starting point. All the animate-ui components are in the src/components/animate-ui folder. If the component you want does not exist in animate-ui, fall back to shadcn. Always ask the user to install any required shadcn components; they will run `bunx shadcn@latest add ...` as needed.

## 11. API Usage

- Prefer tRPC for client–server interactions to keep end-to-end type safety.
- Avoid bespoke REST/fetch calls when a tRPC procedure can serve the need.
- Keep procedure inputs validated early and small; reuse shared types where possible.
