import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
// import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import YAML from "yaml";

const EXTENSION_TITLE = "CEO & Board - Strategic Decision-Making Agent Team";
const CONFIG_PATH = ".pi/ceo-agents/ceo-and-board-configuration.yaml";
const SCRATCH_PAD_PATH = ".pi/ceo-agents/expertise/ceo-scratch-pad.md";
const SESSIONS_ROOT = ".pi/ceo-agents/sessions";
const STATE_ENTRY_TYPE = "ceo-board-session";
const UPDATE_MESSAGE_TYPE = "ceo-board-update";
const FOOTER_BG = "#36f0f6";
const FOOTER_FG = "#0b0714";
const CEO_COLOR = "#ff4fd8";
// const PANEL_BG = "#4a1e6a";
const PANEL_DIM = "#b69ed1";
const PANEL_TEXT = "#f6efff";
const PANEL_MUTED = "#9a8ab8";
const PANEL_BORDER = "#36f0f6";
const DEFAULT_EDITOR = "code";
const WORKER_TOOLS = "read,grep,find,ls";

type BoardRoleName =
	| "Revenue"
	| "Product Strategist"
	| "Technical Architect"
	| "Contrarian"
	| "Compounder"
	| "Moonshot";

interface MeetingConfig {
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

interface BoardMemberConfig {
	name: BoardRoleName;
	path: string;
	color: string;
}

interface BriefOption {
	id: string;
	path: string;
}

interface BoardMemberState {
	state: string;
	lastUpdatedAt: string;
	costUsd: number;
	sessionDir: string;
	outputPath: string;
	lastSummary: string | undefined;
}

interface DeliberationState {
	status: "idle" | "active" | "closing" | "closed";
	briefId: string;
	briefPath: string;
	sessionId: string;
	startedAt: string;
	updatedAt: string;
	deliberationDir: string;
	transcriptPath: string;
	statePath: string;
	boardOutputDir: string;
	memoDir: string;
	memoPath: string | undefined;
	scratchPadPath: string;
	briefContent: string;
	costTotalUsd: number;
	elapsedMs: number;
	memberStates: Record<string, BoardMemberState>;
	activeMembers: BoardRoleName[];
	voteSummary: VoteSummary | undefined;
	lastSubject: string | undefined;
	lastPrompt: string | undefined;
}

interface VoteSummary {
	accept: number;
	reject: number;
	defer: number;
	other: number;
}

interface RuntimeState {
	config: MeetingConfig | undefined;
	meeting: DeliberationState | undefined;
}

interface WorkerPromptResult {
	member: BoardRoleName | "CEO";
	status: "ok" | "error";
	content: string;
	costUsd: number;
	sessionId: string | undefined;
	sessionFile: string | undefined;
	elapsedMs: number;
	error: string | undefined;
}

interface ConverseDetails {
	responses: WorkerPromptResult[];
	cost_delta_usd: number;
	elapsed_ms: number;
	constraint_hit: boolean;
}

interface EndDeliberationDetails {
	status: "closed";
	memo_path: string;
	vote_summary: VoteSummary;
	cost_total_usd: number;
	final_positions: WorkerPromptResult[];
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

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function nowIso(): string {
	return new Date().toISOString();
}

function shortSessionId(): string {
	return Math.random().toString(36).slice(2, 8);
}

function parseBudget(value: string | number): number {
	if (typeof value === "number") return value;
	const parsed = Number.parseFloat(String(value).replace(/[^0-9.]+/g, ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatMinutes(ms: number): string {
	return `${(ms / 60_000).toFixed(1)} minutes`;
}

function safeFileName(name: string): string {
	return slugify(name).replace(/^-+|-+$/g, "") || "member";
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
		board: [
			{ name: "Revenue", path: ".pi/ceo-agents/agents/revenue.md", color: "#ff7edb" },
			{
				name: "Product Strategist",
				path: ".pi/ceo-agents/agents/product-strategist.md",
				color: "#fede5d",
			},
			{
				name: "Technical Architect",
				path: ".pi/ceo-agents/agents/technical-architect.md",
				color: "#ff6e96",
			},
			{ name: "Contrarian", path: ".pi/ceo-agents/agents/contrarian.md", color: "#ff9e64" },
			{ name: "Compounder", path: ".pi/ceo-agents/agents/compounder.md", color: "#72f1b8" },
			{ name: "Moonshot", path: ".pi/ceo-agents/agents/moonshot.md", color: "#7dcfff" },
		],
	};
}

function resolveFromCwd(cwd: string, relativePath: string): string {
	return path.resolve(cwd, relativePath);
}

async function ensureDir(dirPath: string): Promise<void> {
	await fsp.mkdir(dirPath, { recursive: true });
}

async function ensureFile(filePath: string, content = ""): Promise<void> {
	try {
		await fsp.access(filePath, fs.constants.F_OK);
	} catch {
		await ensureDir(path.dirname(filePath));
		await fsp.writeFile(filePath, content, "utf8");
	}
}

async function readConfig(cwd: string): Promise<MeetingConfig> {
	const absolutePath = resolveFromCwd(cwd, CONFIG_PATH);
	try {
		const source = await fsp.readFile(absolutePath, "utf8");
		const parsed = YAML.parse(source) as MeetingConfig | null;
		if (!parsed?.meeting?.constraints || !Array.isArray(parsed.board) || !parsed.paths) {
			return defaultConfig();
		}
		return parsed;
	} catch {
		return defaultConfig();
	}
}

async function listBriefs(cwd: string, config: MeetingConfig): Promise<BriefOption[]> {
	const briefsDir = resolveFromCwd(cwd, config.paths.briefs);
	const entries = await fsp.readdir(briefsDir, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			id: entry.name,
			path: path.join(briefsDir, entry.name, "brief.md"),
		}))
		.filter((brief) => fs.existsSync(brief.path))
		.sort((left, right) => right.id.localeCompare(left.id));
}

function boardLookup(config: MeetingConfig): Map<string, BoardMemberConfig> {
	return new Map(config.board.map((member) => [member.name, member]));
}

function getMemberState(meeting: DeliberationState, member: BoardMemberConfig): BoardMemberState {
	const existing = meeting.memberStates[member.name];
	if (existing) return existing;
	const sessionDir = resolveFromCwd(process.cwd(), path.join(SESSIONS_ROOT, safeFileName(member.name)));
	const outputPath = path.join(meeting.boardOutputDir, `${safeFileName(member.name)}.md`);
	const created: BoardMemberState = {
		state: "Idle",
		lastUpdatedAt: nowIso(),
		costUsd: 0,
		sessionDir,
		outputPath,
		lastSummary: undefined,
	};
	meeting.memberStates[member.name] = created;
	return created;
}

function refreshMeetingTime(meeting: DeliberationState): void {
	meeting.updatedAt = nowIso();
	meeting.elapsedMs = Date.now() - Date.parse(meeting.startedAt);
}

async function appendJsonl(filePath: string, payload: Record<string, unknown>): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await fsp.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function writeBoardOutput(memberState: BoardMemberState, subject: string, prompt: string, result: WorkerPromptResult): Promise<void> {
	const body = [
		`# ${result.member}`,
		"",
		`- Status: ${result.status}`,
		`- Subject: ${subject}`,
		`- Cost: ${formatCurrency(result.costUsd)}`,
		`- Updated: ${nowIso()}`,
		"",
		"## Prompt",
		prompt.trim(),
		"",
		"## Response",
		result.content.trim() || "_No response captured._",
		"",
	].join("\n");
	await ensureDir(path.dirname(memberState.outputPath));
	await fsp.writeFile(memberState.outputPath, body, "utf8");
}

async function writeScratchPad(meeting: DeliberationState, config: MeetingConfig): Promise<void> {
	const budgetMin = parseBudget(config.meeting.constraints.min_budget);
	const budgetMax = parseBudget(config.meeting.constraints.max_budget);
	const lines = [
		"# CEO Scratch Pad",
		"",
		`- Brief: ${meeting.briefId}`,
		`- Session: ${meeting.sessionId}`,
		`- Status: ${meeting.status}`,
		`- Started: ${meeting.startedAt}`,
		`- Updated: ${meeting.updatedAt}`,
		`- Duration: ${formatMinutes(meeting.elapsedMs)}`,
		`- Budget Range: ${formatCurrency(budgetMin)} - ${formatCurrency(budgetMax)}`,
		`- Budget Used: ${formatCurrency(meeting.costTotalUsd)}`,
		"",
		"## Active Members",
		...meeting.activeMembers.map((member) => {
			const memberState = meeting.memberStates[member];
			const summary = memberState?.lastSummary ? ` | ${memberState.lastSummary}` : "";
			return `- ${member}: ${memberState?.state ?? "Idle"}${summary}`;
		}),
		"",
		"## Brief",
		meeting.briefContent.trim(),
		"",
	];
	await ensureDir(path.dirname(meeting.scratchPadPath));
	await fsp.writeFile(meeting.scratchPadPath, lines.join("\n"), "utf8");
}

async function persistMeeting(meeting: DeliberationState): Promise<void> {
	refreshMeetingTime(meeting);
	await writeJson(meeting.statePath, meeting);
}

function statusKey(memberName: string): string {
	return `board:${safeFileName(memberName)}`;
}

function setMemberUiStatus(ctx: ExtensionContext, member: BoardMemberConfig, state: string): void {
	ctx.ui.setStatus(statusKey(member.name), `${colorHex(member.color, member.name)} ${state}`);
}

function updateWidget(ctx: ExtensionContext, config: MeetingConfig, meeting?: DeliberationState): void {
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
		const status = meeting?.memberStates[member.name]?.state ?? "Ready";
		lines.push(`${colorHex(member.color, member.name)}  ${MODELS.board.label}  ${colorHex(PANEL_MUTED, status)}`);
	}
	lines.push("");
	if (!meeting) {
		lines.push(colorHex(PANEL_TEXT, "Run /ceo-begin to start a deliberation."));
	} else {
		lines.push(`${colorHex(PANEL_DIM, "Brief")}: ${meeting.briefId}`);
		lines.push(`${colorHex(PANEL_DIM, "Session")}: ${meeting.sessionId}`);
		lines.push(`${colorHex(PANEL_DIM, "Status")}: ${meeting.status}`);
		lines.push(`${colorHex(PANEL_DIM, "Cost")}: ${formatCurrency(meeting.costTotalUsd)}`);
		lines.push(`${colorHex(PANEL_DIM, "Elapsed")}: ${formatMinutes(meeting.elapsedMs)}`);
		lines.push(`${colorHex(PANEL_DIM, "Transcript")}: ${meeting.transcriptPath}`);
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
				const meeting = runtime.meeting;
				const role = meeting ? `CEO • ${meeting.status.toUpperCase()}` : "CEO & BOARD";
				const contextUsage = ctx.getContextUsage();
				const contextText =
					contextUsage?.percent != null
						? `ctx ${contextUsage.percent.toFixed(0)}%`
						: contextUsage?.tokens != null
							? `ctx ${contextUsage.tokens}`
							: "ctx --";
				const totalCost = latestAssistantCost(ctx) + (meeting?.costTotalUsd ?? 0);
				const right = `${formatCurrency(totalCost)}  ${contextText}`;
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
		"- Revenue",
		"- Product Strategist",
		"- Technical Architect",
		"- Contrarian",
		"- Compounder",
		"- Moonshot",
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
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, argsPrefix: [] };
	}
	return { command: "pi", argsPrefix: [] };
}

