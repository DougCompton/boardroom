import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import YAML from "yaml";
import {
	formatDurationFromMs,
	formatUsdFromMicros,
	microsToUsd,
	parseBudget,
	sumMicros,
	usdToMicros,
} from "./boardroom/accounting.js";
import { finalizeRun } from "./boardroom/finalize.js";
import {
	containsMachineLocalPath,
	resolveRepoPath,
	toRepoRelative,
	validateConfig,
} from "./boardroom/paths.js";
import { recoverRuns, supersedeOpenRunsForBrief } from "./boardroom/recovery.js";
import {
	BOARD_MEMBER_DEFINITIONS,
	type BoardMemberConfig,
	type BoardMemberKey,
	type BoardRoleName,
	type FinalBoardMemberMemo,
	type MeetingConfig,
	type RunStatus,
	type RuntimeRun,
	boardMemberDefinitionFromDisplayName,
	getBoardMemberDefinition,
	isTerminalRunStatus,
} from "./boardroom/schema.js";
import {
	appendJsonl,
	createRuntimeRun,
	ensureDir,
	ensureFile,
	loadRunStateFromArtifactPath,
	persistRunState,
	touchRunState,
	writeTextArtifactAtomic,
} from "./boardroom/state.js";

const EXTENSION_TITLE = "CEO & Board - Strategic Decision-Making Agent Team";
const CONFIG_PATH = ".pi/ceo-agents/ceo-and-board-configuration.yaml";
const STATE_ENTRY_TYPE = "ceo-board-session";
const UPDATE_MESSAGE_TYPE = "ceo-board-update";
const FOOTER_BG = "#36f0f6";
const FOOTER_FG = "#0b0714";
const CEO_COLOR = "#ff4fd8";
const PANEL_DIM = "#b69ed1";
const PANEL_TEXT = "#f6efff";
const PANEL_MUTED = "#9a8ab8";
const PANEL_BORDER = "#36f0f6";
const DEFAULT_EDITOR = "code";
const WORKER_TOOLS = "read,grep,find,ls";
const SESSION_ROOT_REL = ".pi/ceo-agents/sessions";

interface BriefOption {
	id: string;
	absolute_path: string;
	relative_path: string;
}

interface RuntimeState {
	config: MeetingConfig | undefined;
	meeting: RuntimeRun | undefined;
}

interface WorkerPromptResult {
	member_key: BoardMemberKey | "ceo";
	display_name: BoardRoleName | "CEO";
	status: "ok" | "error";
	content: string;
	cost_usd_micros: number;
	session_id: string | undefined;
	elapsed_ms: number;
	error: string | undefined;
}

interface ConverseDetails {
	responses: WorkerPromptResult[];
	cost_delta_usd_micros: number;
	elapsed_ms: number;
	constraint_hit: boolean;
}

interface EndDeliberationDetails {
	status: "closed";
	memo_path: string;
	cost_total_usd_micros: number;
	final_positions: FinalBoardMemberMemo[];
}

type RpcResponse = {
	type: "response";
	command: string;
	success: boolean;
	id?: string;
	data?: unknown;
	error?: string;
};

type RpcAgentEndEvent = {
	type: "agent_end";
	messages?: Array<{
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
	}>;
};

const MODELS = {
	ceo: {
		provider: "anthropic",
		id: "claude-opus-4-6",
		label: "anthropic/claude-opus-4-6 1M",
	},
	board: {
		provider: "anthropic",
		id: "claude-sonnet-4-6",
		label: "anthropic/claude-sonnet-4-6 1M",
	},
} as const;

const runtime: RuntimeState = {
	config: undefined,
	meeting: undefined,
};

const ConverseParams = Type.Object({
	to: Type.Array(Type.String({ description: "Board member name" }), {
		description: "Board members to consult",
	}),
	subject: Type.String({ description: "Short round label" }),
	prompt: Type.String({ description: "Prompt to send to the board members" }),
	mode: Type.Optional(
		Type.Union([Type.Literal("parallel"), Type.Literal("sequential")], {
			description: "Dispatch mode",
		}),
	),
});

const EndDeliberationParams = Type.Object({
	closing_prompt: Type.String({
		description: "Closing instruction sent to each board member for their final position",
	}),
	decision_format: Type.String({
		description: "How the final memo should be structured",
	}),
});

