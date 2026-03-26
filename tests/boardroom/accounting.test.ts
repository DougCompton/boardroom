import test from "node:test";
import assert from "node:assert/strict";
import { formatUsdFromMicros, sumMicros, usdToMicros } from "../../apps/ceo/extensions/boardroom/accounting.js";
import { renderMemo } from "../../apps/ceo/extensions/boardroom/memo.js";
import { buildFinalBoardMembers } from "./helpers.js";

test("canonical cost storage uses integer micro-usd without float drift", () => {
	assert.equal(usdToMicros(0.1) + usdToMicros(0.2), 300_000);
	assert.equal(sumMicros([15_718, 16_089, 16_006, 8_083, 15_298, 8_700, 108_153]), 188_047);
	assert.equal(formatUsdFromMicros(188_047), "$0.19");
});

test("all rendered cost surfaces derive from the same canonical micro-usd value", () => {
	const memo = renderMemo({
		artifact_version: "1",
		run_id: "brief-1-run-1",
		brief_id: "brief-1",
		status: "closed",
		started_at: "2026-03-26T08:54:03.029Z",
		closed_at: "2026-03-26T08:57:02.640Z",
		elapsed_ms: 179_611,
		cost_usd_micros: 188_047,
		vote_summary: { accept: 5, reject: 0, defer: 1, other: 0 },
		relative_paths: {
			brief: ".pi/ceo-agents/briefs/brief-1/brief.md",
			transcript: ".pi/ceo-agents/deliberations/brief-1-run-1/conversation.jsonl",
			memo: ".pi/ceo-agents/memos/brief-1-run-1/memo.md",
		},
		board_members: buildFinalBoardMembers(),
		decision: "Commit to the path.",
		narrative: {
			rationale_markdown: "The board converged.",
			conditions_markdown: "Keep the constraints explicit.",
			next_moves_markdown: "Act on the decision.",
		},
	});

	assert.match(memo, /budget_used: "\$0\.19"/);
	assert.match(memo, /- Deliberation Cost: \$0\.19/);
});
