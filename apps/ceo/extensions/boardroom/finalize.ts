import * as fs from "node:fs";
import * as path from "node:path";
import { elapsedMsFromIso, sumMicros } from "./accounting.js";
import { renderMemo } from "./memo.js";
import type { FinalBoardMemberMemo, FinalMemoInput, MemoNarrativeSections, RuntimeRun, VoteChoice } from "./schema.js";
import { isTerminalRunStatus } from "./schema.js";
import { persistRunState, writeTextArtifactAtomic } from "./state.js";

export interface FinalizeRunParams {
	runtime_run: RuntimeRun;
	final_board_members: FinalBoardMemberMemo[];
	ceo_cost_usd_micros: number;
	decision: string;
	narrative: MemoNarrativeSections;
}

export async function finalizeRun(params: FinalizeRunParams): Promise<FinalMemoInput> {
	const { runtime_run: runtimeRun } = params;
	if (isTerminalRunStatus(runtimeRun.state.status)) {
		throw new Error(`Run ${runtimeRun.state.run_id} is already terminal: ${runtimeRun.state.status}`);
	}

	const memoRelPath = path.posix.join(runtimeRun.state.paths.memo_dir, "memo.md");
	runtimeRun.state.paths.memo = memoRelPath;
	runtimeRun.memo_abs_path = path.join(runtimeRun.repo_root_abs, memoRelPath);
	runtimeRun.state.cost_usd_micros =
		sumMicros(Object.values(runtimeRun.state.members).map((member) => member.cost_usd_micros)) +
		params.ceo_cost_usd_micros;
	runtimeRun.state.vote_summary = buildVoteSummary(params.final_board_members.map((member) => member.vote));
	runtimeRun.state.final_decision = params.decision.trim();
	runtimeRun.state.status = "closing";
	delete runtimeRun.state.closed_at;
	await persistRunState(runtimeRun);

	const closedAt = new Date().toISOString();
	const elapsedMs = elapsedMsFromIso(runtimeRun.state.started_at, closedAt);

	const memoInput: FinalMemoInput = {
		artifact_version: runtimeRun.state.artifact_version,
		run_id: runtimeRun.state.run_id,
		brief_id: runtimeRun.state.brief_id,
		status: "closed",
		started_at: runtimeRun.state.started_at,
		closed_at: closedAt,
		elapsed_ms: elapsedMs,
		cost_usd_micros: runtimeRun.state.cost_usd_micros,
		vote_summary: runtimeRun.state.vote_summary,
		relative_paths: {
			brief: runtimeRun.state.paths.brief,
			transcript: runtimeRun.state.paths.transcript,
			memo: memoRelPath,
		},
		board_members: params.final_board_members,
		decision: params.decision.trim(),
		narrative: params.narrative,
	};

	const memoMarkdown = renderMemo(memoInput);
	if (!runtimeRun.memo_abs_path) throw new Error(`Run ${runtimeRun.state.run_id} is missing a memo path`);
	await writeTextArtifactAtomic(runtimeRun.memo_abs_path, memoMarkdown);
	if (!fs.existsSync(runtimeRun.memo_abs_path)) {
		throw new Error(`Run ${runtimeRun.state.run_id} cannot close before memo exists`);
	}

	runtimeRun.state.status = "closed";
	runtimeRun.state.closed_at = closedAt;
	runtimeRun.state.elapsed_ms = elapsedMs;
	await persistRunState(runtimeRun, closedAt);
	return memoInput;
}

function buildVoteSummary(votes: VoteChoice[]) {
	return votes.reduce(
		(summary, vote) => {
			summary[vote] += 1;
			return summary;
		},
		{ accept: 0, reject: 0, defer: 0, other: 0 },
	);
}
