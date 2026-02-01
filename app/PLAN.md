# Plan: Add Persistent Memory to HeyBap (based on OpenClaw)

## What I reviewed (so we’re aligned on references)

### HeyBap repo (current architecture)
- `app/src/server/services/generation-manager.ts` — OpenCode (E2B) vs direct (BYOC) generation flows, system prompt assembly, tool loop, message history.
- `app/src/server/ai/tools.ts` — tool definitions for direct mode (bash/write/read/etc.).
- `app/src/server/sandbox/e2b.ts` — sandbox creation, OpenCode server boot, **DB → sandbox file sync** for skills (`writeSkillsToSandbox`).
- `app/src/server/sandbox/types.ts` — sandbox backend interface (execute/write/read).
- `app/src/server/db/schema.ts` — current PostgreSQL schema (messages/conversations/etc.).
- `app/src/e2b-template/opencode.json` — OpenCode tool permissions inside E2B sandbox.
- `app/openclaw-memory.md` — your blog summary of OpenClaw memory mechanics.

### OpenClaw repo (memory architecture)
- `src/memory/manager.ts` — indexing, watcher, session transcript ingestion, hybrid search.
- `src/memory/memory-schema.ts` — SQLite schema for chunks/files/embedding cache.
- `src/memory/internal.ts` — file discovery, chunking, hashing, memory file rules.
- `src/memory/manager-search.ts` — vector + FTS search implementations.
- `src/agents/tools/memory-tool.ts` — `memory_search` / `memory_get` tool contract.
- `src/agents/memory-search.ts` — config defaults, providers, store path.
- `src/hooks/bundled/session-memory/*` — session-to-memory file flush behavior.
- `docs/cli/memory*` — memory status/index/search semantics.

### Reference sources to use during implementation
- OpenCode plugins docs: https://opencode.ai/docs/plugins/
- Local memory spec: `/Users/baptiste/Git/bap/app/openclaw-memory.md`
- OpenClaw reference implementation: `/Users/baptiste/Git/openclaw`

## Decisions from you (locked)

- Scope: **per user** memory (no backfill; start fresh).
- Search: **semantic + keyword** (hybrid).
- Embeddings storage: **pgvector in Postgres** (per-user embeddings config).
- Retention: **long-term memory retained forever**.
- Memory writes: **via a tool** (server-side write into Postgres).
- Compaction: **OpenClaw-style memory flush before compaction** (hook into OpenCode plugin).
- Sandbox memory path: **/app/bap**.

## Proposed design (mapped to HeyBap)

### Core data model (DB is source of truth)
- Store memory entries in Postgres (per user).
- Materialize memory **files** into sandbox FS on demand (E2B or BYOC sandbox), similar to how skills are written.
- Provide a **search index** via **pgvector** in Postgres (no server-local SQLite index).

### Memory file layout (in sandbox)
- `MEMORY.md` for long-term, curated memory.
- `memory/YYYY-MM-DD.md` for daily logs (append-only).
- These are *derived* from DB, written to sandbox at session start and after writes.
- Path: **/app/bap** (e.g., `/app/bap/MEMORY.md`, `/app/bap/memory/YYYY-MM-DD.md`).

### Tooling surface
- Add `memory_search` + `memory_get` + `memory_write` tools for direct-mode (BYOC) LLM tool loop.
- For OpenCode-in-E2B:
  - **Use an OpenCode plugin** to register tools and hook compaction events.
  - **Memory write trigger:** pre-compaction “memory flush” turn (OpenClaw-style) + explicit `memory_write`.
  - Still write memory files into the sandbox for transparency and fallback.

## Implementation plan (high-level)

### 1) Define memory scope + schema in DB
- Add tables for memory files/chunks keyed by `userId`.
- Store metadata: type (`daily`/`longterm`), date, title, tags, hash, created/updated timestamps.
- Store chunk embeddings in `vector` columns (pgvector) with model/provider metadata.

### 2) Build a memory service (server-side)
- API surface (internal):
  - `memory.writeEntry()` → writes DB record, re-chunks, embeds, updates pgvector rows.
  - `memory.readFile()` → reconstitutes `MEMORY.md` or daily file from DB.
  - `memory.search()` → hybrid (pgvector + BM25/tsvector).
- File materialization:
  - `syncMemoryToSandbox(conversationId, userId, sandboxBackend)`
  - Reuse patterns from `writeSkillsToSandbox` to write memory files into sandbox.

### 3) Add memory search/index (OpenClaw-inspired)
- Port chunking + hashing (`src/memory/internal.ts`), hybrid search (`manager-search.ts`).
- Store embeddings in Postgres (pgvector) and keyword index (tsvector).
- Add background reindex triggers:
  - On memory write (immediate update).
  - On session start (optional lazy refresh).

### 4) Wire tools + plugins into LLM flows
- Direct/BYOC:
  - Extend `app/src/server/ai/tools.ts` with `memory_search`, `memory_get`, `memory_write`.
  - Update system prompt in `generation-manager.ts` to instruct memory recall.
- OpenCode/E2B:
  - Add **OpenCode plugin** to register memory tools and hook compaction events.
  - Write memory files into sandbox and add a system prompt instruction to use memory tools (fallback: read/grep).

### 5) UI + API (optional but likely needed)
- Add ORPC routes for user-facing memory management (list/read/write/delete/reindex).
- Add admin or user settings for memory provider, embeddings, retention policy.

### 6) Safety + permissions
- Ensure memory read/write is scoped to user.
- Consider PII handling, encryption at rest (if required), and retention TTLs.

## Defaults (no open questions)

- Embeddings provider: **OpenAI by default**, configurable per user.
- Daily logs retention: **keep forever**.
- Memory flush prompt/thresholds: **use OpenClaw defaults**.

## OpenCode plugin notes (from docs)

- OpenCode supports custom tools via plugins and exposes session events including `session.compacted` and `experimental.session.compacting`, which gives us a hook for a pre-compaction memory flush and/or context injection.
- Plugins can be loaded from project `.opencode/plugins/` or via npm packages configured in `opencode.json`.

## Next steps once you answer
- I’ll draft a concrete technical plan with exact file changes, schema definitions, and a migration checklist.
- Then I’ll start implementing in small increments (schema → service → tools → sandbox sync → prompts → tests).