function colorHex(hex: string, text: string): string {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) return text;
	const red = Number.parseInt(normalized.slice(0, 2), 16);
	const green = Number.parseInt(normalized.slice(2, 4), 16);
	const blue = Number.parseInt(normalized.slice(4, 6), 16);
	return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[0m`;
}

function backgroundHex(hex: string, text: string): string {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) return text;
	const red = Number.parseInt(normalized.slice(0, 2), 16);
	const green = Number.parseInt(normalized.slice(2, 4), 16);
	const blue = Number.parseInt(normalized.slice(4, 6), 16);
	return `\u001b[48;2;${red};${green};${blue}m${text}\u001b[0m`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function shortRunToken(): string {
	return Math.random().toString(36).slice(2, 8);
}

function formatFloatUsd(value: number): string {
	return `$${value.toFixed(2)}`;
}

function safeFileName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "member";
}

function lastTextBlock(messages: RpcAgentEndEvent["messages"]): string {
	if (!messages) return "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant" || !message.content) continue;
		const parts = message.content.filter((part) => part.type === "text" && typeof part.text === "string");
		if (parts.length === 0) continue;
		return parts.map((part) => part.text ?? "").join("\n").trim();
	}
	return "";
}

function summarizeText(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= 120) return collapsed;
	return `${collapsed.slice(0, 117)}...`;
}

function latestAssistantCost(ctx: ExtensionContext): number {
	const branch = ctx.sessionManager.getBranch() as Array<any>;
	let total = 0;
	for (const entry of branch) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "assistant") continue;
		const cost = message?.usage?.cost?.total;
		if (typeof cost === "number") total += cost;
	}
	return total;
}

function defaultConfig(): MeetingConfig {
	return {
		meeting: {
			constraints: {
				min_time_minutes: 2,
				max_time_minutes: 5,
				min_budget: "$1",
				max_budget: "$5",
				editor: DEFAULT_EDITOR,
			},
		},
		brief_sections: [
			{
				section: "## Situation",
				description: "What is happening right now? State the facts. No opinion, no spin.",
			},
			{
				section: "## Stakes",
				description: "What's at risk? Upside if we get it right, downside if we get it wrong.",
			},
			{
				section: "## Constraints",
				description: "Budget, timeline, team capacity, technical debt, regulatory, contractual boundaries.",
			},
			{
				section: "## Key Question",
				description: "The single most important question you want the board to answer. Be specific.",
			},
		],
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

async function readConfig(cwd: string): Promise<MeetingConfig> {
	const absolutePath = path.resolve(cwd, CONFIG_PATH);
	let config = defaultConfig();
	try {
		const source = await fsp.readFile(absolutePath, "utf8");
		const parsed = YAML.parse(source) as MeetingConfig | null;
		if (parsed?.meeting?.constraints && parsed.paths && Array.isArray(parsed.board)) {
			config = parsed;
		}
	} catch {
		config = defaultConfig();
	}

	validateConfig(cwd, config);
	return config;
}

async function listBriefs(cwd: string, config: MeetingConfig): Promise<BriefOption[]> {
	const briefsDirAbs = resolveRepoPath(cwd, config.paths.briefs);
	const entries = await fsp.readdir(briefsDirAbs, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const absolutePath = path.join(briefsDirAbs, entry.name, "brief.md");
			return {
				id: entry.name,
				absolute_path: absolutePath,
				relative_path: toRepoRelative(cwd, absolutePath),
			};
		})
		.filter((brief) => fs.existsSync(brief.absolute_path))
		.sort((left, right) => right.id.localeCompare(left.id));
}

function boardLookup(config: MeetingConfig): Map<string, BoardMemberConfig> {
	return new Map(config.board.map((member) => [member.name, member]));
}

function getMemberConfig(config: MeetingConfig, memberKey: BoardMemberKey): BoardMemberConfig {
	const displayName = getBoardMemberDefinition(memberKey).display_name;
	const boardMember = config.board.find((member) => member.name === displayName);
	if (!boardMember) throw new Error(`Missing config for board member ${displayName}`);
	return boardMember;
}

function getMemberState(run: RuntimeRun, memberKey: BoardMemberKey) {
	return run.state.members[memberKey];
}

function refreshRunTotals(run: RuntimeRun, updatedAt = nowIso()): void {
	run.state.cost_usd_micros = sumMicros(Object.values(run.state.members).map((member) => member.cost_usd_micros));
	touchRunState(run.state, updatedAt);
}

async function recordUpdate(
	run: RuntimeRun,
	type: string,
	payload: Record<string, unknown>,
): Promise<void> {
	const serialized = JSON.stringify(payload);
	if (containsMachineLocalPath(serialized)) {
		throw new Error(`Transcript payload for ${type} contains machine-local data`);
	}
	await appendJsonl(run.transcript_abs_path, {
		timestamp: nowIso(),
		type,
		run_id: run.state.run_id,
		brief_id: run.state.brief_id,
		...payload,
	});
}

async function writeBoardOutput(
	run: RuntimeRun,
	memberKey: BoardMemberKey,
	subject: string,
	prompt: string,
	result: WorkerPromptResult,
): Promise<void> {
	const memberState = getMemberState(run, memberKey);
	const body = [
		`# ${memberState.display_name}`,
		"",
		`- Status: ${result.status}`,
		`- Subject: ${subject}`,
		`- Latest Response Cost: ${formatUsdFromMicros(result.cost_usd_micros)}`,
		`- Member Cost To Date: ${formatUsdFromMicros(memberState.cost_usd_micros)}`,
		`- Updated: ${nowIso()}`,
		"",
		"## Prompt",
		prompt.trim(),
		"",
		"## Response",
		result.content.trim() || "_No response captured._",
		"",
	].join("\n");
	const outputAbsPath = resolveRepoPath(run.repo_root_abs, memberState.output_path);
	await writeTextArtifactAtomic(outputAbsPath, `${body}\n`);
}

async function writeScratchPad(run: RuntimeRun, config: MeetingConfig): Promise<void> {
	const budgetMin = parseBudget(config.meeting.constraints.min_budget);
	const budgetMax = parseBudget(config.meeting.constraints.max_budget);
	const lines = [
		"# CEO Scratch Pad",
		"",
		`- Brief: ${run.state.brief_id}`,
		`- Run: ${run.state.run_id}`,
		`- Status: ${run.state.status}`,
		`- Started: ${run.state.started_at}`,
		`- Updated: ${run.state.updated_at}`,
		`- Duration: ${formatDurationFromMs(run.state.elapsed_ms)}`,
		`- Budget Range: ${formatFloatUsd(budgetMin)} - ${formatFloatUsd(budgetMax)}`,
		`- Budget Used: ${formatUsdFromMicros(run.state.cost_usd_micros)}`,
		"",
		"## Active Members",
		...run.state.active_member_keys.map((memberKey) => {
			const memberState = run.state.members[memberKey];
			const summary = memberState.last_summary ? ` | ${memberState.last_summary}` : "";
			return `- ${memberState.display_name}: ${memberState.status}${summary}`;
		}),
		"",
		"## Artifacts",
		`- Brief: ${run.state.paths.brief}`,
		`- Transcript: ${run.state.paths.transcript}`,
		`- State: ${run.state.paths.state}`,
		`- Memo: ${run.state.paths.memo ?? "pending"}`,
		"",
		"## Brief",
		run.state.brief_content.trim(),
		"",
	];
	await writeTextArtifactAtomic(run.scratch_pad_abs_path, lines.join("\n"));
}

function statusKey(memberName: string): string {
	return `board:${safeFileName(memberName)}`;
}

function setMemberUiStatus(ctx: ExtensionContext, member: BoardMemberConfig, state: string): void {
	ctx.ui.setStatus(statusKey(member.name), `${colorHex(member.color, member.name)} ${state}`);
}

function uiStateLabel(status: RunStatus): string {
	switch (status) {
		case "initialized":
			return "Initialized";
		case "running":
			return "Running";
		case "closing":
			return "Closing";
		case "closed":
			return "Closed";
		case "aborted":
			return "Aborted";
		case "failed":
			return "Failed";
		case "superseded":
			return "Superseded";
	}
}

function memberUiLabel(status: string): string {
	switch (status) {
		case "idle":
			return "Ready";
		case "running":
			return "Working";
		case "responded":
			return "Responded";
		case "error":
			return "Error";
		default:
			return status;
	}
}

function updateWidget(ctx: ExtensionContext, config: MeetingConfig, run?: RuntimeRun): void {
	const editor = config.meeting.constraints.editor ?? DEFAULT_EDITOR;
	const lines: string[] = [];
	lines.push(colorHex(PANEL_BORDER, EXTENSION_TITLE));
	lines.push(
		`${colorHex(PANEL_DIM, "Time")}: ${config.meeting.constraints.min_time_minutes}-${config.meeting.constraints.max_time_minutes} min   ` +
			`${colorHex(PANEL_DIM, "Budget")}: ${config.meeting.constraints.min_budget}-${config.meeting.constraints.max_budget}   ` +
			`${colorHex(PANEL_DIM, "Editor")}: ${editor}`,
	);
	lines.push("");
	lines.push(colorHex(PANEL_DIM, "Board"));
	lines.push(`${colorHex(CEO_COLOR, "CEO")}  ${MODELS.ceo.label}`);
	for (const member of config.board) {
		const definition = boardMemberDefinitionFromDisplayName(member.name);
		const state = definition && run ? run.state.members[definition.key]?.status : undefined;
		lines.push(
			`${colorHex(member.color, member.name)}  ${MODELS.board.label}  ${colorHex(PANEL_MUTED, memberUiLabel(state ?? "idle"))}`,
		);
	}
	lines.push("");
	if (!run) {
		lines.push(colorHex(PANEL_TEXT, "Run /ceo-begin to start a deliberation."));
	} else {
		lines.push(`${colorHex(PANEL_DIM, "Brief")}: ${run.state.brief_id}`);
		lines.push(`${colorHex(PANEL_DIM, "Run")}: ${run.state.run_id}`);
		lines.push(`${colorHex(PANEL_DIM, "Status")}: ${run.state.status}`);
		lines.push(`${colorHex(PANEL_DIM, "Cost")}: ${formatUsdFromMicros(run.state.cost_usd_micros)}`);
		lines.push(`${colorHex(PANEL_DIM, "Elapsed")}: ${formatDurationFromMs(run.state.elapsed_ms)}`);
		lines.push(`${colorHex(PANEL_DIM, "Transcript")}: ${run.state.paths.transcript}`);
	}
	ctx.ui.setWidget("ceo-board-panel", lines, { placement: "aboveEditor" });
}

function installFooter(ctx: ExtensionContext): void {
	ctx.ui.setFooter((_tui, _theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => {});
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				const run = runtime.meeting;
				const role = run ? `CEO • ${run.state.status.toUpperCase()}` : "CEO & BOARD";
				const contextUsage = ctx.getContextUsage();
				const contextText =
					contextUsage?.percent != null
						? `ctx ${contextUsage.percent.toFixed(0)}%`
						: contextUsage?.tokens != null
							? `ctx ${contextUsage.tokens}`
							: "ctx --";
				const totalCost = latestAssistantCost(ctx) + microsToUsd(run?.state.cost_usd_micros ?? 0);
				const right = `${formatFloatUsd(totalCost)}  ${contextText}`;
				const pad = " ".repeat(Math.max(1, width - visibleWidth(role) - visibleWidth(right)));
				const content = truncateToWidth(`${role}${pad}${right}`, width);
				return [backgroundHex(FOOTER_BG, colorHex(FOOTER_FG, content))];
			},
		};
	});
}

