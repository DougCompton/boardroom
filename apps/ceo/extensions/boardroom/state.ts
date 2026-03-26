import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { elapsedMsFromIso, formatDurationFromMs, formatUsdFromMicros, usdToMicros } from "./accounting.js";
import {
	ARTIFACT_VERSION,
	BOARD_MEMBER_DEFINITIONS,
	type BoardMemberKey,
	type BoardRoleName,
	type LegacyDeliberationState,
	type MeetingConfig,
	type PersistedMemberState,
	type PersistedRunPaths,
	type PersistedRunState,
	type RuntimeRun,
	boardMemberKeyFromDisplayName,
	emptyVoteSummary,
	normalizeLegacyMemberStatus,
	normalizeLegacyRunStatus,
} from "./schema.js";
import { normalizeArtifactPath, resolveRepoPath, toRepoRelative } from "./paths.js";

export interface AtomicWriteHooks {
	before_rename?: () => Promise<void> | void;
}

export async function ensureDir(dirPath: string): Promise<void> {
	await fsp.mkdir(dirPath, { recursive: true });
}

export async function ensureFile(filePath: string, content = ""): Promise<void> {
	try {
		await fsp.access(filePath, fs.constants.F_OK);
	} catch {
		await ensureDir(path.dirname(filePath));
		await fsp.writeFile(filePath, content, "utf8");
	}
}

