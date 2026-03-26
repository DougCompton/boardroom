import test from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createTempRepo } from "./helpers.js";
import { createRuntimeRun } from "../../apps/ceo/extensions/boardroom/state.js";
import type { MeetingConfig } from "../../apps/ceo/extensions/boardroom/schema.js";

function buildStartPromptForTest(run: ReturnType<typeof createRuntimeRun>, config: MeetingConfig): string {
	return [
		"You are the CEO of a six-member strategic board. Start the deliberation.",
		"",
		"Constraints:",
		`- Time: ${config.meeting.constraints.min_time_minutes}-${config.meeting.constraints.max_time_minutes} minutes`,
		`- Budget: ${config.meeting.constraints.min_budget}-${config.meeting.constraints.max_budget}`,
		`- Editor: ${config.meeting.constraints.editor ?? "code"}`,
		"",
		"Board members:",
		"- Revenue",
		"- Product Strategist",
		"- Technical Architect",
		"- Contrarian",
		"- Compounder",
		"- Moonshot",
		"",
		`Brief ID: ${run.state.brief_id}`,
		`Brief artifact path: ${run.state.paths.brief}`,
		"",
		"Canonical brief content:",
		run.state.brief_content.trim(),
		"",
		"Do not reconstruct or guess brief file paths. Use the canonical brief content above as the source of truth.",
		"",
		"Process rules:",
		"- Use converse to consult the board in bounded rounds.",
		"- Synthesize after every board round.",
		"- When time or budget is exhausted, call end_deliberation.",
		"- The user only sees the CEO output. Be decisive and explicit.",
	].join("\n");
}

test("start prompt anchors CEO kickoff to canonical brief artifact and embedded content", async () => {
	const { repoRoot, config, cleanup } = await createTempRepo();
	const briefAbs = path.join(repoRoot, ".pi/ceo-agents/briefs/brief-1/brief.md");
	const briefContent = await fsp.readFile(briefAbs, "utf8");
	const run = createRuntimeRun({
		repo_root_abs: repoRoot,
		config,
		brief_id: "brief-1",
		brief_rel_path: ".pi/ceo-agents/briefs/brief-1/brief.md",
		brief_content: briefContent,
		run_id: "brief-1-abc123",
		member_session_root_rel: ".pi/ceo-agents/sessions",
	});

	const prompt = buildStartPromptForTest(run, config);

	assert.match(prompt, /Brief artifact path: \.pi\/ceo-agents\/briefs\/brief-1\/brief\.md/);
	assert.match(prompt, /Canonical brief content:/);
	assert.match(prompt, /# Brief/);
	assert.doesNotMatch(prompt, /briefs\/brief-1\.md/);
	assert.match(prompt, /Do not reconstruct or guess brief file paths\./);

	await cleanup();
});
