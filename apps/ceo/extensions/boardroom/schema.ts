export const ARTIFACT_VERSION = "1" as const;
export const STALE_RUN_WINDOW_MS = 10 * 60_000;

export const BOARD_MEMBER_DEFINITIONS = [
	{
		key: "revenue",
		display_name: "Revenue",
		color: "#ff7edb",
		default_prompt_path: ".pi/ceo-agents/agents/revenue.md",
	},
	{
		key: "product_strategist",
		display_name: "Product Strategist",
		color: "#fede5d",
		default_prompt_path: ".pi/ceo-agents/agents/product-strategist.md",
	},
	{
		key: "technical_architect",
		display_name: "Technical Architect",
		color: "#ff6e96",
		default_prompt_path: ".pi/ceo-agents/agents/technical-architect.md",
	},
	{
		key: "contrarian",
		display_name: "Contrarian",
		color: "#ff9e64",
		default_prompt_path: ".pi/ceo-agents/agents/contrarian.md",
	},
	{
		key: "compounder",
		display_name: "Compounder",
		color: "#72f1b8",
		default_prompt_path: ".pi/ceo-agents/agents/compounder.md",
	},
	{
		key: "moonshot",
		display_name: "Moonshot",
		color: "#7dcfff",
		default_prompt_path: ".pi/ceo-agents/agents/moonshot.md",
	},
] as const;

export type BoardMemberKey = (typeof BOARD_MEMBER_DEFINITIONS)[number]["key"];
export type BoardRoleName = (typeof BOARD_MEMBER_DEFINITIONS)[number]["display_name"];

export type RunStatus =
	| "initialized"
	| "running"
	| "closing"
	| "closed"
	| "aborted"
	| "failed"
	| "superseded";

export type TerminalRunStatus = Extract<RunStatus, "closed" | "aborted" | "failed" | "superseded">;
export type MemberRunStatus = "idle" | "running" | "responded" | "error";
export type VoteChoice = "accept" | "reject" | "defer" | "other";

export interface VoteSummary {
	accept: number;
	reject: number;
	defer: number;
	other: number;
}

export interface PersistedRunPaths {
	brief: string;
	deliberation_dir: string;
	transcript: string;
	state: string;
	board_output_dir: string;
	memo_dir: string;
	memo?: string;
	scratch_pad: string;
}

export interface PersistedMemberState {
	key: BoardMemberKey;
	display_name: BoardRoleName;
	status: MemberRunStatus;
	last_updated_at: string;
	cost_usd_micros: number;
	output_path: string;
	last_summary?: string;
	last_vote?: VoteChoice;
}

export interface PersistedRunState {
	artifact_version: typeof ARTIFACT_VERSION;
	run_id: string;
	brief_id: string;
	status: RunStatus;
	started_at: string;
	updated_at: string;
	closed_at?: string;
	elapsed_ms: number;
	cost_usd_micros: number;
	paths: PersistedRunPaths;
	members: Record<BoardMemberKey, PersistedMemberState>;
	active_member_keys: BoardMemberKey[];
	vote_summary?: VoteSummary;
	final_decision?: string;
	brief_content: string;
	last_subject?: string;
	last_prompt?: string;
	terminated_reason?: string;
	terminated_by?: string;
	recovery_note?: string;
}

export interface FinalBoardMemberMemo {
	key: BoardMemberKey;
	display_name: BoardRoleName;
	vote: VoteChoice;
	position_markdown: string;
}

export interface MemoNarrativeSections {
	rationale_markdown: string;
	conditions_markdown: string;
	next_moves_markdown: string;
}

export interface FinalMemoInput {
	artifact_version: typeof ARTIFACT_VERSION;
	run_id: string;
	brief_id: string;
	status: "closed";
	started_at: string;
	closed_at: string;
	elapsed_ms: number;
	cost_usd_micros: number;
	vote_summary: VoteSummary;
	relative_paths: {
		brief: string;
		transcript: string;
		memo: string;
	};
	board_members: FinalBoardMemberMemo[];
	decision: string;
	narrative: MemoNarrativeSections;
}

export interface BoardMemberConfig {
	name: BoardRoleName;
	path: string;
	color: string;
}

export interface MeetingConfig {
	meeting: {
		constraints: {
			min_time_minutes: number;
			max_time_minutes: number;
			min_budget: string | number;
			max_budget: string | number;
			editor?: string;
		};
	};
	brief_sections: Array<{ section: string; description: string }>;
	paths: {
		briefs: string;
		deliberations: string;
		memos: string;
		agents: string;
	};
	board: BoardMemberConfig[];
}

export interface RuntimeRun {
	state: PersistedRunState;
	repo_root_abs: string;
	brief_abs_path: string;
	transcript_abs_path: string;
	state_abs_path: string;
	deliberation_dir_abs: string;
	board_output_dir_abs: string;
	memo_dir_abs: string;
	memo_abs_path?: string;
	scratch_pad_abs_path: string;
	member_session_dirs_abs: Record<BoardMemberKey, string>;
}

export interface LegacyBoardMemberState {
	state?: string;
	lastUpdatedAt?: string;
	costUsd?: number;
	sessionDir?: string;
	outputPath?: string;
	lastSummary?: string;
}

export interface LegacyDeliberationState {
	status?: string;
	briefId?: string;
	briefPath?: string;
	sessionId?: string;
	startedAt?: string;
	updatedAt?: string;
	closedAt?: string;
	deliberationDir?: string;
	transcriptPath?: string;
	statePath?: string;
	boardOutputDir?: string;
	memoDir?: string;
	memoPath?: string;
	scratchPadPath?: string;
	briefContent?: string;
	costTotalUsd?: number;
	elapsedMs?: number;
	memberStates?: Record<string, LegacyBoardMemberState>;
	activeMembers?: string[];
	voteSummary?: VoteSummary;
	lastSubject?: string;
	lastPrompt?: string;
}

const boardMemberDefinitionByKey = new Map(
	BOARD_MEMBER_DEFINITIONS.map((definition) => [definition.key, definition]),
);
const boardMemberDefinitionByName = new Map(
	BOARD_MEMBER_DEFINITIONS.map((definition) => [definition.display_name, definition]),
);

export function getBoardMemberDefinition(key: BoardMemberKey) {
	const definition = boardMemberDefinitionByKey.get(key);
	if (!definition) throw new Error(`Unknown board member key: ${key}`);
	return definition;
}

export function boardMemberKeyFromDisplayName(name: string): BoardMemberKey | undefined {
	return boardMemberDefinitionByName.get(name as BoardRoleName)?.key;
}

export function boardMemberDefinitionFromDisplayName(name: string) {
	return boardMemberDefinitionByName.get(name as BoardRoleName);
}

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
	return status === "closed" || status === "aborted" || status === "failed" || status === "superseded";
}

export function normalizeLegacyRunStatus(status: string | undefined): RunStatus {
	switch (status) {
		case "initialized":
		case "running":
		case "closing":
		case "closed":
		case "aborted":
		case "failed":
		case "superseded":
			return status;
		case "idle":
			return "initialized";
		case "active":
			return "running";
		default:
			return "initialized";
	}
}

export function normalizeLegacyMemberStatus(status: string | undefined): MemberRunStatus {
	switch ((status ?? "").toLowerCase()) {
		case "responded":
			return "responded";
		case "error":
			return "error";
		case "running":
			return "running";
		case "idle":
		case "ready":
			return "idle";
		default:
			return "idle";
	}
}

export function emptyVoteSummary(): VoteSummary {
	return { accept: 0, reject: 0, defer: 0, other: 0 };
}
