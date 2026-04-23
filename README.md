# Boardroom

[![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Pi pack](https://img.shields.io/badge/runtime-Pi%20pack-6f42c1)](https://github.com/mariozechner/pi-coding-agent)

Boardroom is a Pi-based executive deliberation pack from Justin Clark Network.

It runs CEO-led board sessions from structured briefs, fans out bounded prompts to specialist board members through Pi subprocess workers, and writes durable memo artifacts back into the repo.

In the broader stack, Pi is the substrate, Pai is the front door, and Boardroom is a reusable pack that runs inside Pi.

## What it is

Boardroom gives a Pi operator a structured way to:

- select a decision brief
- run bounded multi-member board rounds
- synthesize responses through a CEO control plane
- close a session into durable memo artifacts
- recover stale runs without leaking machine-local paths into saved outputs

This repository contains the pack implementation, sample board personas, sample briefs, tests, and the runtime wiring needed to launch it locally.

## Repo status

This repo is public release ready for GitHub.

It intentionally keeps sample configuration and sample briefs in version control, while generated runtime artifacts like session logs, scratch pads, deliberation runs, memos, and debug logs are ignored.

## Runtime requirements

- Node.js 20+
- npm
- Pi coding agent available on PATH as `pi`

## Quick start

### Use the npm package

```bash
npm install @justyn-clark/boardroom
npx boardroom init
npx boardroom start
```

`boardroom init` copies the bundled `.pi` and `.small` assets into the current project and rewrites `.pi/settings.json` to point at the installed package extension.

`boardroom start` launches Pi with the packaged Boardroom extension directly.

### Work from this repo

```bash
npm install
npm run check
npm test
npm start
```

`npm start` launches:

```bash
pi -e apps/ceo/extensions/ceo-and-board.ts
```

Project-local Pi settings live in `.pi/settings.json` and load:

- the Boardroom extension
- the bundled `ceo-board-synthwave` theme
- the default provider and model configuration

## Operator entrypoints

Kick off a board session with either:

- `/ceo-begin`
- `ceo-begin <brief-id>`

Example:

```text
ceo-begin 2026-03-18-engineering-path
```

The deterministic text trigger is deliberate so the pack is operable by both humans and agents.

## Repository layout

```text
apps/ceo/extensions/ceo-and-board.ts          Main control plane and Pi integration
apps/ceo/extensions/boardroom/*.ts            Runtime modules for state, recovery, paths, memo, and accounting
.pi/settings.json                             Project-local Pi settings
.pi/ceo-agents/ceo-and-board-configuration.yaml  Board config and runtime constraints
.pi/ceo-agents/agents/*.md                    Board personas
.pi/ceo-agents/briefs/<brief-id>/brief.md     Sample decision briefs
.pi/themes/ceo-board-synthwave.json           Bundled theme
.small/*.small.yml                            SMALL governance artifacts
tests/boardroom/*.test.ts                     Runtime hardening tests
```

## Validation

Available checks:

- `npm run check`
- `npm run build`
- `npm test`
- `npm run package:check`
- `small check --strict`

## Product positioning

Boardroom is a Justin Clark Network product and a Pi-native pack, not a standalone umbrella shell.

That means:

- Pi provides the runtime substrate
- Pai is the broader operator surface
- Boardroom provides the deliberation workflow pack

## License

This repository is released under Apache License 2.0. It is open source, commercially usable, and includes an explicit patent grant. See `LICENSE.md`.