function buildStartPrompt(briefId: string, briefContent: string, config: MeetingConfig): string {
	return [
		`You are the CEO of a six-member strategic board. Start the deliberation for brief ${briefId}.`,
		"",
		"Constraints:",
		`- Time: ${config.meeting.constraints.min_time_minutes}-${config.meeting.constraints.max_time_minutes} minutes`,
		`- Budget: ${config.meeting.constraints.min_budget}-${config.meeting.constraints.max_budget}`,
		`- Editor: ${config.meeting.constraints.editor ?? DEFAULT_EDITOR}`,
		"",
		"Board members:",
		...BOARD_MEMBER_DEFINITIONS.map((definition) => `- ${definition.display_name}`),
		"",
		"Brief:",
		briefContent.trim(),
		"",
		"Process rules:",
		"- Use converse to consult the board in bounded rounds.",
		"- Synthesize after every board round.",
		"- When time or budget is exhausted, call end_deliberation.",
		"- The user only sees the CEO output. Be decisive and explicit.",
	].join("\n");
}

function findModel(registry: ExtensionContext["modelRegistry"], provider: string, id: string): any | undefined {
	const exact = registry.find(provider, id);
	if (exact) return exact;
	return registry.getAll().find((model) => model.provider === provider && String(model.id).includes(id));
}

