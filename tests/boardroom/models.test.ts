import assert from "node:assert/strict";
import test from "node:test";
import {
	formatModelSelection,
	parseModelLocator,
	resolveBoardroomModels,
} from "../../apps/ceo/extensions/boardroom/models.js";
import { createTestConfig } from "./helpers.js";

test("parseModelLocator splits on the first slash so model IDs may contain slashes", () => {
	const parsed = parseModelLocator("mac-studio-lmstudio/google/gemma-4-31b");
	if (parsed === "current") assert.fail("expected an explicit model selection");
	assert.equal(parsed.provider, "mac-studio-lmstudio");
	assert.equal(parsed.id, "google/gemma-4-31b");
	assert.equal(formatModelSelection(parsed), "mac-studio-lmstudio/google/gemma-4-31b");
});

test("resolveBoardroomModels inherits the current Pi model by default", () => {
	const config = createTestConfig();
	const models = resolveBoardroomModels(config, { provider: "openai-codex", id: "gpt-5.4" }, { env: {} });
	assert.deepEqual(models, {
		ceo: { provider: "openai-codex", id: "gpt-5.4", label: "openai-codex/gpt-5.4" },
		board: { provider: "openai-codex", id: "gpt-5.4", label: "openai-codex/gpt-5.4" },
	});
});

test("resolveBoardroomModels supports role-specific config and env overrides", () => {
	const config = createTestConfig();
	config.models = {
		default: "current",
		ceo: "openai-codex/gpt-5.4",
		board: { provider: "mac-studio-lmstudio", id: "google/gemma-4-31b" },
	};

	const configured = resolveBoardroomModels(config, { provider: "llama-cpp", id: "local" }, { env: {} });
	assert.equal(formatModelSelection(configured.ceo), "openai-codex/gpt-5.4");
	assert.equal(formatModelSelection(configured.board), "mac-studio-lmstudio/google/gemma-4-31b");

	const envOverridden = resolveBoardroomModels(config, { provider: "llama-cpp", id: "local" }, {
		env: { BOARDROOM_BOARD_MODEL: "openai-codex/gpt-5.4-mini" },
	});
	assert.equal(formatModelSelection(envOverridden.ceo), "openai-codex/gpt-5.4");
	assert.equal(formatModelSelection(envOverridden.board), "openai-codex/gpt-5.4-mini");
});
