# E2B Custom Template

Custom E2B sandbox template with bun, Claude CLI, and integration CLI tools pre-installed.

## Prerequisites

- E2B API key in `.env` file (root of project)
- Node.js / bun installed locally

## Building the Template

Run from the project root or from e2b-template directory:

### Development Build

```bash
cd e2b-template
bun run build:dev
```

This creates a template with alias `bap-agent-dev`.

### Production Build

```bash
cd e2b-template
bun run build:prod
```

This creates a template with alias `bap-agent`.

## What's Included

The template includes:

- **Ubuntu 22.04** base image
- **Bun** runtime
- **Claude Agent SDK** (`@anthropic-ai/claude_agent_sdk`)
- **Integration CLI tools** at `/home/user/cli/`:
  - `google-gmail` - Google Gmail integration
  - `google-calendar` - Google Calendar integration
  - `google-docs` - Google Docs integration
  - `google-sheets` - Google Sheets integration
  - `google-drive` - Google Drive integration
  - `github` - GitHub integration
  - `notion` - Notion integration
  - `linear` - Linear integration
  - `slack` - Slack integration
  - `airtable` - Airtable integration
  - `hubspot` - HubSpot integration

## Configuration

Set the template in your `.env`:

```
E2B_TEMPLATE=bap-agent-dev  # or bap-agent for production
```

If not set, defaults to `bap-agent-dev`.

## Updating the Template

When you modify CLI tools in `src/cli/`, rebuild the template:

```bash
tsx build.dev.ts
```

When you change OpenCode/runtime setup in `src/e2b-template/template.ts`, rebuild the template too so runtime sandboxes pick up the prewarmed OpenCode cache and plugins.
