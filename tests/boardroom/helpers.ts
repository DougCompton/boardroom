import * as os from "node:os";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import {
	BOARD_MEMBER_DEFINITIONS,
	type FinalBoardMemberMemo,
	type MeetingConfig,
	type PersistedRunState,
	type VoteChoice,
} from "../../apps/ceo/extensions/boardroom/schema.js";
import { createRuntimeRun, ensureDir } from "../../apps/ceo/extensions/boardroom/state.js";

export async function createTempRepo() {
	const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "boardroom-hardening-"));
	const config = createTestConfig();

	await Promise.all(
		[
			".pi/ceo-agents/agents",
			".pi/ceo-agents/briefs/brief-1",
			".pi/ceo-agents/deliberations",
			".pi/ceo-agents/memos",
			".pi/ceo-agents/expertise",
			".pi/ceo-agents/sessions",
		].map((dirPath) => ensureDir(path.join(repoRoot, dirPath))),
	);

	await Promise.all(
		BOARD_MEMBER_DEFINITIONS.map((definition) =>
			fsp.writeFile(path.join(repoRoot, definition.default_prompt_path), `# ${definition.display_name}\n`, "utf8"),
		),
	);
	await fsp.writeFile(
		path.join(repoRoot, ".pi/ceo-agents/briefs/brief-1/brief.md"),
		"# Brief\n\n## Key Question\nWhat now?\n",
		"utf8",
	);

	return {
		repoRoot,
		config,
		async cleanup() {
			await fsp.rm(repoRoot, { recursive: true, force: true });
		},
	};
}

export function createTestConfig(): MeetingConfig {
	return {
		meeting: {
			constraints: {
				min_time_minutes: 2,
				max_time_minutes: 5,
				min_budget: "$1",
				max_budget: "$5",
				editor: "code",
			},
		},
		brief_sections: [],
		paths: {
			briefs: ".pi/ceo-agents/briefs/",
			deliberations: ".pi/ceo-agents/deliberations/",
			memos: ".pi/ceo-agents/memos/",
			agents: ".pi/ceo-agents/agents/",
		},
		board: BOARD_MEMBER_DEFINITIONS.map((definition) => ({
			name: definition.display_name,
			path: definition.default_prompt_path,
			color: definition.color,
		})),
	};
}

export async function createPreparedRun(repoRoot: string, config: MeetingConfig, runId = "brief-1-run-1") {
	const run = createRuntimeRun({
		repo_root_abs: repoRoot,
		config,
		brief_id: "brief-1",
		brief_rel_path: ".pi/ceo-agents/briefs/brief-1/brief.md",
		brief_content: "# Brief\n\n## Key Question\nWhat now?\n",
		run_id: runId,
		member_session_root_rel: ".pi/ceo-agents/sessions",
		now: "2026-03-26T08:54:03.029Z",
	});

	await Promise.all([
		ensureDir(run.deliberation_dir_abs),
		ensureDir(run.board_output_dir_abs),
		ensureDir(run.memo_dir_abs),
		ensureDir(path.dirname(run.state_abs_path)),
		ensureDir(path.dirname(run.scratch_pad_abs_path)),
		ensureDir(path.join(repoRoot, ".pi/ceo-agents/sessions/ceo")),
		...Object.values(run.member_session_dirs_abs).map((dirPath) => ensureDir(dirPath)),
	]);

	return run;
}

export function buildFinalBoardMembers(): FinalBoardMemberMemo[] {
	const votes: VoteChoice[] = ["accept", "accept", "accept", "defer", "accept", "accept"];
	return BOARD_MEMBER_DEFINITIONS.map((definition, index) => ({
		key: definition.key,
		display_name: definition.display_name,
		vote: votes[index] ?? "other",
		position_markdown: `Vote: ${capitalize(votes[index] ?? "other")}\n\nPosition from ${definition.display_name}.`,
	}));
}

export function buildPersistedRun(overrides: Partial<PersistedRunState> = {}): PersistedRunState {
	const base: PersistedRunState = {
		artifact_version: "1",
		run_id: "brief-1-run-1",
		brief_id: "brief-1",
		status: "running",
		started_at: "2026-03-26T08:00:00.000Z",
		updated_at: "2026-03-26T08:05:00.000Z",
		elapsed_ms: 300_000,
		cost_usd_micros: 0,
		paths: {
			brief: ".pi/ceo-agents/briefs/brief-1/brief.md",
			deliberation_dir: ".pi/ceo-agents/deliberations/brief-1-run-1",
			transcript: ".pi/ceo-agents/deliberations/brief-1-run-1/conversation.jsonl",
			state: ".pi/ceo-agents/deliberations/brief-1-run-1/state.json",
			board_output_dir: ".pi/ceo-agents/deliberations/brief-1-run-1/board",
			memo_dir: ".pi/ceo-agents/memos/brief-1-run-1",
			scratch_pad: ".pi/ceo-agents/expertise/ceo-scratch-pad.md",
		},
		members: Object.fromEntries(
			BOARD_MEMBER_DEFINITIONS.map((definition) => [
				definition.key,
				{
					key: definition.key,
					display_name: definition.display_name,
					status: "idle",
					last_updated_at: "2026-03-26T08:05:00.000Z",
					cost_usd_micros: 0,
					output_path: `.pi/ceo-agents/deliberations/brief-1-run-1/board/${definition.key}.md`,
				},
			]),
		) as PersistedRunState["members"],
		active_member_keys: BOARD_MEMBER_DEFINITIONS.map((definition) => definition.key),
		vote_summary: { accept: 0, reject: 0, defer: 0, other: 0 },
		brief_content: "# Brief\n",
	};

	return mergeRun(base, overrides);
}

function mergeRun(base: PersistedRunState, overrides: Partial<PersistedRunState>): PersistedRunState {
	return {
		...base,
		...overrides,
		paths: {
			...base.paths,
			...(overrides.paths ?? {}),
		},
		members: {
			...base.members,
			...(overrides.members ?? {}),
		},
	};
}

function capitalize(value: string): string {
	return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}