function getPiInvocation(): { command: string; argsPrefix: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, argsPrefix: [currentScript] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\\.exe)?$/.test(execName)) {
		return { command: process.execPath, argsPrefix: [] };
	}
	return { command: "pi", argsPrefix: [] };
}

async function runPiWorkerPrompt(options: {
	cwd: string;
	sessionDir: string;
	memberKey: BoardMemberKey | "ceo";
	displayName: BoardRoleName | "CEO";
	modelId: string;
	provider: string;
	systemPrompt: string;
	prompt: string;
	onProgress?: (message: string) => void;
}): Promise<WorkerPromptResult> {
	const startedAt = Date.now();
	await ensureDir(options.sessionDir);
	const { command, argsPrefix } = getPiInvocation();
	const args = [
		...argsPrefix,
		"--mode",
		"rpc",
		"--session-dir",
		options.sessionDir,
		"--model",
		`${options.provider}/${options.modelId}`,
		"--append-system-prompt",
		options.systemPrompt,
		"--tools",
		WORKER_TOOLS,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
	];

	return await new Promise<WorkerPromptResult>((resolve) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stderr = "";
		let promptAccepted = false;
		let agentEnded = false;
		let lastAgentEnd: RpcAgentEndEvent | undefined;
		let sessionStats: any;
		let workerText = "";
		let sessionId: string | undefined;
		let settled = false;

		const settle = (result: WorkerPromptResult) => {
			if (settled) return;
			settled = true;
			if (!child.killed) child.kill();
			resolve(result);
		};

		const send = (payload: Record<string, unknown>) => {
			if (child.stdin.destroyed) return;
			child.stdin.write(`${JSON.stringify(payload)}\n`);
		};

		const maybeFinish = () => {
			if (!promptAccepted || !agentEnded || !sessionStats) return;
			settle({
				member_key: options.memberKey,
				display_name: options.displayName,
				status: "ok",
				content: workerText.trim() || lastTextBlock(lastAgentEnd?.messages),
				cost_usd_micros: usdToMicros(typeof sessionStats.cost === "number" ? sessionStats.cost : 0),
				session_id: sessionId,
				elapsed_ms: Date.now() - startedAt,
				error: undefined,
			});
		};

		const stdout = readline.createInterface({ input: child.stdout });
		stdout.on("line", (line) => {
			let payload: RpcResponse | RpcAgentEndEvent | Record<string, unknown>;
			try {
				payload = JSON.parse(line) as RpcResponse | RpcAgentEndEvent | Record<string, unknown>;
			} catch {
				return;
			}

			if (payload.type === "response") {
				if (!payload.success) {
					settle({
						member_key: options.memberKey,
						display_name: options.displayName,
						status: "error",
						content: "",
						cost_usd_micros: 0,
						session_id: undefined,
						elapsed_ms: Date.now() - startedAt,
						error: typeof payload.error === "string" ? payload.error : `Pi ${options.displayName} worker failed`,
					});
					return;
				}

				if (payload.command === "prompt") {
					promptAccepted = true;
					options.onProgress?.(`${options.displayName}: prompt accepted`);
					return;
				}

				if (payload.command === "get_last_assistant_text") {
					const data = (payload.data ?? {}) as { text?: string | null };
					workerText = data.text ?? "";
					send({ id: "stats", type: "get_session_stats" });
					return;
				}

				if (payload.command === "get_session_stats") {
					sessionStats = payload.data ?? {};
					sessionId = typeof sessionStats.sessionId === "string" ? sessionStats.sessionId : undefined;
					maybeFinish();
				}
				return;
			}

			if (payload.type === "agent_end") {
				agentEnded = true;
				lastAgentEnd = payload as RpcAgentEndEvent;
				if (!workerText) {
					workerText = lastTextBlock(lastAgentEnd.messages);
				}
				options.onProgress?.(`${options.displayName}: response ready`);
				send({ id: "last", type: "get_last_assistant_text" });
			}
		});

		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});

		child.on("error", (error) => {
			settle({
				member_key: options.memberKey,
				display_name: options.displayName,
				status: "error",
				content: "",
				cost_usd_micros: 0,
				session_id: undefined,
				elapsed_ms: Date.now() - startedAt,
				error: error.message,
			});
		});

		child.on("close", (code) => {
			if (!settled) {
				settle({
					member_key: options.memberKey,
					display_name: options.displayName,
					status: code === 0 && workerText ? "ok" : "error",
					content: workerText.trim(),
					cost_usd_micros: usdToMicros(typeof sessionStats?.cost === "number" ? sessionStats.cost : 0),
					session_id: sessionId,
					elapsed_ms: Date.now() - startedAt,
					error: code === 0 ? undefined : stderr.trim() || `Pi exited with code ${code ?? -1}`,
				});
			}
		});

		send({ id: "prompt", type: "prompt", message: options.prompt });
	});
}

function constraintReached(config: MeetingConfig, run: RuntimeRun): boolean {
	const maxBudgetMicros = usdToMicros(parseBudget(config.meeting.constraints.max_budget));
	const maxTimeMs = config.meeting.constraints.max_time_minutes * 60_000;
	return run.state.cost_usd_micros >= maxBudgetMicros || run.state.elapsed_ms >= maxTimeMs;
}

function closingInstruction(prompt: string): string {
	return [
		prompt.trim(),
		"",
		"Return exactly one final position statement.",
		"Include a line starting with Vote: Accept, Reject, or Defer.",
		"Keep it direct and grounded in your board role.",
	].join("\n");
}

