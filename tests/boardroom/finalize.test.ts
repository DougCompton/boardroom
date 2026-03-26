import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { finalizeRun } from "../../apps/ceo/extensions/boardroom/finalize.js";
import { createPreparedRun, createTempRepo, buildFinalBoardMembers } from "./helpers.js";

test("run finalization writes memo before closed state and cannot run twice", async () => {
	const tempRepo = await createTempRepo();
	try {
		const run = await createPreparedRun(tempRepo.repoRoot, tempRepo.config);
		run.state.members.revenue.cost_usd_micros = 80_000;
		run.state.members.product_strategist.cost_usd_micros = 50_000;
		run.state.members.technical_architect.cost_usd_micros = 40_000;

		const memoInput = await finalizeRun({
			runtime_run: run,
			final_board_members: buildFinalBoardMembers(),
			ceo_cost_usd_micros: 18_047,
			decision: "Commit to the path.",
			narrative: {
				rationale_markdown: "The board converged.",
				conditions_markdown: "Keep the constraints explicit.",
				next_moves_markdown: "Act on the decision.",
			},
		});

		const memoPath = path.join(tempRepo.repoRoot, memoInput.relative_paths.memo);
		const state = JSON.parse(await fsp.readFile(run.state_abs_path, "utf8")) as typeof run.state;
		assert.equal(state.status, "closed");
		assert.equal(await fsp.stat(memoPath).then(() => true), true);
		assert.equal(state.paths.memo, memoInput.relative_paths.memo);

		await assert.rejects(() =>
			finalizeRun({
				runtime_run: run,
				final_board_members: buildFinalBoardMembers(),
				ceo_cost_usd_micros: 0,
				decision: "Second close should fail.",
				narrative: {
					rationale_markdown: "No-op.",
					conditions_markdown: "No-op.",
					next_moves_markdown: "No-op.",
				},
			}),
		);
	} finally {
		await tempRepo.cleanup();
	}
});
