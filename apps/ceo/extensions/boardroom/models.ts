import type { MeetingConfig, ModelPreference, PersistedModelSelection } from "./schema.js";

export type BoardroomModelRole = "ceo" | "board";

export interface BoardroomModelSelections {
	ceo: PersistedModelSelection;
	board: PersistedModelSelection;
}

export type BoardroomModelPreferences = Partial<Record<BoardroomModelRole, ModelPreference>>;

export interface ResolveBoardroomModelsOptions {
	env?: NodeJS.ProcessEnv;
	overrides?: BoardroomModelPreferences;
}

const CURRENT_MODEL_ALIASES = new Set(["current", "session", "selected"]);

export function formatModelSelection(model: PersistedModelSelection): string {
	return model.label || `${model.provider}/${model.id}`;
}

export function formatModelPreference(preference: ModelPreference | undefined): string {
	if (!preference) return "current";
	if (typeof preference === "string") return preference.trim() || "current";
	return preference.label || `${preference.provider}/${preference.id}`;
}

export function parseModelLocator(value: string): PersistedModelSelection | "current" {
	const trimmed = value.trim();
	if (!trimmed || CURRENT_MODEL_ALIASES.has(trimmed.toLowerCase())) return "current";

	const separator = trimmed.indexOf("/");
	if (separator <= 0 || separator === trimmed.length - 1) {
		throw new Error(
			`Invalid model selector "${value}". Use "current" or "provider/model-id" (model IDs may contain additional slashes).`,
		);
	}

	const provider = trimmed.slice(0, separator).trim();
	const id = trimmed.slice(separator + 1).trim();
	if (!provider || !id) {
		throw new Error(`Invalid model selector "${value}". Provider and model id are required.`);
	}

	return { provider, id, label: `${provider}/${id}` };
}

export function modelSelectionFromPiModel(model: unknown): PersistedModelSelection | undefined {
	if (!model || typeof model !== "object") return undefined;
	const record = model as Record<string, unknown>;
	if (typeof record.provider !== "string" || typeof record.id !== "string") return undefined;
	return {
		provider: record.provider,
		id: record.id,
		label: `${record.provider}/${record.id}`,
	};
}

export function normalizeModelPreference(
	preference: ModelPreference | undefined,
	currentModel: unknown,
	role: BoardroomModelRole,
): PersistedModelSelection {
	if (!preference) return requireCurrentModel(currentModel, role);

	if (typeof preference === "string") {
		const parsed = parseModelLocator(preference);
		return parsed === "current" ? requireCurrentModel(currentModel, role) : parsed;
	}

	const provider = preference.provider.trim();
	const id = preference.id.trim();
	if (!provider || !id) {
		throw new Error(`Invalid ${role} model config. Provider and model id are required.`);
	}
	return {
		provider,
		id,
		label: preference.label?.trim() || `${provider}/${id}`,
	};
}

export function configuredModelPreference(
	config: MeetingConfig,
	role: BoardroomModelRole,
	options: ResolveBoardroomModelsOptions = {},
): ModelPreference | undefined {
	const runtimeOverride = options.overrides?.[role];
	if (runtimeOverride) return runtimeOverride;

	const env = options.env ?? process.env;
	const roleEnvName = role === "ceo" ? "BOARDROOM_CEO_MODEL" : "BOARDROOM_BOARD_MODEL";
	const roleEnv = env[roleEnvName]?.trim();
	if (roleEnv) return roleEnv;
	const sharedEnv = env.BOARDROOM_MODEL?.trim();
	if (sharedEnv) return sharedEnv;

	return config.models?.[role] ?? config.models?.default;
}

export function resolveBoardroomModels(
	config: MeetingConfig,
	currentModel: unknown,
	options: ResolveBoardroomModelsOptions = {},
): BoardroomModelSelections {
	return {
		ceo: normalizeModelPreference(configuredModelPreference(config, "ceo", options), currentModel, "ceo"),
		board: normalizeModelPreference(configuredModelPreference(config, "board", options), currentModel, "board"),
	};
}

function requireCurrentModel(currentModel: unknown, role: BoardroomModelRole): PersistedModelSelection {
	const selected = modelSelectionFromPiModel(currentModel);
	if (!selected) {
		throw new Error(
			`No current Pi model is selected for the ${role} role. Select a model with /model or configure models.${role} in .pi/ceo-agents/ceo-and-board-configuration.yaml.`,
		);
	}
	return selected;
}
