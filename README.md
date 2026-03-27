# boardroom
Boardroom is an opinionated Pi workflow for executive deliberation. It runs CEO and specialist board sessions from structured briefs, then produces ranked recommendations, tradeoffs, and final decision memos.

In the broader stack, Pi is the substrate, Pai is the front door, and Boardroom is a reusable workflow pack that runs inside Pi.

## Runtime

The working extension lives at `apps/ceo/extensions/ceo-and-board.ts`. Project-local Pi settings in `.pi/settings.json` load that extension plus the bundled synthwave theme.

Typical interactive flow:

```bash
npm install
pi -e apps/ceo/extensions/ceo-and-board.ts
```

Kickoff options:

- Interactive slash command: `/ceo-begin`
- Deterministic text trigger: `ceo-begin <brief-id>`

Examples:

```bash
# open the TUI, then trigger a specific brief
pi -e apps/ceo/extensions/ceo-and-board.ts
ceo-begin 2026-03-18-engineering-path

# or use the slash command in the interactive session
/ceo-begin
```

The deterministic text trigger exists on purpose so Boardroom is operable by both humans and agents without depending on fragile slash-command UI parsing.

## Operability

Boardroom is designed to be:

- human-operable through the interactive Pi interface
- agent-operable through deterministic text input and persisted relative-path artifacts

This matters because real users will hand Boardroom to LLMs. Trigger surfaces, artifact paths, and closeout behavior need to be machine-friendly, not just visually usable in the TUI.

## Layout

- `apps/ceo/extensions/ceo-and-board.ts`: control plane, tools, TUI, persistence
- `.pi/ceo-agents/agents/*.md`: board role personas
- `.pi/ceo-agents/briefs/<brief-id>/brief.md`: decision briefs
- `.pi/ceo-agents/deliberations/<brief-id>-<session-id>/`: transcripts and per-run state
- `.pi/ceo-agents/memos/<brief-id>-<session-id>/memo.md`: final memo artifact

## Validation

- `npm run check`: TypeScript typecheck
- `npm run build`: compile the extension sources to `dist/`
- `npm test`: hardening and startup regression suite

Recent live proof points:

- fresh end-to-end run completed with board outputs plus memo
- deterministic kickoff path validated in practice
- persisted artifacts remained relative-path based
