# How Clawdbot Remembers Everything


## Overview

OpenClaw is an open-source personal AI assistant (MIT licensed) created by Peter Steinberger with over 32,600 GitHub stars. Unlike cloud-based alternatives, it runs locally and integrates with platforms like Discord, WhatsApp, and Telegram. Its standout feature is a persistent memory system enabling 24/7 context retention and indefinite conversation continuity.

## How Context is Built

Each request includes four layers:

1. **System Prompt** (static + conditional instructions)
2. **Project Context** (bootstrap files: AGENTS.md, SOUL.md, etc.)
3. **Conversation History** (messages, tool calls, compaction summaries)
4. **Current Message**

User-editable Markdown files inject context into every request:

| File | Purpose |
|------|---------|
| AGENTS.md | Agent instructions, including memory guidelines |
| SOUL.md | Personality and tone |
| USER.md | Information about the user |
| TOOLS.md | Usage guidance for external tools |

## Context vs Memory

**Context** is ephemeral, bounded, and expensive—everything visible in a single request:

> "Context = System Prompt + Conversation History + Tool Results + Attachments"

**Memory** persists on disk and is searchable:

> "Memory = MEMORY.md + memory/*.md + Session Transcripts"

Memory advantages include persistence across restarts, unbounded growth, no API costs, and semantic indexing.

## The Memory Tools

### memory_search

Semantically searches memory files before answering questions about prior work, decisions, dates, or preferences. Returns results with relevance scores:

```json
{
  "results": [
    {
      "path": "memory/2026-01-20.md",
      "score": 0.87,
      "snippet": "## API Discussion\nDecided to use REST..."
    }
  ]
}
```

### memory_get

Reads specific content after search results are found:

```json
{
  "path": "memory/2026-01-20.md",
  "text": "## API Discussion\n\nMet with the team..."
}
```

### Writing to Memory

No dedicated write tool exists. The agent uses standard `write` and `edit` tools since memory is plain Markdown. Prompt instructions guide destinations:

| Trigger | Destination |
|---------|-------------|
| Day-to-day notes | memory/YYYY-MM-DD.md |
| Durable facts, preferences, decisions | MEMORY.md |
| Lessons learned | AGENTS.md or TOOLS.md |

## Memory Storage

A two-layer system manages persistent knowledge:

### Layer 1: Daily Logs

Append-only daily notes stored as `memory/YYYY-MM-DD.md`:

```markdown
# 2026-01-26

## 10:30 AM - API Discussion
Discussed REST vs GraphQL with user. Decision: use REST for simplicity.

## 2:15 PM - Deployment
Deployed v2.3.0 to production. No issues.
```

### Layer 2: Long-term Memory

Curated, persistent knowledge in `MEMORY.md`:

```markdown
# Long-term Memory

## User Preferences
- Prefers TypeScript over JavaScript
- Likes concise explanations

## Important Decisions
- 2026-01-15: Chose PostgreSQL for database
- 2026-01-20: Adopted REST over GraphQL
```

## Memory Indexing Process

When memory files save, automatic indexing occurs:

1. **File Watcher Detection** — Chokidar monitors changes (debounced 1.5 seconds)
2. **Chunking** — Text splits into ~400 token chunks with 80 token overlap for semantic coherence
3. **Embedding** — Chunks convert to vectors via OpenAI, Gemini, or local providers
4. **Storage** — Vectors store in SQLite with supporting tables

The system uses **sqlite-vec** for vector similarity search and **FTS5** for full-text keyword matching—no external vector database required.

## Memory Search Strategy

Searches run two strategies in parallel:

```
finalScore = (0.7 * vectorScore) + (0.3 * textScore)
```

Vector search finds semantic meaning while BM25 keyword matching catches exact terms like names or IDs. Results below a 0.35 threshold (configurable) are filtered.

## Multi-Agent Memory

Each agent maintains complete memory isolation:

```
~/.clawdbot/memory/
├── main.sqlite          # Vector index for "main" agent
└── work.sqlite          # Vector index for "work" agent

~/clawd/                 # "main" workspace (source files)
└── memory/2026-01-26.md

~/clawd-work/            # "work" workspace (source files)
└── memory/2026-01-26.md
```

Markdown files (source of truth) live in each workspace; SQLite indexes (derived data) live in the state directory. Agents cannot access each other's memories by default.

## Compaction

When conversations approach context limits, compaction summarizes older turns while preserving recent messages:

**Before:** 180,000 / 200,000 tokens with 150+ conversation turns

**After:** 45,000 / 200,000 tokens with summary + recent turns intact

Compaction can be automatic (triggered near limits) or manual (via `/compact` command). Summaries persist to session transcripts so future sessions start compacted.

## Memory Flush

Before compaction begins, a silent memory flush turn extracts important information:

1. System prompts: "Store durable memories now"
2. Agent reviews conversation and writes key decisions to memory files
3. Responds with NO_REPLY (user sees nothing)
4. Compaction proceeds with knowledge safely on disk

Configuration example:

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "reserveTokensFloor": 20000,
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000
        }
      }
    }
  }
}
```

## Pruning

Tool results can consume massive token counts. Pruning trims old outputs without rewriting history—a lossy process where outputs become unrecoverable.

### Cache-TTL Pruning

Anthropic caches prompt prefixes for up to 5 minutes at ~90% reduced token cost. After expiration, cached tokens must be re-cached at full pricing. Cache-TTL pruning detects expiration and trims old tool results before re-caching:

```json
{
  "contextPruning": {
    "mode": "cache-ttl",
    "ttl": "600",
    "keepLastAssistants": 3,
    "softTrim": {
      "maxChars": 4000,
      "headChars": 1500,
      "tailChars": 1500
    }
  }
}
```

## Session Lifecycle

Sessions reset based on configurable rules creating natural memory boundaries:

| Mode | Behavior |
|------|----------|
| daily | Reset at fixed hour (default: 4 AM local) |
| idle | Reset after N minutes of inactivity |
| daily+idle | Whichever expires first |

### Session Memory Hook

When `/new` starts a fresh session, a memory hook automatically saves context:

1. Extracts final 15 messages from ending session
2. Generates descriptive slug via LLM
3. Saves to `~/clawd/memory/2026-01-26-api-design.md`
4. Previous context becomes searchable via memory_search

## Key Principles

Clawdbot's memory system succeeds through:

**1. Transparency Over Black Boxes** — Memory exists as editable Markdown files, not opaque proprietary formats.

**2. Search Over Injection** — Agent searches relevant content rather than stuffing everything into context, reducing costs.

**3. Persistence Over Session** — Important information survives in files, immune to compaction losses.

**4. Hybrid Over Pure** — Vector search captures semantics while keyword search catches exact matches neither alone provides.

## References

- [Clawdbot Documentation](https://docs.clawd.bot/)
- [GitHub Repository](https://github.com/clawdbot/clawdbot)
