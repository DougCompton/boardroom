import test from "node:test";
import assert from "node:assert/strict";
import { renderMemo } from "../../apps/ceo/extensions/boardroom/memo.js";
import { buildFinalBoardMembers } from "./helpers.js";

test("memo frontmatter and body render identical duration strings from elapsed_ms only", () => {
	const memo = renderMemo({
		artifact_version: "1",
		run_id: "brief-1-run-1",
		brief_id: "brief-1",
		status: "closed",
		started_at: "2026-03-26T08:00:00.000Z",
		closed_at: "2026-03-26T08:00:01.000Z",
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

	assert.match(memo, /duration: "3\.0 minutes"/);
	assert.match(memo, /- Duration: 3\.0 minutes/);
	assert.equal(memo.includes("0.0 minutes"), false);
});
