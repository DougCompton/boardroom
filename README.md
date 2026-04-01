# boardroom

[![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Pi pack](https://img.shields.io/badge/runtime-Pi%20pack-6f42c1)](https://github.com/mariozechner/pi-coding-agent)

Boardroom is an opinionated Pi workflow pack for executive deliberation. It runs CEO-led board sessions from structured briefs, collects specialist responses through Pi subprocess workers, and writes durable memo artifacts back into the repo.

In the broader stack, Pi is the substrate, Pai is the front-door operator shell, and Boardroom is a reusable pack that runs inside Pi. This repo is the pack implementation, not a standalone product shell.

## Current repo state

Current runtime pieces checked into this repo:

- Pi extension entrypoint: `apps/ceo/extensions/ceo-and-board.ts`
- Supporting runtime modules: `apps/ceo/extensions/boardroom/*.ts`
- Project-local Pi settings: `.pi/settings.json`
- Board configuration: `.pi/ceo-agents/ceo-and-board-configuration.yaml`
- Board personas: `.pi/ceo-agents/agents/*.md`
- Seed briefs: `.pi/ceo-agents/briefs/<brief-id>/brief.md`
- SMALL governance artifacts: `.small/*.small.yml`

There is no `docs/` directory and no GitHub Actions workflow in this repo right now. The README is the primary operator-facing doc.

## Runtime

Boardroom targets Node 20+ and uses the Pi coding agent packages declared in `package.json`.

Setup and launch:

```bash
npm install
npm start
```

`npm start` expands to:

```bash
pi -e apps/ceo/extensions/ceo-and-board.ts
```

You can also launch Pi directly with the same extension path. Project-local Pi settings in `.pi/settings.json` set the default provider/model, load the extension, and load the bundled `ceo-board-synthwave` theme.

Kickoff options:

- Interactive slash command: `/ceo-begin`
- Deterministic text trigger: `ceo-begin <brief-id>`

Example:

```text
ceo-begin 2026-03-18-engineering-path
```

The deterministic text trigger exists on purpose so Boardroom is operable by both humans and agents without relying on slash-command UI parsing.

## How the runtime behaves

At session start, the extension:

- loads `.pi/ceo-agents/ceo-and-board-configuration.yaml`
- repairs stale runs through recovery logic
- restores the last in-branch board state when possible
- renders the CEO/board widget and footer in the Pi TUI

During a deliberation, the CEO uses two Pi tools exposed by the extension:

- `converse`: sends bounded prompts to one or more board members and collects responses
- `end_deliberation`: gathers final positions, synthesizes the memo, and closes the run

Board members run as Pi subprocess workers with constrained tools (`read,grep,find,ls`). The runtime tracks elapsed time and micro-USD costs, persists relative-path artifacts, and blocks machine-local absolute paths from leaking into persisted outputs.

## Layout

- `apps/ceo/extensions/ceo-and-board.ts`: main control plane, commands, tools, TUI integration
- `apps/ceo/extensions/boardroom/accounting.ts`: canonical cost and duration accounting helpers
- `apps/ceo/extensions/boardroom/finalize.ts`: closeout ordering and memo finalization
- `apps/ceo/extensions/boardroom/memo.ts`: memo rendering
- `apps/ceo/extensions/boardroom/paths.ts`: repo-relative path validation and normalization
- `apps/ceo/extensions/boardroom/recovery.ts`: stale-run repair and supersession
- `apps/ceo/extensions/boardroom/schema.ts`: runtime types and board definitions
- `apps/ceo/extensions/boardroom/state.ts`: atomic artifact persistence and runtime state helpers
- `.pi/ceo-agents/agents/*.md`: board role personas
- `.pi/ceo-agents/briefs/<brief-id>/brief.md`: decision briefs
- `.pi/ceo-agents/deliberations/<brief-id>-<session-id>/`: transcript, state, and per-member board outputs
- `.pi/ceo-agents/memos/<brief-id>-<session-id>/memo.md`: final memo artifact
- `.pi/ceo-agents/sessions/<member>/`: Pi worker session logs
- `.pi/ceo-agents/expertise/ceo-scratch-pad.md`: CEO scratch pad artifact

## Validation

Available validation commands:

- `npm run check`: TypeScript typecheck
- `npm run build`: compile TypeScript to `dist/`
- `npm test`: build plus the Node test suite in `tests/boardroom/*.test.ts`
- `small check --strict`: validate SMALL governance artifacts

Verified on 2026-03-30 in the local repo:

- `npm run check` ✅
- `npm run build` ✅
- `npm test` ✅ (11 tests)
- `small check --strict` ✅

## Notes on operability

Boardroom is intentionally designed to be:

- human-operable through the Pi TUI
- agent-operable through deterministic text input and durable repo-relative artifacts

That is why the repo keeps canonical brief content in the kickoff prompt, uses deterministic artifact locations, and treats the text trigger path as a first-class interface rather than a fallback.
