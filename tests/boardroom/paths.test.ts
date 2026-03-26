import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { finalizeRun } from "../../apps/ceo/extensions/boardroom/finalize.js";
import { assertRelativeArtifactPath, resolveRepoPath, toRepoRelative } from "../../apps/ceo/extensions/boardroom/paths.js";
import { persistRunState } from "../../apps/ceo/extensions/boardroom/state.js";
import { buildFinalBoardMembers, createPreparedRun, createTempRepo } from "./helpers.js";

test("runtime path helpers round-trip relative artifact paths", () => {
	const repoRoot = "/repo/root";
	const relativePath = ".pi/ceo-agents/memos/run-1/memo.md";
	assert.equal(resolveRepoPath(repoRoot, relativePath), path.resolve(repoRoot, relativePath));
	assert.equal(toRepoRelative(repoRoot, path.resolve(repoRoot, relativePath)), relativePath);
	assert.throws(() => assertRelativeArtifactPath("/absolute/path"));
});

test("persisted state and memo artifacts do not leak absolute local paths", async () => {
	const tempRepo = await createTempRepo();
	try {
		const run = await createPreparedRun(tempRepo.repoRoot, tempRepo.config);
		await persistRunState(run);

		const firstMember = run.state.members.revenue;
		firstMember.cost_usd_micros = 188_047;
		const memoInput = await finalizeRun({
			runtime_run: run,
			final_board_members: buildFinalBoardMembers(),
			ceo_cost_usd_micros: 0,
			decision: "Commit to the highest-leverage path.",
			narrative: {
				rationale_markdown: "Ground the decision in the board evidence.",
				conditions_markdown: "Preserve explicit constraints.",
				next_moves_markdown: "Ship the next step.",
			},
		});

		const stateSource = await fsp.readFile(run.state_abs_path, "utf8");
		const memoSource = await fsp.readFile(path.join(tempRepo.repoRoot, memoInput.relative_paths.memo), "utf8");

		for (const artifactSource of [stateSource, memoSource]) {
			assert.equal(artifactSource.includes(tempRepo.repoRoot), false);
			assert.equal(/\/Users\/|\/home\/|[A-Za-z]:\\/.test(artifactSource), false);
		}

		assert.match(memoSource, /brief: ".pi\/ceo-agents\/briefs\/brief-1\/brief.md"/);
		assert.match(
			memoSource,
			/transcript: ".pi\/ceo-agents\/deliberations\/brief-1-run-1\/conversation.jsonl"/,
		);
		assert.match(memoSource, /memo: ".pi\/ceo-agents\/memos\/brief-1-run-1\/memo.md"/);
	} finally {
		await tempRepo.cleanup();
	}
});