export async function appendJsonl(filePath: string, payload: Record<string, unknown>): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await fsp.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function writeTextArtifactAtomic(
	filePath: string,
	content: string,
	hooks?: AtomicWriteHooks,
): Promise<void> {
	await ensureDir(path.dirname(filePath));
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	const handle = await fsp.open(tempPath, "w");
	try {
		await handle.writeFile(content, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}

	if (hooks?.before_rename) {
		await hooks.before_rename();
	}

	await fsp.rename(tempPath, filePath);
	await syncDirectory(path.dirname(filePath));
}

export async function writeJsonArtifactAtomic(
	filePath: string,
	payload: unknown,
	hooks?: AtomicWriteHooks,
): Promise<void> {
	await writeTextArtifactAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`, hooks);
}

export function buildRunPaths(config: MeetingConfig, runId: string): PersistedRunPaths {
	const deliberationDir = joinArtifactPath(config.paths.deliberations, runId);
	const memoDir = joinArtifactPath(config.paths.memos, runId);
	return {
		brief: "",
		deliberation_dir: deliberationDir,
		transcript: joinArtifactPath(deliberationDir, "conversation.jsonl"),
		state: joinArtifactPath(deliberationDir, "state.json"),
		board_output_dir: joinArtifactPath(deliberationDir, "board"),
		memo_dir: memoDir,
		scratch_pad: ".pi/ceo-agents/expertise/ceo-scratch-pad.md",
	};
}

export function createRuntimeRun(params: {
	repo_root_abs: string;
	config: MeetingConfig;
	brief_id: string;
	brief_rel_path: string;
	brief_content: string;
	run_id: string;
	member_session_root_rel: string;
	now?: string;
}): RuntimeRun {
	const now = params.now ?? new Date().toISOString();
	const paths = buildRunPaths(params.config, params.run_id);
	paths.brief = normalizeArtifactPath(params.brief_rel_path);
	const members = Object.fromEntries(
		BOARD_MEMBER_DEFINITIONS.map((definition) => [
			definition.key,
			{
				key: definition.key,
				display_name: definition.display_name,
				status: "idle",
				last_updated_at: now,
				cost_usd_micros: 0,
				output_path: joinArtifactPath(paths.board_output_dir, `${safeFileName(definition.display_name)}.md`),
			} satisfies PersistedMemberState,
		]),
	) as Record<BoardMemberKey, PersistedMemberState>;

	const state: PersistedRunState = {
		artifact_version: ARTIFACT_VERSION,
		run_id: params.run_id,
		brief_id: params.brief_id,
		status: "initialized",
		started_at: now,
		updated_at: now,
		elapsed_ms: 0,
		cost_usd_micros: 0,
		paths,
		members,
		active_member_keys: BOARD_MEMBER_DEFINITIONS.map((definition) => definition.key),
		vote_summary: emptyVoteSummary(),
		brief_content: params.brief_content,
	};

	return materializeRuntimeRun(params.repo_root_abs, state, params.member_session_root_rel);
}

export function materializeRuntimeRun(
	repoRootAbs: string,
	state: PersistedRunState,
	memberSessionRootRel = ".pi/ceo-agents/sessions",
): RuntimeRun {
	const memberSessionDirsAbs = Object.fromEntries(
		BOARD_MEMBER_DEFINITIONS.map((definition) => [
			definition.key,
			resolveRepoPath(repoRootAbs, joinArtifactPath(memberSessionRootRel, safeFileName(definition.display_name))),
		]),
	) as Record<BoardMemberKey, string>;

	return {
		state,
		repo_root_abs: repoRootAbs,
		brief_abs_path: resolveRepoPath(repoRootAbs, state.paths.brief),
		transcript_abs_path: resolveRepoPath(repoRootAbs, state.paths.transcript),
		state_abs_path: resolveRepoPath(repoRootAbs, state.paths.state),
		deliberation_dir_abs: resolveRepoPath(repoRootAbs, state.paths.deliberation_dir),
		board_output_dir_abs: resolveRepoPath(repoRootAbs, state.paths.board_output_dir),
		memo_dir_abs: resolveRepoPath(repoRootAbs, state.paths.memo_dir),
		scratch_pad_abs_path: resolveRepoPath(repoRootAbs, state.paths.scratch_pad),
		member_session_dirs_abs: memberSessionDirsAbs,
		...(state.paths.memo ? { memo_abs_path: resolveRepoPath(repoRootAbs, state.paths.memo) } : {}),
	};
}

export function touchRunState(state: PersistedRunState, updatedAt = new Date().toISOString()): void {
	state.updated_at = updatedAt;
	if (state.closed_at) {
		state.elapsed_ms = elapsedMsFromIso(state.started_at, state.closed_at);
	} else {
		state.elapsed_ms = Math.max(0, Date.parse(updatedAt) - Date.parse(state.started_at));
	}
}

export async function persistRunState(runtimeRun: RuntimeRun, updatedAt?: string): Promise<void> {
	touchRunState(runtimeRun.state, updatedAt ?? new Date().toISOString());
	await writeJsonArtifactAtomic(runtimeRun.state_abs_path, runtimeRun.state);
}

export async function loadRunStateFromArtifactPath(
	repoRootAbs: string,
	statePath: string,
	memberSessionRootRel = ".pi/ceo-agents/sessions",
): Promise<RuntimeRun | undefined> {
	const resolvedPath = path.isAbsolute(statePath) ? statePath : resolveRepoPath(repoRootAbs, statePath);
	try {
		const source = await fsp.readFile(resolvedPath, "utf8");
		const parsed = JSON.parse(source) as PersistedRunState | LegacyDeliberationState;
		const state = normalizePersistedRunState(repoRootAbs, parsed);
		return materializeRuntimeRun(repoRootAbs, state, memberSessionRootRel);
	} catch {
		return undefined;
	}
}

export function normalizePersistedRunState(
	repoRootAbs: string,
	input: PersistedRunState | LegacyDeliberationState,
): PersistedRunState {
	if (isPersistedRunState(input)) {
		return sanitizePersistedRunState(repoRootAbs, input);
	}
	return migrateLegacyRunState(repoRootAbs, input);
}

export function summarizeRun(runtimeRun: RuntimeRun): string[] {
	const memoPath = runtimeRun.state.paths.memo ?? "pending";
	return [
		`Run: ${runtimeRun.state.run_id}`,
		`Status: ${runtimeRun.state.status}`,
		`Duration: ${formatDurationFromMs(runtimeRun.state.elapsed_ms)}`,
		`Cost: ${formatUsdFromMicros(runtimeRun.state.cost_usd_micros)}`,
		`Memo: ${memoPath}`,
	];
}

function isPersistedRunState(input: PersistedRunState | LegacyDeliberationState): input is PersistedRunState {
	return (
		"artifact_version" in input &&
		typeof input.artifact_version === "string" &&
		"run_id" in input &&
		typeof input.run_id === "string" &&
		"paths" in input &&
		typeof input.paths === "object" &&
		input.paths !== null
	);
}

function sanitizePersistedRunState(repoRootAbs: string, input: PersistedRunState): PersistedRunState {
	const sanitizedPaths = sanitizeRunPaths(repoRootAbs, input.paths);
	const sanitizedMembers = Object.fromEntries(
		Object.entries(input.members).map(([memberKey, member]) => {
			assertBoardMemberKey(memberKey);
			return [
				memberKey,
				{
					key: memberKey,
					display_name: member.display_name,
					status: member.status,
					last_updated_at: member.last_updated_at,
					cost_usd_micros: member.cost_usd_micros,
					output_path: toRepoRelative(repoRootAbs, member.output_path),
					...(member.last_summary ? { last_summary: member.last_summary } : {}),
					...(member.last_vote ? { last_vote: member.last_vote } : {}),
				} satisfies PersistedMemberState,
			];
		}),
	) as Record<BoardMemberKey, PersistedMemberState>;

	const sanitized: PersistedRunState = {
		...input,
		artifact_version: ARTIFACT_VERSION,
		status: normalizeLegacyRunStatus(input.status),
		paths: sanitizedPaths,
		members: sanitizedMembers,
		active_member_keys: input.active_member_keys.filter((key): key is BoardMemberKey => hasBoardMemberKey(key)),
		vote_summary: input.vote_summary ?? emptyVoteSummary(),
	};
	if (!input.closed_at) delete sanitized.closed_at;
	if (!input.final_decision) delete sanitized.final_decision;
	if (!input.last_subject) delete sanitized.last_subject;
	if (!input.last_prompt) delete sanitized.last_prompt;
	if (!input.terminated_reason) delete sanitized.terminated_reason;
	if (!input.terminated_by) delete sanitized.terminated_by;
	if (!input.recovery_note) delete sanitized.recovery_note;
	return sanitized;
}

function migrateLegacyRunState(repoRootAbs: string, legacy: LegacyDeliberationState): PersistedRunState {
	const briefId = legacy.briefId ?? "unknown-brief";
	const runId = legacy.sessionId ? `${briefId}-${legacy.sessionId}` : briefId;
	const rawPaths: PersistedRunPaths = {
		brief: legacy.briefPath ?? ".pi/ceo-agents/briefs/unknown/brief.md",
		deliberation_dir: legacy.deliberationDir ?? path.dirname(legacy.statePath ?? ".pi/ceo-agents/deliberations"),
		transcript: legacy.transcriptPath ?? ".pi/ceo-agents/deliberations/unknown/conversation.jsonl",
		state: legacy.statePath ?? ".pi/ceo-agents/deliberations/unknown/state.json",
		board_output_dir: legacy.boardOutputDir ?? ".pi/ceo-agents/deliberations/unknown/board",
		memo_dir: legacy.memoDir ?? ".pi/ceo-agents/memos/unknown",
		scratch_pad: legacy.scratchPadPath ?? ".pi/ceo-agents/expertise/ceo-scratch-pad.md",
	};
	if (legacy.memoPath) rawPaths.memo = legacy.memoPath;

	const members = Object.fromEntries(
		BOARD_MEMBER_DEFINITIONS.map((definition) => {
			const legacyMember = legacy.memberStates?.[definition.display_name];
			return [
				definition.key,
				{
					key: definition.key,
					display_name: definition.display_name,
					status: normalizeLegacyMemberStatus(legacyMember?.state),
					last_updated_at: legacyMember?.lastUpdatedAt ?? legacy.updatedAt ?? legacy.startedAt ?? new Date().toISOString(),
					cost_usd_micros: usdToMicros(legacyMember?.costUsd ?? 0),
					output_path: toRepoRelative(
						repoRootAbs,
						legacyMember?.outputPath ??
							path.join(rawPaths.board_output_dir, `${safeFileName(definition.display_name)}.md`),
					),
					...(legacyMember?.lastSummary ? { last_summary: legacyMember.lastSummary } : {}),
				} satisfies PersistedMemberState,
			];
		}),
	) as Record<BoardMemberKey, PersistedMemberState>;

	const migrated: PersistedRunState = {
		artifact_version: ARTIFACT_VERSION,
		run_id: runId,
		brief_id: briefId,
		status: normalizeLegacyRunStatus(legacy.status),
		started_at: legacy.startedAt ?? new Date().toISOString(),
		updated_at: legacy.updatedAt ?? legacy.startedAt ?? new Date().toISOString(),
		elapsed_ms:
			typeof legacy.elapsedMs === "number" && Number.isFinite(legacy.elapsedMs)
				? Math.max(0, Math.round(legacy.elapsedMs))
				: legacy.closedAt && legacy.startedAt
					? elapsedMsFromIso(legacy.startedAt, legacy.closedAt)
					: 0,
		cost_usd_micros: usdToMicros(legacy.costTotalUsd ?? 0),
		paths: sanitizeRunPaths(repoRootAbs, rawPaths),
		members,
		active_member_keys:
			legacy.activeMembers
				?.map((name) => boardMemberKeyFromDisplayName(name))
				.filter((key): key is BoardMemberKey => Boolean(key)) ??
			BOARD_MEMBER_DEFINITIONS.map((definition) => definition.key),
		vote_summary: legacy.voteSummary ?? emptyVoteSummary(),
		brief_content: legacy.briefContent ?? "",
	};
	if (legacy.closedAt) migrated.closed_at = legacy.closedAt;
	if (legacy.lastSubject) migrated.last_subject = legacy.lastSubject;
	if (legacy.lastPrompt) migrated.last_prompt = legacy.lastPrompt;
	return migrated;
}

function sanitizeRunPaths(repoRootAbs: string, input: PersistedRunPaths): PersistedRunPaths {
	const sanitized: PersistedRunPaths = {
		brief: toRepoRelative(repoRootAbs, input.brief),
		deliberation_dir: toRepoRelative(repoRootAbs, input.deliberation_dir),
		transcript: toRepoRelative(repoRootAbs, input.transcript),
		state: toRepoRelative(repoRootAbs, input.state),
		board_output_dir: toRepoRelative(repoRootAbs, input.board_output_dir),
		memo_dir: toRepoRelative(repoRootAbs, input.memo_dir),
		scratch_pad: toRepoRelative(repoRootAbs, input.scratch_pad),
	};
	if (input.memo) sanitized.memo = toRepoRelative(repoRootAbs, input.memo);
	return sanitized;
}

function joinArtifactPath(base: string, segment: string): string {
	return normalizeArtifactPath(path.posix.join(base, segment));
}

function assertBoardMemberKey(value: string): asserts value is BoardMemberKey {
	if (!hasBoardMemberKey(value)) throw new Error(`Unknown board member key: ${value}`);
}

function hasBoardMemberKey(value: string): value is BoardMemberKey {
	return BOARD_MEMBER_DEFINITIONS.some((definition) => definition.key === value);
}

function safeFileName(name: BoardRoleName): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "member";
}

async function syncDirectory(dirPath: string): Promise<void> {
	try {
		const handle = await fsp.open(dirPath, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {
		// Directory fsync is best-effort across platforms.
	}
}
