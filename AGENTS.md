# Repository Agents Guide

This repository is organized into several top-level folders. Each folder can have its own `AGENTS.md` with specific guidance for work in that area.

## Top-Level Structure
- `app/` - Web app code - Main application code.
- `apple/` - macOS and iOS SwiftUI applications.
- `docs/` - Documentation site (Mintlify documentation).
- `infra/` - Infrastructure and deployment - Infrastructure as Code.
- `skills/` - Skills for Bap agent to use.

## Remarks
- For any work inside a folder, check that folder for its own `AGENTS.md` and follow those instructions.

## Testing

Avoid mocks as much as possible, Test actual implementation, do not duplicate logic into tests
try to colocated tests with the code they test when relevant. for collacting use this format `*.test.ts` or `*.e2e.test.ts`


## Commit policy
-  Do not commit unless the user explicitly asks.
-  Create commits with `scripts/committer "<msg>" <file...>`; avoid manual `git add`/`git commit` so staging stays scoped.
-  Follow concise, action-oriented commit messages (e.g., `CLI: add verbose flag to send`).
-  Group related changes; avoid bundling unrelated refactors.
-  **Multi-agent safety:** when the user says "push," you may `git pull --rebase` to integrate the latest changes (never discard other agents' work). When the user says "commit," scope to your changes only. When the user says "commit all," commit everything in grouped chunks.
-  **Multi-agent safety:** when you see unrecognized files, keep going; focus on your changes and commit only those.