async function runPiWorkerPrompt(options: {
	cwd: string;
	sessionDir: string;
	member: BoardRoleName | "CEO";
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
		let sessionFile: string | undefined;
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
					member: options.member,
					status: "ok",
					content: workerText.trim() || lastTextBlock(lastAgentEnd?.messages),
					costUsd: typeof sessionStats.cost === "number" ? sessionStats.cost : 0,
					sessionId,
					sessionFile,
					elapsedMs: Date.now() - startedAt,
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
						member: options.member,
						status: "error",
						content: "",
						costUsd: 0,
						sessionId: undefined,
						sessionFile: undefined,
						elapsedMs: Date.now() - startedAt,
						error:
							typeof payload.error === "string"
								? payload.error
								: `Pi ${options.member} worker failed`,
					});
					return;
				}

				if (payload.command === "prompt") {
					promptAccepted = true;
					options.onProgress?.(`${options.member}: prompt accepted`);
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
					sessionFile = typeof sessionStats.sessionFile === "string" ? sessionStats.sessionFile : undefined;
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
				options.onProgress?.(`${options.member}: response ready`);
				send({ id: "last", type: "get_last_assistant_text" });
			}
		});

		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});

		child.on("error", (error) => {
			settle({
				member: options.member,
				status: "error",
				content: "",
				costUsd: 0,
				sessionId: undefined,
				sessionFile: undefined,
				elapsedMs: Date.now() - startedAt,
				error: error.message,
			});
		});

		child.on("close", (code) => {
			if (!settled) {
				settle({
					member: options.member,
					status: code === 0 && workerText ? "ok" : "error",
					content: workerText.trim(),
					costUsd: typeof sessionStats?.cost === "number" ? sessionStats.cost : 0,
					sessionId,
					sessionFile,
					elapsedMs: Date.now() - startedAt,
					error: code === 0 ? undefined : stderr.trim() || `Pi exited with code ${code ?? -1}`,
				});
			}
		});

		send({ id: "prompt", type: "prompt", message: options.prompt });
	});
}

