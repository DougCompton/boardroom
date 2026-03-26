import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { elapsedMsFromIso } from "./accounting.js";
import { resolveRepoPath } from "./paths.js";
import { STALE_RUN_WINDOW_MS, type MeetingConfig, type PersistedRunState } from "./schema.js";
import { isTerminalRunStatus } from "./schema.js";
import { loadRunStateFromArtifactPath, persistRunState } from "./state.js";

export interface RecoveryResult {
	repaired_run_ids: string[];
	open_run_ids: string[];
}

export async function recoverRuns(
	repoRootAbs: string,
	config: MeetingConfig,
	staleWindowMs = STALE_RUN_WINDOW_MS,
): Promise<RecoveryResult> {
	const deliberationsDirAbs = resolveRepoPath(repoRootAbs, config.paths.deliberations);
	const entries = await fsp.readdir(deliberationsDirAbs, { withFileTypes: true }).catch(() => []);
	const runtimeRuns = (
		await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map((entry) =>
					loadRunStateFromArtifactPath(
						repoRootAbs,
						path.join(deliberationsDirAbs, entry.name, "state.json"),
					),
				),
		)
	).filter((run): run is NonNullable<typeof run> => Boolean(run));

	const closedByBrief = new Map<string, PersistedRunState>();
	for (const runtimeRun of runtimeRuns) {
		if (runtimeRun.state.status !== "closed") continue;
		const previous = closedByBrief.get(runtimeRun.state.brief_id);
		if (!previous || Date.parse(runtimeRun.state.closed_at ?? runtimeRun.state.updated_at) > Date.parse(previous.closed_at ?? previous.updated_at)) {
			closedByBrief.set(runtimeRun.state.brief_id, runtimeRun.state);
		}
	}

	const repairedRunIds: string[] = [];
	const openRunIds: string[] = [];
	const now = Date.now();

	for (const runtimeRun of runtimeRuns) {
		const { state } = runtimeRun;
		if (isTerminalRunStatus(state.status)) {
			continue;
		}

		const updatedAtMs = Date.parse(state.updated_at);
		const isStale = Number.isFinite(updatedAtMs) ? now - updatedAtMs >= staleWindowMs : true;
		if (!isStale) {
			openRunIds.push(state.run_id);
			continue;
		}

		const newerClosedRun = closedByBrief.get(state.brief_id);
		if (
			newerClosedRun &&
			Date.parse(newerClosedRun.closed_at ?? newerClosedRun.updated_at) >= Date.parse(state.updated_at)
		) {
			state.status = "superseded";
			state.terminated_reason = "stale_run_replaced_by_newer_closed_run";
		} else {
			state.status = "aborted";
			state.terminated_reason = "stale_run_auto_aborted";
		}
		state.terminated_by = "boardroom_recovery";
		state.recovery_note = "Auto-closed stale active run during startup recovery.";
		state.closed_at = state.updated_at;
		state.elapsed_ms = elapsedMsFromIso(state.started_at, state.closed_at);
		await persistRunState(runtimeRun, state.closed_at);
		repairedRunIds.push(state.run_id);
	}

	return {
		repaired_run_ids: repairedRunIds,
		open_run_ids: openRunIds,
	};
}

export async function supersedeOpenRunsForBrief(
	repoRootAbs: string,
	config: MeetingConfig,
	briefId: string,
	replacementRunId: string,
): Promise<string[]> {
	const deliberationsDirAbs = resolveRepoPath(repoRootAbs, config.paths.deliberations);
	const entries = await fsp.readdir(deliberationsDirAbs, { withFileTypes: true }).catch(() => []);
	const repairedRunIds: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const runtimeRun = await loadRunStateFromArtifactPath(
			repoRootAbs,
			path.join(deliberationsDirAbs, entry.name, "state.json"),
		);
		if (!runtimeRun) continue;
		if (runtimeRun.state.brief_id !== briefId) continue;
		if (runtimeRun.state.run_id === replacementRunId) continue;
		if (isTerminalRunStatus(runtimeRun.state.status)) continue;

		runtimeRun.state.status = "superseded";
		runtimeRun.state.terminated_reason = "superseded_by_new_run";
		runtimeRun.state.terminated_by = replacementRunId;
		runtimeRun.state.recovery_note = "Superseded by a newer run for the same brief.";
		runtimeRun.state.closed_at = new Date().toISOString();
		runtimeRun.state.elapsed_ms = elapsedMsFromIso(runtimeRun.state.started_at, runtimeRun.state.closed_at);
		await persistRunState(runtimeRun, runtimeRun.state.closed_at);
		repairedRunIds.push(runtimeRun.state.run_id);
	}

	return repairedRunIds;
}