function boardInstruction(member: BoardMemberConfig): string {
	return [
		`You are ${member.name}, a board member in a CEO deliberation.`,
		"Stay inside your role and answer directly.",
		"Use markdown with concise headings.",
		"Do not narrate your process. Deliver a recommendation the CEO can quote.",
	].join("\n");
}

function buildBoardPrompt(run: RuntimeRun, member: BoardMemberConfig, subject: string, prompt: string): string {
	return [
		`Subject: ${subject}`,
		"",
		prompt.trim(),
		"",
		"Brief:",
		run.state.brief_content.trim(),
		"",
		"Session context:",
		`- Brief ID: ${run.state.brief_id}`,
		`- Run ID: ${run.state.run_id}`,
		`- Running cost: ${formatUsdFromMicros(run.state.cost_usd_micros)}`,
		"",
		"Respond from your board role only.",
		`Your role is ${member.name}.`,
	].join("\n");
}

function buildMemoSynthesisPrompt(
	run: RuntimeRun,
	finalPositions: FinalBoardMemberMemo[],
	decisionFormat: string,
): string {
	const finalPositionBundle = finalPositions
		.map((member) => `## ${member.display_name}\nVote: ${member.vote}\n\n${member.position_markdown.trim()}`)
		.join("\n\n");

	return [
		"You are the CEO closing a strategic board meeting.",
		"Produce only the requested XML-like blocks and nothing else.",
		"Do not include cost, duration, absolute paths, cwd references, or YAML frontmatter.",
		"",
		`Decision format guidance: ${decisionFormat}`,
		`Brief ID: ${run.state.brief_id}`,
		`Run ID: ${run.state.run_id}`,
		"",
		"Brief:",
		run.state.brief_content.trim(),
		"",
		"Final board positions:",
		finalPositionBundle,
		"",
		"Return exactly these blocks:",
		"<decision>One decisive markdown block.</decision>",
		"<rationale>Markdown explaining why.</rationale>",
		"<conditions>Markdown with risks and conditions.</conditions>",
		"<next_moves>Markdown with immediate next moves.</next_moves>",
	].join("\n");
}

function compileResponses(results: WorkerPromptResult[], constraintHit: boolean): string {
	const responseText = results
		.map((result) => `### ${result.display_name}\n${result.content.trim() || result.error || "_No response_"}`)
		.join("\n\n");
	const warning = constraintHit ? "\n\nConstraint boundary reached. Call end_deliberation now." : "";
	return `Board responses collected:\n\n${responseText}${warning}`.trim();
}

function parseVoteChoice(content: string): "accept" | "reject" | "defer" | "other" {
	const normalized = content.toLowerCase();
	if (/\bvote:\s*accept\b|\baccept\b/.test(normalized)) return "accept";
	if (/\bvote:\s*reject\b|\breject\b/.test(normalized)) return "reject";
	if (/\bvote:\s*defer\b|\bdefer\b/.test(normalized)) return "defer";
	return "other";
}

function parseMemoSections(content: string): {
	decision: string;
	rationale_markdown: string;
	conditions_markdown: string;
	next_moves_markdown: string;
} {
	const capture = (tag: string, fallback: string): string => {
		const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(content);
		return match?.[1]?.trim() || fallback;
	};

	return {
		decision: capture("decision", "Decision synthesis unavailable."),
		rationale_markdown: capture("rationale", "Rationale synthesis unavailable."),
		conditions_markdown: capture("conditions", "No explicit conditions captured."),
		next_moves_markdown: capture("next_moves", "No immediate next moves captured."),
	};
}

async function restoreStateFromBranch(ctx: ExtensionContext): Promise<RuntimeRun | undefined> {
	const branch = ctx.sessionManager.getBranch() as Array<any>;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		const statePath = entry?.data?.statePath;
		if (typeof statePath !== "string") continue;
		const restored = await loadRunStateFromArtifactPath(ctx.cwd, statePath, SESSION_ROOT_REL);
		if (restored) return restored;
	}
	return undefined;
}

