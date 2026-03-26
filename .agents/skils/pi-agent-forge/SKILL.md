---
name: pi-agent-forge
description: Build Pi based agents, bots, extensions, skills, and multi-agent systems with production oriented scaffolding. Use when the user wants a Pi extension, Pi skill, Pi boardroom, custom slash commands, custom tools, subprocess agents, TUI customization, session persistence, or a full Pi based operator workflow.
compatibility: Requires Pi coding agent, Node.js, and a writable project directory. Best in repos using .pi/ and AGENTS.md.
license: MIT
metadata:
  owner: justyn-clark
  domain: pi
  focus: extension-first agent systems
---

# Pi Agent Forge

## Purpose

Use this skill to design and build Pi based systems that are actually runnable, not vague concept art.

This skill exists to produce one of the following:

- a Pi extension
- a Pi skill
- a Pi prompt pack
- a Pi themed UI surface
- a Pi multi-agent orchestration system
- a Pi subprocess board or swarm
- a repo handoff for any of the above

## Use this skill when

Use this skill when the user asks for any of these patterns:

- "build a Pi agent"
- "make a Pi extension"
- "register slash commands or custom tools in Pi"
- "create a board, swarm, council, bot, or orchestrator in Pi"
- "theme Pi to match this visual"
- "turn these screenshots into a working Pi system"
- "make a reusable Pi framework"
- "create a Pi based operator workflow"

## Do not use this skill when

Do not use this skill for:

- generic non Pi agent work
- OpenAI SDK only work without Pi
- MCP only work unless Pi is still the runtime surface
- vague discussion without an implementation target

## Output contract

Always produce all of the following:

1. a clear runtime choice
2. a file tree
3. the exact files to create
4. slash commands and custom tools
5. persistence layout
6. model policy
7. theme or color plan if UI matters
8. run commands
9. acceptance criteria
10. risks and any unresolved assumptions

## Runtime decision rule

Choose one runtime and state why.

### Option A - Pi extension

Use when the system needs any of these:

- custom slash commands
- custom tools callable by the model
- custom footer or TUI
- board or swarm orchestration inside Pi
- interactive selectors or dialogs
- runtime state and session integration

### Option B - Pi skill

Use when the system is mainly a reusable workflow, reference pack, or helper routine that Pi can load on demand.

### Option C - Pi SDK

Use when the user wants programmatic embedding of Pi sessions inside another Node.js application.

### Option D - pi-agent-core

Use when the user needs the lowest level agent loop control and is willing to build more plumbing.

Default to Option A unless there is a strong reason not to.

## Build sequence

Follow this exact sequence.

### 1. Restate the target system in one sentence

Be concrete.

Bad:
- Build something like a strategy system.

Good:
- Build a Pi extension that orchestrates six board member subprocesses and writes a memo.

### 2. Lock the runtime

State the chosen runtime:
- Pi extension
- Pi skill
- Pi SDK
- pi-agent-core

State why.

### 3. Define the operator surface

Specify:

- startup command
- slash commands
- custom tools
- whether there is a picker, overlay, modal, or custom footer
- what the user sees first
- what success looks like

### 4. Define persistence

Always specify:

- `.pi/settings.json`
- extension path
- skill path if relevant
- logs
- session files
- generated artifacts
- state files
- memo or report outputs

### 5. Define the tool contract

For every custom tool provide:

- name
- purpose
- JSON input shape
- JSON output shape
- side effects
- failure behavior

Never skip this.

### 6. Define personas or subagents if needed

If the system has roles, specify:

- role name
- file path
- purpose
- model policy
- allowed tools
- whether session continuity is per run or cross run

### 7. Define the visual system if UI matters

If the system needs a look and feel, define:

- theme name
- accent colors
- footer behavior
- status lines
- message rendering
- widget placement

### 8. Produce the repo scaffold

Always provide a concrete file tree.

### 9. Produce the runbook

Show the exact shell commands needed to boot it.

### 10. Produce acceptance criteria

Use pass or fail bullets only.

## Pi implementation patterns

### Slash command pattern

Use `pi.registerCommand()` for operator entrypoints like:

- `/ceo-begin`
- `/board-run`
- `/agent-new`
- `/swarm-start`

### Tool pattern

Use `pi.registerTool()` for LLM callable operations like:

- `converse`
- `delegate_task`
- `summarize_board`
- `spawn_subagent`
- `write_memo`

### UI pattern

Use these primitives:

- `ctx.ui.select()` for simple pickers
- `ctx.ui.custom()` for rich custom UI
- `ctx.ui.setFooter()` for full custom footer
- `ctx.ui.setStatus()` for live status
- `ctx.ui.setWidget()` for top or bottom widgets
- `pi.registerMessageRenderer()` for custom message rows

### Persistence pattern

Prefer plain files for first versions:

- markdown for briefs, prompts, personas, memos
- JSON or JSONL for machine logs
- one directory per run
- stable slugs plus session ids

### Subprocess pattern

For multi-agent systems, prefer subprocess Pi sessions over fake in memory role functions.

Preferred:
- `pi --mode rpc`

Acceptable:
- normal `pi` CLI subprocesses with named sessions

## Mandatory design rules

- Do not hide the file layout.
- Do not hide the tool contract.
- Do not handwave persistence.
- Do not invent a UI without naming the Pi APIs used.
- Do not leave the user with only concepts.
- Do not choose SDK or core unless there is a real reason.
- Do not use hype language.

## Standard file tree template

```text
project/
├── apps/
│   └── <surface>/
│       └── extensions/
│           └── <system>.ts
├── .pi/
│   ├── settings.json
│   ├── themes/
│   │   └── <theme>.json
│   ├── prompts/
│   ├── skills/
│   └── <system>/
│       ├── config.yaml
│       ├── agents/
│       ├── briefs/
│       ├── runs/
│       ├── logs/
│       └── outputs/
├── AGENTS.md
├── package.json
├── tsconfig.json
└── README.md
```

## Standard acceptance checklist

- boots with the documented command
- slash commands appear and work
- custom tools register and execute
- state persists where documented
- generated files are written
- no hidden manual steps
- errors are surfaced to the operator
- theme loads if a theme was specified
- README runbook works on a clean machine

## Response template

Use this structure:

```md
# <System Name>

## Goal
...

## Runtime Choice
...

## Operator Surface
...

## File Tree
...

## Files to Create
...

## Slash Commands
...

## Custom Tools
...

## Persistence
...

## Model Policy
...

## Theme
...

## Runbook
...

## Acceptance Criteria
...

## Risks / Open Assumptions
...
```

## Final note

Pi is already extensible enough to do real work. Most broken Pi projects fail because they skip contracts, skip persistence, or hide the file tree behind vibes.

Do not do that.
