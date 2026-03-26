import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { recoverRuns } from "../../apps/ceo/extensions/boardroom/recovery.js";
import { buildPersistedRun, createTempRepo } from "./helpers.js";

test("stale running run is auto-aborted", async () => {
	const tempRepo = await createTempRepo();
	try {
		const staleRun = buildPersistedRun({
			run_id: "brief-1-stale",
			status: "running",
			updated_at: "2026-03-26T08:00:00.000Z",
			paths: {
				brief: ".pi/ceo-agents/briefs/brief-1/brief.md",
				deliberation_dir: ".pi/ceo-agents/deliberations/brief-1-stale",
				transcript: ".pi/ceo-agents/deliberations/brief-1-stale/conversation.jsonl",
				state: ".pi/ceo-agents/deliberations/brief-1-stale/state.json",
				board_output_dir: ".pi/ceo-agents/deliberations/brief-1-stale/board",
				memo_dir: ".pi/ceo-agents/memos/brief-1-stale",
				scratch_pad: ".pi/ceo-agents/expertise/ceo-scratch-pad.md",
			},
		});

		await fsp.mkdir(path.join(tempRepo.repoRoot, ".pi/ceo-agents/deliberations/brief-1-stale"), { recursive: true });
		await fsp.writeFile(
			path.join(tempRepo.repoRoot, staleRun.paths.state),
			`${JSON.stringify(staleRun, null, 2)}\n`,
			"utf8",
		);

		await recoverRuns(tempRepo.repoRoot, tempRepo.config, 60_000);
		const repaired = JSON.parse(
			await fsp.readFile(path.join(tempRepo.repoRoot, staleRun.paths.state), "utf8"),
		) as typeof staleRun;

		assert.equal(repaired.status, "aborted");
		assert.equal(repaired.terminated_by, "boardroom_recovery");
		assert.equal(repaired.terminated_reason, "stale_run_auto_aborted");
	} finally {
		await tempRepo.cleanup();
	}
});

test("stale running run with newer closed sibling is superseded", async () => {
	const tempRepo = await createTempRepo();
	try {
		const staleRun = buildPersistedRun({
			run_id: "brief-1-stale",
			status: "running",
			updated_at: "2026-03-26T08:00:00.000Z",
			paths: {
				brief: ".pi/ceo-agents/briefs/brief-1/brief.md",
				deliberation_dir: ".pi/ceo-agents/deliberations/brief-1-stale",
				transcript: ".pi/ceo-agents/deliberations/brief-1-stale/conversation.jsonl",
				state: ".pi/ceo-agents/deliberations/brief-1-stale/state.json",
				board_output_dir: ".pi/ceo-agents/deliberations/brief-1-stale/board",
				memo_dir: ".pi/ceo-agents/memos/brief-1-stale",
				scratch_pad: ".pi/ceo-agents/expertise/ceo-scratch-pad.md",
			},
		});
		const closedRun = buildPersistedRun({
			run_id: "brief-1-closed",
			status: "closed",
			updated_at: "2026-03-26T08:20:00.000Z",
			closed_at: "2026-03-26T08:20:00.000Z",
			paths: {
				brief: ".pi/ceo-agents/briefs/brief-1/brief.md",
				deliberation_dir: ".pi/ceo-agents/deliberations/brief-1-closed",
				transcript: ".pi/ceo-agents/deliberations/brief-1-closed/conversation.jsonl",
				state: ".pi/ceo-agents/deliberations/brief-1-closed/state.json",
				board_output_dir: ".pi/ceo-agents/deliberations/brief-1-closed/board",
				memo_dir: ".pi/ceo-agents/memos/brief-1-closed",
				memo: ".pi/ceo-agents/memos/brief-1-closed/memo.md",
				scratch_pad: ".pi/ceo-agents/expertise/ceo-scratch-pad.md",
			},
		});

		for (const run of [staleRun, closedRun]) {
			await fsp.mkdir(path.join(tempRepo.repoRoot, run.paths.deliberation_dir), { recursive: true });
			await fsp.writeFile(path.join(tempRepo.repoRoot, run.paths.state), `${JSON.stringify(run, null, 2)}\n`, "utf8");
		}

		await recoverRuns(tempRepo.repoRoot, tempRepo.config, 60_000);
		const repaired = JSON.parse(
			await fsp.readFile(path.join(tempRepo.repoRoot, staleRun.paths.state), "utf8"),
		) as typeof staleRun;

		assert.equal(repaired.status, "superseded");
		assert.equal(repaired.terminated_reason, "stale_run_replaced_by_newer_closed_run");
	} finally {
		await tempRepo.cleanup();
	}
});
