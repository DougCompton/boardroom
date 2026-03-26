# Pi CEO and Board Recreation Handoff

## Goal

Recreate the Pi based "CEO and Board" decision system shown in the screenshots as a working Pi extension with the same interaction model, the same board roles, the same file layout, and the same synthwave color identity.

This handoff is optimized for implementation, not ideation.

## What is confirmed from the screenshots

The visible implementation is a Pi extension loaded from:

```bash
cd apps/ceo && pi -e extensions/ceo-and-board.ts
```

The extension file is:

```text
apps/ceo/extensions/ceo-and-board.ts
```

The top comment in that file identifies the extension as:

```ts
/**
 * CEO & Board - Strategic Decision-Making Agent Team
 *
 * v1 deliberation engine. Registers `converse` and `end_deliberation`
 * custom tools, spawns board member Pi agent subprocesses with persistent
 * sessions, logs all conversations to .jsonl, and renders board member
 * responses in the TUI.
 *
 * Usage: pi -e extensions/ceo-and-board.ts
 *        or auto-loaded via .pi/settings.json
 */
```

The running board shown in the terminal UI is:

- CEO - anthropic/claude-opus-4-6 1M
- Revenue - anthropic/claude-sonnet-4-6 1M
- Product Strategist - anthropic/claude-sonnet-4-6 1M
- Technical Architect - anthropic/claude-sonnet-4-6 1M
- Contrarian - anthropic/claude-sonnet-4-6 1M
- Compounder - anthropic/claude-sonnet-4-6 1M
- Moonshot - anthropic/claude-sonnet-4-6 1M

The command shown to start the workflow is:

```text
/ceo-begin
```

The startup UI shows:

- Time: 2-5 min
- Budget: $1-$5
- Editor: code

The visible brief picker contains these brief IDs:

- 2026-03-18-acquisition-offer
- 2026-03-17-shorts-platform
- 2026-03-18-home-purchase-wfh
- 2026-03-18-engineering-path
- 2026-03-18-solo-plugin-bet
- 2026-03-18-fda-warning
- 2026-03-17-agentic-copilot

The extension writes a CEO scratch pad file before the board fully opens. The visible path is:

```text
~/Documents/projects/agentic-engineer/tac-agentic-horizon/specialized-multi-agent-orchestration/ceo-agents/.pi/ceo-agents/expertise/ceo-scratch-pad.md
```

The memo output is a markdown file with frontmatter. A visible example contains:

```yaml
---
title: "Board Memo: brief"
date: 2026-03-19
duration: 10.9 minutes
budget_used: $4.61
board_members:
  - Revenue
  - Product Strategist
  - Technical Architect
  - Contrarian
  - Compounder
  - Moonshot
brief: /Users/indydevdan/Documents/projects/agentic-engineer/tac-agentic-horizon/specialized-multi-agent-orchestration/ceo-agents/.pi/ceo-agents/briefs/2026-03-18-acquisition-offer/brief.md
transcript: /Users/indydevdan/Documents/projects/agentic-engineer/tac-agentic-horizon/specialized-multi-agent-orchestration/ceo-agents/.pi/ceo-agents/deliberations/2026-03-18-acquisition-offer-9xfmor/conversation.jsonl
---
```

The visible memo body shows this decision example:

- Session: 9xfmor
- Decision: Accept the $12M acquisition offer with conditions
- Board Vote: 5 Accept / 1 Reject
- Deliberation Cost: $4.61

## What is confirmed from the YAML screenshots

Create this file:

```text
.pi/ceo-agents/ceo-and-board-configuration.yaml
```

Use this extracted content:

```yaml
---
meeting:
  constraints:
    min_time_minutes: 2
    max_time_minutes: 5
    min_budget: $1
    max_budget: $5
    editor: "code"

brief_sections:
  - section: "## Situation"
    description: "What is happening right now? State the facts. No opinion, no spin."
  - section: "## Stakes"
    description: "What's at risk? Upside if we get it right, downside if we get it wrong."
  - section: "## Constraints"
    description: "Budget, timeline, team capacity, technical debt, regulatory, contractual boundaries."
  - section: "## Key Question"
    description: "The single most important question you want the board to answer. Be specific."

paths:
  briefs: .pi/ceo-agents/briefs/
  deliberations: .pi/ceo-agents/deliberations/
  memos: .pi/ceo-agents/memos/
  agents: .pi/ceo-agents/agents/

board:
  - name: Revenue
    path: .pi/ceo-agents/agents/revenue.md
    color: "#ff7edb"
  - name: Product Strategist
    path: .pi/ceo-agents/agents/product-strategist.md
    color: "#fede5d"
  - name: Technical Architect
    path: .pi/ceo-agents/agents/technical-architect.md
    color: "#ff6e96"
  - name: Contrarian
    path: .pi/ceo-agents/agents/contrarian.md
    color: "#ff9e64"
  - name: Compounder
    path: .pi/ceo-agents/agents/compounder.md
    color: "#72f1b8"
  - name: Moonshot
    path: .pi/ceo-agents/agents/moonshot.md
    color: "#7dcfff"

# Optional roles present in the concept art but not active in the running board:
# - name: Customer Oracle
#   color: "#00f6ff"
# - name: Market Strategist
#   color: "#c792ea"
```

## What is confirmed from the concept art

The concept art shows the broader board vocabulary:

- You, the Engineer
- Pi Extension
- CEO
- Revenue
- Product Strategist
- Technical Architect
- Contrarian
- Compounder
- Customer Oracle
- Market Strategist
- Moonshot

The running implementation appears to have narrowed this to six active board members plus CEO. Customer Oracle and Market Strategist appear to have been cut or commented out.

## What is partially visible and should be treated as inferred

These details are strongly suggested by the screenshots but not fully legible:

- The extension uses a synthwave themed palette with bright cyan, pink, yellow, green, orange, and blue accents.
- The extension uses custom footer rendering and custom message rendering.
- The extension shows live board member statuses, cost, and remaining context.
- The extension likely writes both a transcript file and per session memo artifacts.
- The extension likely uses a structured prompt exchange where the CEO model calls `converse` repeatedly and then calls `end_deliberation`.

Do not claim exact textual parity for obscured lines. Recreate behavior, not fantasy OCR.

## Non-negotiable architecture

Implement the system as one Pi extension that orchestrates multiple subordinate Pi sessions.

### Control plane

- One top level Pi interactive session running the extension.
- The top level model is the CEO.
- The CEO is the only model directly interacting with the user.
- The CEO must have access to two custom tools:
  - `converse`
  - `end_deliberation`

### Worker plane

Each board member runs as its own Pi subprocess with its own persistent session state.

Each board member has:

- its own markdown persona file
- its own session file or session directory
- its own color
- its own transcript segment in the shared deliberation log
- the same project cwd as the parent session

### Persistence

Per deliberation, persist:

- selected brief path
- generated session id
- conversation transcript as JSONL
- CEO scratch pad
- board member outputs
- final memo markdown

## Required repo structure

```text
ceo-agents/
├── apps/
│   └── ceo/
│       └── extensions/
│           └── ceo-and-board.ts
├── .pi/
│   ├── settings.json
│   ├── ceo-agents/
│   │   ├── ceo-and-board-configuration.yaml
│   │   ├── agents/
│   │   │   ├── revenue.md
│   │   │   ├── product-strategist.md
│   │   │   ├── technical-architect.md
│   │   │   ├── contrarian.md
│   │   │   ├── compounder.md
│   │   │   └── moonshot.md
│   │   ├── briefs/
│   │   │   └── <brief-id>/
│   │   │       └── brief.md
│   │   ├── deliberations/
│   │   │   └── <brief-id>-<session-id>/
│   │   │       ├── conversation.jsonl
│   │   │       ├── state.json
│   │   │       └── board/
│   │   │           ├── revenue.md
│   │   │           ├── product-strategist.md
│   │   │           ├── technical-architect.md
│   │   │           ├── contrarian.md
│   │   │           ├── compounder.md
│   │   │           └── moonshot.md
│   │   ├── memos/
│   │   │   └── <brief-id>-<session-id>/
│   │   │       └── memo.md
│   │   └── expertise/
│   │       └── ceo-scratch-pad.md
├── AGENTS.md
├── package.json
├── tsconfig.json
└── README.md
```

## Extension behavior contract

### Slash command

Register:

```text
/ceo-begin
```

Behavior:

1. Load `.pi/ceo-agents/ceo-and-board-configuration.yaml`.
2. Discover briefs from `.pi/ceo-agents/briefs/`.
3. Present interactive brief selector.
4. Open or create a deliberation session id.
5. Write a working scratch pad file for the CEO.
6. Switch the top level model to the CEO model if needed.
7. Inject the selected brief into the session.
8. Begin the CEO loop.