async function initialize(ctx: ExtensionContext): Promise<void> {
	try {
		runtime.config = await readConfig(ctx.cwd);
		const recovery = await recoverRuns(ctx.cwd, runtime.config);
		runtime.meeting = await restoreStateFromBranch(ctx);
		if (runtime.meeting) refreshRunTotals(runtime.meeting);
		ctx.ui.setTitle("CEO & Board");
		installFooter(ctx);
		updateWidget(ctx, runtime.config, runtime.meeting);
		if (recovery.repaired_run_ids.length > 0) {
			ctx.ui.notify(`Recovered ${recovery.repaired_run_ids.length} stale board run(s).`, "info");
		}
	} catch (error) {
		runtime.config = undefined;
		runtime.meeting = undefined;
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

async function markRunFailed(
	run: RuntimeRun | undefined,
	config: MeetingConfig | undefined,
	ctx: ExtensionContext,
	reason: string,
): Promise<void> {
	if (!run || isTerminalRunStatus(run.state.status)) return;
	run.state.status = "failed";
	run.state.terminated_reason = reason;
	run.state.terminated_by = "ceo_and_board";
	run.state.closed_at = nowIso();
	refreshRunTotals(run, run.state.closed_at);
	await persistRunState(run, run.state.closed_at);
	if (config) {
		await writeScratchPad(run, config);
		updateWidget(ctx, config, run);
	}
}

export default function ceoBoardExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(UPDATE_MESSAGE_TYPE, (message, _options, _theme) => {
		const details = (message.details ?? {}) as { label?: string; color?: string };
		const label = details.label ?? "Board";
		const color = details.color ?? PANEL_BORDER;
		return new Text(`${colorHex(color, `[${label}]`)} ${message.content}`, 0, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		await initialize(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await initialize(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await initialize(ctx);
	});

	pi.registerCommand("ceo-begin", {
		description: "Start a CEO board deliberation",
		handler: async (rawArgs, ctx) => {
			let config: MeetingConfig | undefined;
			try {
				config = runtime.config = await readConfig(ctx.cwd);
				await recoverRuns(ctx.cwd, config);
				const briefs = await listBriefs(ctx.cwd, config);
				if (briefs.length === 0) {
					ctx.ui.notify("No briefs found under .pi/ceo-agents/briefs", "error");
					return;
				}

				const requestedId = rawArgs.trim();
				const selectedId =
					requestedId ||
					(await ctx.ui.select(
						"Pick a brief",
						briefs.map((brief) => brief.id),
					));
				if (!selectedId) return;

				const selectedBrief = briefs.find((brief) => brief.id === selectedId);
				if (!selectedBrief) {
					ctx.ui.notify(`Unknown brief: ${selectedId}`, "error");
					return;
				}

				const runId = `${selectedBrief.id}-${shortRunToken()}`;
				await supersedeOpenRunsForBrief(ctx.cwd, config, selectedBrief.id, runId);

				const briefContent = await fsp.readFile(selectedBrief.absolute_path, "utf8");
				const run = createRuntimeRun({
					repo_root_abs: ctx.cwd,
					config,
					brief_id: selectedBrief.id,
					brief_rel_path: selectedBrief.relative_path,
					brief_content: briefContent,
					run_id: runId,
					member_session_root_rel: SESSION_ROOT_REL,
				});

				await ensureDir(run.deliberation_dir_abs);
				await ensureDir(run.board_output_dir_abs);
				await ensureDir(run.memo_dir_abs);
				await ensureDir(resolveRepoPath(ctx.cwd, SESSION_ROOT_REL));
				await ensureFile(run.transcript_abs_path);
				for (const sessionDir of Object.values(run.member_session_dirs_abs)) {
					await ensureDir(sessionDir);
				}

				runtime.meeting = run;
				await persistRunState(run);
				await writeScratchPad(run, config);
				await recordUpdate(run, "meeting_started", {
					paths: {
						brief: run.state.paths.brief,
						scratch_pad: run.state.paths.scratch_pad,
					},
				});

				pi.appendEntry(STATE_ENTRY_TYPE, {
					status: run.state.status,
					briefId: run.state.brief_id,
					runId: run.state.run_id,
					statePath: run.state.paths.state,
				});

				const ceoModel = findModel(ctx.modelRegistry, MODELS.ceo.provider, MODELS.ceo.id);
				if (ceoModel) {
					const changed = await pi.setModel(ceoModel);
					if (!changed) ctx.ui.notify(`CEO model unavailable: ${MODELS.ceo.label}`, "warning");
				}

				run.state.status = "running";
				await persistRunState(run);
				updateWidget(ctx, config, run);
				ctx.ui.setWorkingMessage(`Preparing ${run.state.brief_id}...`);
				pi.sendMessage({
					customType: UPDATE_MESSAGE_TYPE,
					content: `Selected ${run.state.brief_id}. CEO scratch pad refreshed at ${run.state.paths.scratch_pad}.`,
					display: true,
					details: { label: "Launch", color: CEO_COLOR },
				});
				pi.sendUserMessage(buildStartPrompt(run.state.brief_id, briefContent, config));
			} catch (error) {
				await markRunFailed(runtime.meeting, config, ctx, error instanceof Error ? error.message : String(error));
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerTool({
		name: "converse",
		label: "Converse",
		description: "Send a structured prompt from the CEO to one or more board members and collect their responses.",
		promptSnippet: "Use converse to gather opinions from specific board members before making a decision.",
		promptGuidelines: [
			"Consult the smallest useful subset of the board first.",
			"Synthesize after every converse call instead of calling the board repeatedly without reflection.",
			"When time or budget is exhausted, call end_deliberation immediately.",
		],
		parameters: ConverseParams,
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			let config: MeetingConfig | undefined;
			try {
				config = runtime.config ?? (runtime.config = await readConfig(ctx.cwd));
				const run = runtime.meeting;
				if (!run || isTerminalRunStatus(run.state.status) || run.state.status === "closing") {
					return {
						content: [{ type: "text", text: "No active deliberation. Run /ceo-begin first." }],
						details: { responses: [], cost_delta_usd_micros: 0, elapsed_ms: 0, constraint_hit: false } satisfies ConverseDetails,
						isError: true,
					};
				}

				const lookup = boardLookup(config);
				const requestedMembers = (params.to.length > 0 ? params.to : config.board.map((member) => member.name))
					.map((name) => lookup.get(name))
					.filter((member): member is BoardMemberConfig => Boolean(member));
				if (requestedMembers.length === 0) {
					return {
						content: [{ type: "text", text: "No valid board members provided." }],
						details: { responses: [], cost_delta_usd_micros: 0, elapsed_ms: 0, constraint_hit: false } satisfies ConverseDetails,
						isError: true,
					};
				}

				const subject = params.subject.trim();
				const prompt = params.prompt.trim();
				const activeConfig = config;
				run.state.last_subject = subject;
				run.state.last_prompt = prompt;
				run.state.status = "running";
				touchRunState(run.state);
				updateWidget(ctx, config, run);
				ctx.ui.setWorkingMessage(`Dispatching ${subject}...`);
				onUpdate?.({
					content: [{ type: "text", text: `Dispatching ${subject} to ${requestedMembers.map((member) => member.name).join(", ")}...` }],
					details: { phase: "dispatch" },
				});

				await recordUpdate(run, "converse_requested", {
					to: requestedMembers.map((member) => member.name),
					subject,
					prompt,
					mode: params.mode ?? "parallel",
				});

				const executeForMember = async (member: BoardMemberConfig): Promise<WorkerPromptResult> => {
					const definition = boardMemberDefinitionFromDisplayName(member.name);
					if (!definition) throw new Error(`Unsupported board member ${member.name}`);
					const memberState = getMemberState(run, definition.key);
					memberState.status = "running";
					memberState.last_updated_at = nowIso();
					setMemberUiStatus(ctx, member, "Working");
					updateWidget(ctx, activeConfig, run);

					const personaPath = resolveRepoPath(ctx.cwd, member.path);
					const persona = await fsp.readFile(personaPath, "utf8").catch(() => `# ${member.name}\n`);
					const result = await runPiWorkerPrompt({
						cwd: ctx.cwd,
						sessionDir: run.member_session_dirs_abs[definition.key],
						memberKey: definition.key,
						displayName: member.name,
						modelId: MODELS.board.id,
						provider: MODELS.board.provider,
						systemPrompt: `${persona.trim()}\n\n${boardInstruction(member)}`,
						prompt: buildBoardPrompt(run, member, subject, prompt),
						onProgress: (message) =>
							onUpdate?.({
								content: [{ type: "text", text: message }],
								details: { phase: "worker-update", member: member.name },
							}),
					});

					memberState.last_updated_at = nowIso();
					memberState.cost_usd_micros += result.cost_usd_micros;
					memberState.status = result.status === "ok" ? "responded" : "error";
					memberState.last_summary = summarizeText(result.content || result.error || "");
					await writeBoardOutput(run, definition.key, subject, prompt, result);
					await recordUpdate(run, "board_response", {
						member_key: definition.key,
						display_name: member.name,
						status: result.status,
						cost_usd_micros: result.cost_usd_micros,
						session_id: result.session_id,
					});
					pi.sendMessage({
						customType: UPDATE_MESSAGE_TYPE,
						content: `${member.name} ${result.status === "ok" ? "responded" : "failed"}${result.content ? `: ${summarizeText(result.content)}` : ""}`,
						display: true,
						details: { label: member.name, color: member.color },
					});
					setMemberUiStatus(ctx, member, memberUiLabel(memberState.status));
					updateWidget(ctx, activeConfig, run);
					return result;
				};

				const startedAt = Date.now();
				const results: WorkerPromptResult[] = [];
				if ((params.mode ?? "parallel") === "sequential") {
					for (const member of requestedMembers) {
						results.push(await executeForMember(member));
					}
				} else {
					results.push(...(await Promise.all(requestedMembers.map((member) => executeForMember(member)))));
				}

				const costDeltaMicros = sumMicros(results.map((result) => result.cost_usd_micros));
				refreshRunTotals(run);
				await writeScratchPad(run, config);
				await persistRunState(run);
				const hitConstraint = constraintReached(config, run);
				ctx.ui.setWorkingMessage(
					hitConstraint ? "Constraint boundary reached. Collecting final positions next." : `Board round ${subject} complete.`,
				);
				updateWidget(ctx, config, run);

				return {
					content: [{ type: "text", text: compileResponses(results, hitConstraint) }],
					details: {
						responses: results,
						cost_delta_usd_micros: costDeltaMicros,
						elapsed_ms: Date.now() - startedAt,
						constraint_hit: hitConstraint,
					} satisfies ConverseDetails,
				};
			} catch (error) {
				await markRunFailed(runtime.meeting, config, ctx, error instanceof Error ? error.message : String(error));
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					details: { responses: [], cost_delta_usd_micros: 0, elapsed_ms: 0, constraint_hit: false } satisfies ConverseDetails,
					isError: true,
				};
			}
		},
		renderCall(args, _theme, _context) {
			const targets = Array.isArray(args.to) ? args.to.join(", ") : "";
			return new Text(`converse ${targets}${args.subject ? ` • ${args.subject}` : ""}`, 0, 0);
		},
		renderResult(result, _options, _theme, _context) {
			const details = (result.details ?? {}) as ConverseDetails;
			const lines = [
				`Collected ${details.responses.length} board responses`,
				`Cost delta: ${formatUsdFromMicros(details.cost_delta_usd_micros)}`,
				`Elapsed: ${(details.elapsed_ms / 1000).toFixed(1)}s`,
			];
			if (details.constraint_hit) lines.push("Constraint boundary reached");
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "end_deliberation",
		label: "End Deliberation",
		description: "Close the meeting, gather final positions, synthesize the memo, and persist all artifacts.",
		promptSnippet: "Use end_deliberation once you have enough evidence or the budget/time boundary is reached.",
		parameters: EndDeliberationParams,
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			let config: MeetingConfig | undefined;
			try {
				config = runtime.config ?? (runtime.config = await readConfig(ctx.cwd));
				const run = runtime.meeting;
				if (!run || isTerminalRunStatus(run.state.status)) {
					return {
						content: [{ type: "text", text: "No active deliberation to close." }],
						details: {
							status: "closed",
							memo_path: "",
							cost_total_usd_micros: 0,
							final_positions: [],
						} satisfies EndDeliberationDetails,
						isError: true,
					};
				}

				ctx.ui.setWorkingMessage("Collecting final board positions...");
				onUpdate?.({
					content: [{ type: "text", text: "Collecting final board positions..." }],
					details: { phase: "closing" },
				});

				const finalPositions: FinalBoardMemberMemo[] = [];
				for (const memberKey of run.state.active_member_keys) {
					const member = getMemberConfig(config, memberKey);
					const memberState = getMemberState(run, memberKey);
					memberState.status = "running";
					memberState.last_updated_at = nowIso();
					setMemberUiStatus(ctx, member, "Final position");

					const personaPath = resolveRepoPath(ctx.cwd, member.path);
					const persona = await fsp.readFile(personaPath, "utf8").catch(() => `# ${member.name}\n`);
					const result = await runPiWorkerPrompt({
						cwd: ctx.cwd,
						sessionDir: run.member_session_dirs_abs[memberKey],
						memberKey,
						displayName: member.name,
						modelId: MODELS.board.id,
						provider: MODELS.board.provider,
						systemPrompt: `${persona.trim()}\n\n${boardInstruction(member)}`,
						prompt: buildBoardPrompt(run, member, "Final Position", closingInstruction(params.closing_prompt)),
						onProgress: (message) =>
							onUpdate?.({
								content: [{ type: "text", text: message }],
								details: { phase: "closing-update", member: member.name },
							}),
					});

					memberState.last_updated_at = nowIso();
					memberState.cost_usd_micros += result.cost_usd_micros;
					memberState.status = result.status === "ok" ? "responded" : "error";
					memberState.last_summary = summarizeText(result.content || result.error || "");
					memberState.last_vote = parseVoteChoice(result.content);
					await writeBoardOutput(run, memberKey, "Final Position", params.closing_prompt, result);
					await recordUpdate(run, "final_position", {
						member_key: memberKey,
						display_name: member.name,
						status: result.status,
						vote: memberState.last_vote,
						cost_usd_micros: result.cost_usd_micros,
						session_id: result.session_id,
					});
					pi.sendMessage({
						customType: UPDATE_MESSAGE_TYPE,
						content: `${member.name} final position captured.`,
						display: true,
						details: { label: member.name, color: member.color },
					});
					setMemberUiStatus(ctx, member, memberUiLabel(memberState.status));
					finalPositions.push({
						key: memberKey,
						display_name: member.name,
						vote: memberState.last_vote,
						position_markdown: result.content.trim() || result.error || "_No response captured._",
					});
				}

				refreshRunTotals(run);
				ctx.ui.setWorkingMessage("Synthesizing final CEO memo...");
				const ceoResult = await runPiWorkerPrompt({
					cwd: ctx.cwd,
					sessionDir: path.join(resolveRepoPath(ctx.cwd, SESSION_ROOT_REL), "ceo"),
					memberKey: "ceo",
					displayName: "CEO",
					modelId: MODELS.ceo.id,
					provider: MODELS.ceo.provider,
					systemPrompt: [
						"You are the CEO synthesizing a final board memo.",
						"Be decisive, explicit, and grounded in the board evidence.",
						"Return only the requested tagged blocks.",
					].join("\n"),
					prompt: buildMemoSynthesisPrompt(run, finalPositions, params.decision_format),
				});
				const memoSections = parseMemoSections(ceoResult.content);
				const memoInput = await finalizeRun({
					runtime_run: run,
					final_board_members: finalPositions,
					ceo_cost_usd_micros: ceoResult.cost_usd_micros,
					decision: memoSections.decision,
					narrative: {
						rationale_markdown: memoSections.rationale_markdown,
						conditions_markdown: memoSections.conditions_markdown,
						next_moves_markdown: memoSections.next_moves_markdown,
					},
				});

				await writeScratchPad(run, config);
				await recordUpdate(run, "meeting_closed", {
					memo_path: memoInput.relative_paths.memo,
					cost_usd_micros: run.state.cost_usd_micros,
					elapsed_ms: run.state.elapsed_ms,
					vote_summary: memoInput.vote_summary,
				});
				pi.appendEntry(STATE_ENTRY_TYPE, {
					status: run.state.status,
					briefId: run.state.brief_id,
					runId: run.state.run_id,
					statePath: run.state.paths.state,
					memoPath: memoInput.relative_paths.memo,
				});

				updateWidget(ctx, config, run);
				ctx.ui.setWorkingMessage("Ready.");
				pi.sendMessage({
					customType: UPDATE_MESSAGE_TYPE,
					content: `Artifacts written. Memo: ${memoInput.relative_paths.memo}`,
					display: true,
					details: { label: "Closed", color: CEO_COLOR },
				});

				return {
					content: [
						{
							type: "text",
							text: [
								"Deliberation closed.",
								`Memo: ${memoInput.relative_paths.memo}`,
								`Board vote: ${memoInput.vote_summary.accept} accept / ${memoInput.vote_summary.reject} reject / ${memoInput.vote_summary.defer} defer / ${memoInput.vote_summary.other} other`,
								`Total cost: ${formatUsdFromMicros(run.state.cost_usd_micros)}`,
							].join("\n"),
						},
					],
					details: {
						status: "closed",
						memo_path: memoInput.relative_paths.memo,
						cost_total_usd_micros: run.state.cost_usd_micros,
						final_positions: finalPositions,
					} satisfies EndDeliberationDetails,
				};
			} catch (error) {
				await markRunFailed(runtime.meeting, config, ctx, error instanceof Error ? error.message : String(error));
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					details: {
						status: "closed",
						memo_path: "",
						cost_total_usd_micros: runtime.meeting?.state.cost_usd_micros ?? 0,
						final_positions: [],
					} satisfies EndDeliberationDetails,
					isError: true,
				};
			}
		},
		renderCall(args, _theme, _context) {
			return new Text(`end_deliberation • ${args.decision_format}`, 0, 0);
		},
		renderResult(result, _options, _theme, _context) {
			const details = (result.details ?? {}) as EndDeliberationDetails;
			return new Text(
				[
					`Closed • ${details.memo_path}`,
					`Cost: ${formatUsdFromMicros(details.cost_total_usd_micros)}`,
				].join("\n"),
				0,
				0,
			);
		},
	});
}
