# boardroom
Boardroom is a Pi-based multi-agent decision system that runs CEO and specialist board deliberations from structured briefs, then produces ranked recommendations, tradeoffs, and final memos.

## Runtime

The working extension lives at `apps/ceo/extensions/ceo-and-board.ts`. Project-local Pi settings in `.pi/settings.json` load that extension plus the bundled synthwave theme.

Typical flow:

```bash
npm install
pi -e apps/ceo/extensions/ceo-and-board.ts
```

Inside Pi, run `/ceo-begin` and pick a brief from `.pi/ceo-agents/briefs/`.

## Layout

- `apps/ceo/extensions/ceo-and-board.ts`: control plane, tools, TUI, persistence
- `.pi/ceo-agents/agents/*.md`: board role personas
- `.pi/ceo-agents/briefs/<brief-id>/brief.md`: decision briefs
- `.pi/ceo-agents/deliberations/<brief-id>-<session-id>/`: transcripts and per-run state
- `.pi/ceo-agents/memos/<brief-id>-<session-id>/memo.md`: final memo artifact

## Validation

- `npm run check`: TypeScript typecheck
- `npm run build`: compile the extension sources to `dist/`
