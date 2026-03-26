import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { writeJsonArtifactAtomic } from "../../apps/ceo/extensions/boardroom/state.js";
import { createTempRepo } from "./helpers.js";

test("interrupted atomic write leaves the previous valid json artifact in place", async () => {
	const tempRepo = await createTempRepo();
	try {
		const filePath = path.join(tempRepo.repoRoot, "artifact.json");
		await fsp.writeFile(filePath, `${JSON.stringify({ version: 1 }, null, 2)}\n`, "utf8");

		await assert.rejects(() =>
			writeJsonArtifactAtomic(filePath, { version: 2 }, { before_rename: () => Promise.reject(new Error("boom")) }),
		);

		const source = await fsp.readFile(filePath, "utf8");
		assert.deepEqual(JSON.parse(source), { version: 1 });
	} finally {
		await tempRepo.cleanup();
	}
});

test("successful atomic rename leaves a valid final artifact", async () => {
	const tempRepo = await createTempRepo();
	try {
		const filePath = path.join(tempRepo.repoRoot, "artifact.json");
		await writeJsonArtifactAtomic(filePath, { version: 2, ok: true });
		const source = await fsp.readFile(filePath, "utf8");
		assert.deepEqual(JSON.parse(source), { version: 2, ok: true });
	} finally {
		await tempRepo.cleanup();
	}
});
