import * as fs from "node:fs";
import * as path from "node:path";
import {
	BOARD_MEMBER_DEFINITIONS,
	type BoardMemberConfig,
	type BoardMemberKey,
	type MeetingConfig,
	boardMemberDefinitionFromDisplayName,
} from "./schema.js";

const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:\\/;
const COLOR_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isAbsoluteArtifactPath(value: string): boolean {
	return value.startsWith("/") || value.startsWith("~") || WINDOWS_DRIVE_PREFIX.test(value);
}

export function assertRelativeArtifactPath(value: string): void {
	if (!value || isAbsoluteArtifactPath(value) || path.isAbsolute(value)) {
		throw new Error(`Persisted artifact paths must be relative: ${value}`);
	}
}

export function resolveRepoPath(repoRootAbs: string, relPath: string): string {
	assertRelativeArtifactPath(relPath);
	return path.resolve(repoRootAbs, relPath);
}

export function toRepoRelative(repoRootAbs: string, inputPath: string): string {
	if (!inputPath) throw new Error("Cannot persist an empty artifact path");
	if (!path.isAbsolute(inputPath) && !isAbsoluteArtifactPath(inputPath)) {
		assertRelativeArtifactPath(inputPath);
		return normalizeArtifactPath(inputPath);
	}

	const normalizedRoot = path.resolve(repoRootAbs);
	const normalizedInput = path.resolve(inputPath);
	const relative = path.relative(normalizedRoot, normalizedInput);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Artifact path must stay inside the repository root: ${inputPath}`);
	}
	return normalizeArtifactPath(relative);
}

export function normalizeArtifactPath(value: string): string {
	return value.split(path.sep).join("/");
}

export function containsMachineLocalPath(value: string): boolean {
	return /(^|[\s"'`])(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value) || value.includes("process.cwd") || value.includes("cwd");
}

export function validateConfig(repoRootAbs: string, config: MeetingConfig): void {
	for (const configuredPath of Object.values(config.paths)) {
		assertRelativeArtifactPath(configuredPath);
	}

	if (config.board.length !== BOARD_MEMBER_DEFINITIONS.length) {
		throw new Error(`Expected ${BOARD_MEMBER_DEFINITIONS.length} board members, received ${config.board.length}`);
	}

	const seenKeys = new Set<BoardMemberKey>();
	for (const boardMember of config.board) {
		validateBoardMemberConfig(repoRootAbs, boardMember, seenKeys);
	}
}

function validateBoardMemberConfig(
	repoRootAbs: string,
	boardMember: BoardMemberConfig,
	seenKeys: Set<BoardMemberKey>,
): void {
	const definition = boardMemberDefinitionFromDisplayName(boardMember.name);
	if (!definition) throw new Error(`Unsupported board role configured: ${boardMember.name}`);
	if (seenKeys.has(definition.key)) throw new Error(`Duplicate board role configured: ${boardMember.name}`);
	seenKeys.add(definition.key);

	assertRelativeArtifactPath(boardMember.path);
	if (!COLOR_HEX_PATTERN.test(boardMember.color)) {
		throw new Error(`Invalid board color for ${boardMember.name}: ${boardMember.color}`);
	}
	if (boardMember.color.toLowerCase() !== definition.color) {
		throw new Error(
			`Board color for ${boardMember.name} must remain ${definition.color}, received ${boardMember.color}`,
		);
	}

	const promptAbsPath = resolveRepoPath(repoRootAbs, boardMember.path);
	if (!fs.existsSync(promptAbsPath)) {
		throw new Error(`Board prompt path does not exist for ${boardMember.name}: ${boardMember.path}`);
	}
}