async function recordUpdate(
	meeting: DeliberationState,
	type: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await appendJsonl(meeting.transcriptPath, {
		timestamp: nowIso(),
		type,
		session_id: meeting.sessionId,
		brief_id: meeting.briefId,
		...payload,
	});
}

function constraintReached(config: MeetingConfig, meeting: DeliberationState): boolean {
	const maxBudget = parseBudget(config.meeting.constraints.max_budget);
	const maxTimeMs = config.meeting.constraints.max_time_minutes * 60_000;
	return meeting.costTotalUsd >= maxBudget || meeting.elapsedMs >= maxTimeMs;
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

function buildBoardPrompt(
	member: BoardMemberConfig,
	meeting: DeliberationState,
	subject: string,
	prompt: string,
): string {
	return [
		`Subject: ${subject}`,
		"",
		prompt.trim(),
		"",
		"Brief:",
		meeting.briefContent.trim(),
		"",
		"Session context:",
		`- Brief ID: ${meeting.briefId}`,
		`- Board session: ${meeting.sessionId}`,
		`- Running cost: ${formatCurrency(meeting.costTotalUsd)}`,
		"",
		"Respond from your board role only.",
		`Your role is ${member.name}.`,
	].join("\n");
}

function buildMemoPrompt(
	meeting: DeliberationState,
	finalPositions: WorkerPromptResult[],
	decisionFormat: string,
): string {
	const positionBundle = finalPositions
		.map((result) => `## ${result.member}\n${result.content.trim() || "_No response_"}`)
		.join("\n\n");
	return [
		"You are the CEO closing a strategic board meeting.",
		"Produce a concise markdown memo body only. Do not include frontmatter.",
		"",
		`Decision format: ${decisionFormat}`,
		`Brief ID: ${meeting.briefId}`,
		`Session ID: ${meeting.sessionId}`,
		`Duration: ${formatMinutes(meeting.elapsedMs)}`,
		`Budget used: ${formatCurrency(meeting.costTotalUsd)}`,
		"",
		"Brief:",
		meeting.briefContent.trim(),
		"",
		"Final board positions:",
		positionBundle,
		"",
		"Required sections:",
		"- Session",
		"- Decision",
		"- Board Vote",
		"- Deliberation Cost",
		"- Recommendation Rationale",
		"- Conditions / Risks",
		"- Immediate Next Moves",
	].join("\n");
}

function compileResponses(results: WorkerPromptResult[], constraintHit: boolean): string {
	const responseText = results
		.map((result) => `### ${result.member}\n${result.content.trim() || result.error || "_No response_"}`)
		.join("\n\n");
	const warning = constraintHit
		? "\n\nConstraint boundary reached. Call end_deliberation now."
		: "";
	return `Board responses collected:\n\n${responseText}${warning}`.trim();
}

function buildVoteSummary(results: WorkerPromptResult[]): VoteSummary {
	const summary: VoteSummary = { accept: 0, reject: 0, defer: 0, other: 0 };
	for (const result of results) {
		const normalized = result.content.toLowerCase();
		if (/\bvote:\s*accept\b|\baccept\b/.test(normalized)) summary.accept += 1;
		else if (/\bvote:\s*reject\b|\breject\b/.test(normalized)) summary.reject += 1;
		else if (/\bvote:\s*defer\b|\bdefer\b/.test(normalized)) summary.defer += 1;
		else summary.other += 1;
	}
	return summary;
}

function restoreStateFromBranch(ctx: ExtensionContext): DeliberationState | undefined {
	const branch = ctx.sessionManager.getBranch() as Array<any>;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		const statePath = entry?.data?.statePath;
		if (typeof statePath !== "string" || !fs.existsSync(statePath)) continue;
		try {
			const source = fs.readFileSync(statePath, "utf8");
			return JSON.parse(source) as DeliberationState;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

async function initialize(ctx: ExtensionContext): Promise<void> {
	runtime.config = await readConfig(ctx.cwd);
	runtime.meeting = restoreStateFromBranch(ctx);
	if (runtime.meeting) refreshMeetingTime(runtime.meeting);
	ctx.ui.setTitle("CEO & Board");
	installFooter(ctx);
	updateWidget(ctx, runtime.config, runtime.meeting);
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
			const config = (runtime.config = await readConfig(ctx.cwd));
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

			const briefContent = await fsp.readFile(selectedBrief.path, "utf8");
			const sessionId = shortSessionId();
			const deliberationSlug = `${selectedBrief.id}-${sessionId}`;
			const deliberationDir = resolveFromCwd(ctx.cwd, path.join(config.paths.deliberations, deliberationSlug));
			const memoDir = resolveFromCwd(ctx.cwd, path.join(config.paths.memos, deliberationSlug));
			const boardOutputDir = path.join(deliberationDir, "board");
			const transcriptPath = path.join(deliberationDir, "conversation.jsonl");
			const statePath = path.join(deliberationDir, "state.json");
			const scratchPadPath = resolveFromCwd(ctx.cwd, SCRATCH_PAD_PATH);

			await ensureDir(deliberationDir);
			await ensureDir(boardOutputDir);
			await ensureDir(memoDir);
			await ensureDir(resolveFromCwd(ctx.cwd, SESSIONS_ROOT));
			await ensureFile(transcriptPath);

			const meeting: DeliberationState = {
				status: "active",
				briefId: selectedBrief.id,
				briefPath: selectedBrief.path,
				sessionId,
				startedAt: nowIso(),
				updatedAt: nowIso(),
				deliberationDir,
				transcriptPath,
				statePath,
				boardOutputDir,
				memoDir,
				memoPath: undefined,
				scratchPadPath,
				briefContent,
				costTotalUsd: 0,
				elapsedMs: 0,
				memberStates: {},
				activeMembers: config.board.map((member) => member.name),
				voteSummary: undefined,
				lastSubject: undefined,
				lastPrompt: undefined,
			};

			for (const member of config.board) {
				const memberState = getMemberState(meeting, member);
				await ensureDir(memberState.sessionDir);
				setMemberUiStatus(ctx, member, "Ready");
			}

			runtime.meeting = meeting;
			await persistMeeting(meeting);
			await writeScratchPad(meeting, config);
			await recordUpdate(meeting, "meeting_started", {
				brief_path: selectedBrief.path,
				scratch_pad: scratchPadPath,
			});
			pi.appendEntry(STATE_ENTRY_TYPE, {
				status: meeting.status,
				briefId: meeting.briefId,
				sessionId: meeting.sessionId,
				statePath: meeting.statePath,
			});

			const ceoModel = findModel(ctx.modelRegistry, MODELS.ceo.provider, MODELS.ceo.id);
			if (ceoModel) {
				const changed = await pi.setModel(ceoModel);
				if (!changed) ctx.ui.notify(`CEO model unavailable: ${MODELS.ceo.label}`, "warning");
			}

			updateWidget(ctx, config, meeting);
			ctx.ui.setWorkingMessage(`Preparing ${meeting.briefId}...`);
			pi.sendMessage({
				customType: UPDATE_MESSAGE_TYPE,
				content: `Selected ${meeting.briefId}. CEO scratch pad refreshed at ${scratchPadPath}.`,
				display: true,
				details: { label: "Launch", color: CEO_COLOR },
			});
			pi.sendUserMessage(buildStartPrompt(meeting.briefId, briefContent, config));
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
			const config = runtime.config ?? (runtime.config = await readConfig(ctx.cwd));
			const meeting = runtime.meeting;
			if (!meeting) {
				return {
					content: [{ type: "text", text: "No active deliberation. Run /ceo-begin first." }],
					details: { responses: [], cost_delta_usd: 0, elapsed_ms: 0, constraint_hit: false } satisfies ConverseDetails,
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
					details: { responses: [], cost_delta_usd: 0, elapsed_ms: 0, constraint_hit: false } satisfies ConverseDetails,
					isError: true,
				};
			}

			const subject = params.subject.trim();
			const prompt = params.prompt.trim();
			meeting.lastSubject = subject;
			meeting.lastPrompt = prompt;
			meeting.status = "active";
			refreshMeetingTime(meeting);
			updateWidget(ctx, config, meeting);
			ctx.ui.setWorkingMessage(`Dispatching ${subject}...`);
			onUpdate?.({
				content: [{ type: "text", text: `Dispatching ${subject} to ${requestedMembers.map((member) => member.name).join(", ")}...` }],
				details: { phase: "dispatch" },
			});

			await recordUpdate(meeting, "converse_requested", {
				to: requestedMembers.map((member) => member.name),
				subject,
				prompt,
				mode: params.mode ?? "parallel",
			});

			const executeForMember = async (member: BoardMemberConfig): Promise<WorkerPromptResult> => {
				const memberState = getMemberState(meeting, member);
				memberState.state = `In ${subject}`;
				memberState.lastUpdatedAt = nowIso();
				setMemberUiStatus(ctx, member, memberState.state);
				updateWidget(ctx, config, meeting);

				const personaPath = resolveFromCwd(ctx.cwd, member.path);
				const persona = await fsp.readFile(personaPath, "utf8").catch(() => `# ${member.name}\n`);
				const systemPrompt = `${persona.trim()}\n\n${boardInstruction(member)}`;
				const result = await runPiWorkerPrompt({
					cwd: ctx.cwd,
					sessionDir: memberState.sessionDir,
					member: member.name,
					modelId: MODELS.board.id,
					provider: MODELS.board.provider,
					systemPrompt,
					prompt: buildBoardPrompt(member, meeting, subject, prompt),
					onProgress: (message) => {
						onUpdate?.({
							content: [{ type: "text", text: message }],
							details: { phase: "worker-update", member: member.name },
						});
					},
				});

				memberState.lastUpdatedAt = nowIso();
				memberState.costUsd = result.costUsd;
				memberState.state = result.status === "ok" ? "Responded" : "Error";
				memberState.lastSummary = summarizeText(result.content || result.error || "");
				await writeBoardOutput(memberState, subject, prompt, result);
				await recordUpdate(meeting, "board_response", {
					member: member.name,
					status: result.status,
					content: result.content,
					error: result.error,
					cost_usd: result.costUsd,
					session_file: result.sessionFile,
				});
				pi.sendMessage({
					customType: UPDATE_MESSAGE_TYPE,
					content: `${member.name} ${result.status === "ok" ? "responded" : "failed"}${result.content ? `: ${summarizeText(result.content)}` : ""}`,
					display: true,
					details: { label: member.name, color: member.color },
				});
				setMemberUiStatus(ctx, member, memberState.state);
				updateWidget(ctx, config, meeting);
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

			const costDelta = results.reduce((sum, result) => sum + result.costUsd, 0);
			meeting.costTotalUsd += costDelta;
			refreshMeetingTime(meeting);
			await writeScratchPad(meeting, config);
			await persistMeeting(meeting);
			const hitConstraint = constraintReached(config, meeting);
			if (hitConstraint) {
				ctx.ui.setWorkingMessage("Constraint boundary reached. Collecting final positions next.");
			} else {
				ctx.ui.setWorkingMessage(`Board round ${subject} complete.`);
			}
			updateWidget(ctx, config, meeting);

			return {
				content: [{ type: "text", text: compileResponses(results, hitConstraint) }],
				details: {
					responses: results,
					cost_delta_usd: Number(costDelta.toFixed(4)),
					elapsed_ms: Date.now() - startedAt,
					constraint_hit: hitConstraint,
				} satisfies ConverseDetails,
			};
		},
		renderCall(args, _theme, _context) {
			const targets = Array.isArray(args.to) ? args.to.join(", ") : "";
			return new Text(`converse ${targets}${args.subject ? ` • ${args.subject}` : ""}`, 0, 0);
		},
		renderResult(result, _options, _theme, _context) {
			const details = (result.details ?? {}) as ConverseDetails;
			const lines = [
				`Collected ${details.responses.length} board responses`,
				`Cost delta: ${formatCurrency(details.cost_delta_usd)}`,
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
			const config = runtime.config ?? (runtime.config = await readConfig(ctx.cwd));
			const meeting = runtime.meeting;
			if (!meeting) {
				return {
					content: [{ type: "text", text: "No active deliberation to close." }],
					details: {
						status: "closed",
						memo_path: "",
						vote_summary: { accept: 0, reject: 0, defer: 0, other: 0 },
						cost_total_usd: 0,
						final_positions: [],
					} satisfies EndDeliberationDetails,
					isError: true,
				};
			}

			meeting.status = "closing";
			refreshMeetingTime(meeting);
			await persistMeeting(meeting);
			updateWidget(ctx, config, meeting);
			ctx.ui.setWorkingMessage("Collecting final board positions...");
			onUpdate?.({
				content: [{ type: "text", text: "Collecting final board positions..." }],
				details: { phase: "closing" },
			});

			const lookup = boardLookup(config);
			const closingResults: WorkerPromptResult[] = [];
			for (const name of meeting.activeMembers) {
				const member = lookup.get(name);
				if (!member) continue;
				setMemberUiStatus(ctx, member, "Final position");
				const personaPath = resolveFromCwd(ctx.cwd, member.path);
				const persona = await fsp.readFile(personaPath, "utf8").catch(() => `# ${member.name}\n`);
				const result = await runPiWorkerPrompt({
					cwd: ctx.cwd,
					sessionDir: getMemberState(meeting, member).sessionDir,
					member: member.name,
					modelId: MODELS.board.id,
					provider: MODELS.board.provider,
					systemPrompt: `${persona.trim()}\n\n${boardInstruction(member)}`,
					prompt: buildBoardPrompt(member, meeting, "Final Position", closingInstruction(params.closing_prompt)),
					onProgress: (message) =>
						onUpdate?.({
							content: [{ type: "text", text: message }],
							details: { phase: "closing-update", member: member.name },
						}),
				});
				closingResults.push(result);
				await writeBoardOutput(getMemberState(meeting, member), "Final Position", params.closing_prompt, result);
				await recordUpdate(meeting, "final_position", {
					member: member.name,
					status: result.status,
					content: result.content,
					error: result.error,
					cost_usd: result.costUsd,
				});
				pi.sendMessage({
					customType: UPDATE_MESSAGE_TYPE,
					content: `${member.name} final position captured.`,
					display: true,
					details: { label: member.name, color: member.color },
				});
			}

			meeting.costTotalUsd += closingResults.reduce((sum, result) => sum + result.costUsd, 0);
			meeting.voteSummary = buildVoteSummary(closingResults);

			ctx.ui.setWorkingMessage("Synthesizing final CEO memo...");
			const ceoResult = await runPiWorkerPrompt({
				cwd: ctx.cwd,
				sessionDir: resolveFromCwd(ctx.cwd, path.join(SESSIONS_ROOT, "ceo")),
				member: "CEO",
				modelId: MODELS.ceo.id,
				provider: MODELS.ceo.provider,
				systemPrompt: [
					"You are the CEO synthesizing a final board memo.",
					"Be decisive, explicit, and grounded in the board evidence.",
					"Write markdown only.",
				].join("\n"),
				prompt: buildMemoPrompt(meeting, closingResults, params.decision_format),
			});
			meeting.costTotalUsd += ceoResult.costUsd;
			refreshMeetingTime(meeting);

			const memoPath = path.join(meeting.memoDir, "memo.md");
			const frontmatter = [
				"---",
				`title: "Board Memo: ${meeting.briefId}"`,
				`date: ${new Date().toISOString().slice(0, 10)}`,
				`duration: ${formatMinutes(meeting.elapsedMs)}`,
				`budget_used: ${formatCurrency(meeting.costTotalUsd)}`,
				"board_members:",
				...meeting.activeMembers.map((member) => `  - ${member}`),
				`brief: ${meeting.briefPath}`,
				`transcript: ${meeting.transcriptPath}`,
				"---",
				"",
			].join("\n");
			const memoBody =
				ceoResult.content.trim() ||
				[
					`## Session`,
					`- Session: ${meeting.sessionId}`,
					"",
					"## Decision",
					"- Final synthesis unavailable.",
					"",
					"## Board Vote",
					`- Accept: ${meeting.voteSummary.accept}`,
					`- Reject: ${meeting.voteSummary.reject}`,
					`- Defer: ${meeting.voteSummary.defer}`,
				].join("\n");
			await ensureDir(meeting.memoDir);
			await fsp.writeFile(memoPath, `${frontmatter}${memoBody.trim()}\n`, "utf8");

			meeting.status = "closed";
			meeting.memoPath = memoPath;
			await writeScratchPad(meeting, config);
			await persistMeeting(meeting);
			await recordUpdate(meeting, "meeting_closed", {
				memo_path: memoPath,
				vote_summary: meeting.voteSummary,
				cost_total_usd: meeting.costTotalUsd,
			});
			pi.appendEntry(STATE_ENTRY_TYPE, {
				status: meeting.status,
				briefId: meeting.briefId,
				sessionId: meeting.sessionId,
				statePath: meeting.statePath,
				memoPath,
			});

			updateWidget(ctx, config, meeting);
			ctx.ui.setWorkingMessage("Deliberation closed.");
			pi.sendMessage({
				customType: UPDATE_MESSAGE_TYPE,
				content: `Artifacts written. Memo: ${memoPath}`,
				display: true,
				details: { label: "Closed", color: CEO_COLOR },
			});

			return {
				content: [
					{
						type: "text",
						text: [
							"Deliberation closed.",
							`Memo: ${memoPath}`,
							`Board vote: ${meeting.voteSummary.accept} accept / ${meeting.voteSummary.reject} reject / ${meeting.voteSummary.defer} defer`,
							`Total cost: ${formatCurrency(meeting.costTotalUsd)}`,
						].join("\n"),
					},
				],
				details: {
					status: "closed",
					memo_path: memoPath,
					vote_summary: meeting.voteSummary,
					cost_total_usd: Number(meeting.costTotalUsd.toFixed(4)),
					final_positions: closingResults,
				} satisfies EndDeliberationDetails,
			};
		},
		renderCall(args, _theme, _context) {
			return new Text(`end_deliberation • ${args.decision_format}`, 0, 0);
		},
		renderResult(result, _options, _theme, _context) {
			const details = (result.details ?? {}) as EndDeliberationDetails;
			return new Text(
				[
					`Closed • ${details.memo_path}`,
					`Vote: ${details.vote_summary.accept} accept / ${details.vote_summary.reject} reject / ${details.vote_summary.defer} defer`,
					`Cost: ${formatCurrency(details.cost_total_usd)}`,
				].join("\n"),
				0,
				0,
			);
		},
	});
}
