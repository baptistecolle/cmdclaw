<p align="center">
  <img src="app/public/logo.png" alt="Bap" width="80" />
</p>

<h1 align="center">Bap</h1>

<p align="center">
  Your voice coworker — an open-source AI assistant that connects to the tools you use every day.
</p>

<p align="center">
  <a href="https://docs.heybap.com"><img src="https://img.shields.io/badge/docs-heybap.com-blue" alt="Documentation" /></a>
  <a href="https://discord.com/invite/NHQy8gXerd"><img src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://heybap.com">Website</a> &middot;
  <a href="https://app.heybap.com">App</a> &middot;
  <a href="https://docs.heybap.com">Docs</a> &middot;
  <a href="https://discord.com/invite/NHQy8gXerd">Discord</a>
</p>

---

Bap is an open-source, multi-platform AI assistant that lets you interact with your favorite services through conversation. Connect your tools, talk to Bap, and let it handle the rest — from sending emails and scheduling meetings to managing issues and updating your CRM.

## Features

- **Conversational AI** — Powered by Claude, with streaming responses and multi-turn context
- **13+ Integrations** — Gmail, Google Calendar, Google Docs, Google Sheets, Google Drive, Notion, Linear, GitHub, Airtable, Slack, HubSpot, Salesforce, LinkedIn
- **Voice Input** — Native speech-to-text on macOS and iOS via Whisper
- **Custom Skills** — Create and manage reusable skills with a built-in editor
- **Approval Workflow** — Review and approve sensitive actions before they execute
- **Code Execution** — Sandboxed code running via E2B
- **Cross-Platform** — Web (Next.js), macOS (SwiftUI), iOS (SwiftUI)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web | Next.js 16, React 19, Tailwind CSS 4 |
| API | ORPC, Better Auth |
| Database | PostgreSQL, Drizzle ORM |
| AI | Anthropic Claude, OpenAI, Google Gemini |
| Queue | BullMQ, Redis |
| Storage | S3 / MinIO |
| Sandbox | E2B |
| Native | SwiftUI (macOS & iOS) |

## Project Structure

```
bap/
├── app/          # Next.js web application
├── apple/        # macOS and iOS SwiftUI applications
├── docs/         # Documentation site (Mintlify)
└── infra/        # Infrastructure as code
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (recommended)
- PostgreSQL
- Redis

### Setup

```bash
# Clone the repo
git clone https://github.com/your-username/bap.git
cd bap/app

# Install dependencies
bun install

# Start local services (Postgres, Redis, MinIO)
docker compose up -d

# Configure environment variables
cp .env.example .env

# Push the database schema
bun db:push

# Seed the database (optional)
bun db:seed

# Start the dev server
bun dev
```

The app will be available at `http://localhost:3000`.

### Useful Commands

```bash
bun dev             # Start dev server
bun build           # Production build
bun db:studio       # Open Drizzle Studio (DB browser)
bun db:push         # Push schema changes
bun lint:fix        # Fix lint issues
bun typecheck       # Run type checker
bun test            # Run unit tests
bun test:e2e        # Run end-to-end tests
bun worker          # Start background job worker
```

## Native Apps

The `apple/` directory contains SwiftUI applications for macOS and iOS. Open `apple/Bap.xcodeproj` in Xcode to build and run.

Features specific to native apps:
- Voice input with Whisper transcription
- macOS overlay chat interface
- Native networking layer

## Contributing

Bap is open source and contributions are welcome. Feel free to open issues, submit pull requests, or suggest new integrations.

## License

Open source. See [LICENSE](LICENSE) for details.