### Tool: converse

Purpose:
- Send a structured prompt from the CEO to one or more board members.
- Spawn or resume each member's Pi subprocess.
- Read member responses.
- Return them to the CEO in a compact, structured bundle.

Input contract:

```json
{
  "to": ["Revenue", "Contrarian"],
  "subject": "Round 1",
  "prompt": "Evaluate the offer from your perspective. Answer directly.",
  "mode": "parallel"
}
```

Output contract:

```json
{
  "responses": [
    {
      "member": "Revenue",
      "status": "ok",
      "content": "..."
    },
    {
      "member": "Contrarian",
      "status": "ok",
      "content": "..."
    }
  ],
  "cost_delta_usd": 0.37,
  "elapsed_ms": 18234
}
```

### Tool: end_deliberation

Purpose:
- Close the meeting.
- Ask each active board member for a final position statement.
- Force a final CEO synthesis.
- Persist the memo.

Input contract:

```json
{
  "closing_prompt": "Board - we have hit our constraint. Final position, one statement each.",
  "decision_format": "ranked-memo"
}
```

Output contract:

```json
{
  "status": "closed",
  "memo_path": ".pi/ceo-agents/memos/<brief-id>-<session-id>/memo.md",
  "vote_summary": {
    "accept": 5,
    "reject": 1
  },
  "cost_total_usd": 4.61
}
```

## TUI requirements

Recreate the visible TUI feel, not just the logic.

### Startup screen

Must display:

- Title: `CEO & Board - Strategic Decision-Making Agent Team`
- time range
- budget range
- editor mode
- board roster with model labels
- instruction: `Run /ceo-begin to start a deliberation.`

### Brief selector

Must show selectable brief IDs in a centered modal or full editor replacement.

### Active deliberation

Must show:

- CEO status
- board member status rows
- running cost
- context usage
- live progress text
- visible tool activity such as `write` and `end_deliberation`

### Closing phase

Must visibly show the constraint hit and final statements being collected.

### Footer

Must use a custom footer. The screenshots clearly show a bright cyan footer bar with:

- active mode or role name on the left
- running dollar cost on the right
- remaining or total context indicator on the right

## Same color identity

The board member colors are visible in the YAML screenshot and should be treated as exact:

- Revenue: `#ff7edb`
- Product Strategist: `#fede5d`
- Technical Architect: `#ff6e96`
- Contrarian: `#ff9e64`
- Compounder: `#72f1b8`
- Moonshot: `#7dcfff`

The rest of the palette is best effort from the screenshots:

- Footer / accent cyan: `#36f0f6`
- CEO magenta: `#ff4fd8`
- Deep background: `#0b0714`
- Warm panel purple: `#4a1e6a`

Use the provided `ceo-board-synthwave.json` theme file from this bundle as the starting point.

## Agent persona files

Create one markdown file per board member. Each should be concise and directive.

### Revenue

- Focus on ARR, margin, cash conversion, payback, pricing power, retention, monetization risk.

### Product Strategist

- Focus on product moat, roadmap leverage, differentiation, user value, market fit, portfolio logic.

### Technical Architect

- Focus on system quality, maintainability, technical debt, IP defensibility, team leverage, integration cost.

### Contrarian

- Attack assumptions.
- Identify hidden downside, weak evidence, timing risk, narrative traps, survivorship bias.

### Compounder

- Focus on long term value accumulation.
- Ask whether this decision improves or destroys future optionality.

### Moonshot

- Focus on upside asymmetry.
- Ask what bold move is being ignored and whether the board is underreaching.

## Brief format

Each brief should live at:

```text
.pi/ceo-agents/briefs/<brief-id>/brief.md
```

Each brief should contain at minimum:

```md
# Brief

## Situation
...

## Stakes
...

## Constraints
...

## Key Question
...
```

Support optional appendices or referenced files, but do not make them required for v1.

## Deliberation flow

Implement this exact sequence:

1. User runs `/ceo-begin`
2. Brief selector opens
3. User selects a brief
4. Extension creates session id
5. Extension writes or refreshes CEO scratch pad
6. CEO receives the brief and current constraints
7. CEO calls `converse` against one or more board members
8. Board members respond in parallel
9. CEO synthesizes and may call `converse` again
10. Constraint boundary is reached by time or budget
11. CEO calls `end_deliberation`
12. Final statements are gathered
13. Memo is written
14. Session artifact paths are shown

## Implementation notes mapped to Pi APIs

Use Pi extension capabilities that are documented and supported:

- `pi.registerCommand()` for `/ceo-begin`
- `pi.registerTool()` for `converse` and `end_deliberation`
- `ctx.ui.select()` or `ctx.ui.custom()` for the brief picker
- `ctx.ui.setFooter()` for the cyan footer
- `ctx.ui.setStatus()` for live member states
- `ctx.ui.setWorkingMessage()` for active thinking text
- `pi.sendMessage()` plus `pi.registerMessageRenderer()` for colored board updates
- `pi.appendEntry()` only for light extension state, not for the main transcript
- `spawn()` from `node:child_process` for subordinate Pi processes

## Board process model

Each board subprocess should run a normal Pi session, not an in process fake persona.

That is the entire point.

Each subprocess should:

- receive the board member persona file
- receive the relevant brief and current board context
- write back a plain text response
- keep its own session continuity across rounds for that deliberation
- optionally keep a longer lived role specific scratch pad across deliberations

## Recommended subprocess strategy

Use one of these two approaches:

### Preferred

Spawn `pi --mode rpc` subprocesses and speak JSONL over stdin/stdout.

Reason:
- clean machine readable framing
- lower parsing ambiguity
- easier event handling
- cleaner cost and state extraction

### Acceptable for v1

Spawn CLI Pi processes in ephemeral or named session mode and parse structured output.

Reason:
- simpler to stand up
- matches the spirit of the screenshots
- good enough for prototype parity

Do not build fake board members as plain functions inside the parent extension unless you are deliberately creating a temporary prototype.

## Suggested model policy

- CEO: Claude Opus 4.6
- Board members: Claude Sonnet 4.6
- Thinking level:
  - CEO: high
  - Board members: medium or high
- Active tools for board members:
  - read
  - bash only if truly needed
  - avoid write unless the role needs scratch pad output

## Files to create immediately

1. `apps/ceo/extensions/ceo-and-board.ts`
2. `.pi/ceo-agents/ceo-and-board-configuration.yaml`
3. `.pi/ceo-agents/agents/revenue.md`
4. `.pi/ceo-agents/agents/product-strategist.md`
5. `.pi/ceo-agents/agents/technical-architect.md`
6. `.pi/ceo-agents/agents/contrarian.md`
7. `.pi/ceo-agents/agents/compounder.md`
8. `.pi/ceo-agents/agents/moonshot.md`
9. `.pi/themes/ceo-board-synthwave.json`
10. `.pi/settings.json`
11. `.pi/ceo-agents/briefs/2026-03-18-acquisition-offer/brief.md`
12. `README.md`

## Minimum viable runbook

```bash
npm install -g @mariozechner/pi-coding-agent
export ANTHROPIC_API_KEY=sk-ant-...
cd apps/ceo
pi -e extensions/ceo-and-board.ts
/ceo-begin
```

If using Pi login based auth instead of API keys:

```bash
pi
/login
```

## Acceptance criteria

The implementation is not done until all of these are true:

- `pi -e extensions/ceo-and-board.ts` boots without runtime errors
- startup screen matches the screenshots structurally
- `/ceo-begin` opens a brief selector
- selecting a brief creates a deliberation directory with a session id
- CEO scratch pad file is written
- `converse` successfully fans out to multiple board members
- board member statuses update live in the TUI
- `end_deliberation` closes the session and writes `memo.md`
- the memo frontmatter includes brief path, transcript path, duration, cost, and board member list
- board colors match the extracted palette
- footer is cyan and custom rendered
- conversation transcript is persisted as JSONL

## Things that are visible but not fully recoverable from the screenshots

Treat these as implementation choices, not extracted facts:

- exact CEO scratch pad wording beyond the clearly readable lines
- exact prompt wording used between rounds
- exact internal memo schema after the visible header
- exact ANSI helper function values except the partially visible warm background helper
- exact import list from `ceo-and-board.ts`
- exact status token math in the footer

## Practical warning

The screenshots show a polished operator surface, but underneath it is just three things:

- one Pi extension
- multiple subprocess sessions
- disciplined file persistence

Do not overengineer it into a distributed systems dissertation.

Ship the extension first. Add fancier role packs later.
