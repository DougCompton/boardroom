#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(cliPath), "..", "..");
const packageName = "@justynclark/boardroom";
const extensionPath = path.join(packageRoot, "dist", "apps", "ceo", "extensions", "ceo-and-board.js");
const packagePiDir = path.join(packageRoot, ".pi");
const packageSmallDir = path.join(packageRoot, ".small");

function toPosix(relativePath: string): string {
	return relativePath.split(path.sep).join("/");
}

function printHelp(): void {
	console.log(`Boardroom CLI

Usage:
  boardroom init [target-dir] [--force]
  boardroom start [-- <pi args...>]
  boardroom help

Commands:
  init   Copy the bundled Boardroom .pi and .small assets into a project.
  start  Launch Pi with the Boardroom extension from this package.

Examples:
  boardroom init
  boardroom init ./strategy-room
  boardroom start
  boardroom start -- --model claude-sonnet-4-6
`);
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function ensureFileExists(targetPath: string, label: string): Promise<void> {
	if (!(await pathExists(targetPath))) {
		throw new Error(`${label} not found at ${targetPath}`);
	}
}

function resolvePiBinary(): string {
	const executable = process.platform === "win32" ? "pi.cmd" : "pi";
	const candidates = [
		path.join(process.cwd(), "node_modules", ".bin", executable),
		path.join(packageRoot, "node_modules", ".bin", executable),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return executable;
}

async function copyDirectory(from: string, to: string): Promise<void> {
	await fs.cp(from, to, {
		recursive: true,
		errorOnExist: true,
		force: false,
		verbatimSymlinks: false,
	});
}

async function rewritePiSettings(targetRoot: string): Promise<void> {
	const settingsPath = path.join(targetRoot, ".pi", "settings.json");
	const raw = await fs.readFile(settingsPath, "utf8");
	const settings = JSON.parse(raw) as {
		extensions?: string[];
		[key: string]: unknown;
	};
	const relativeExtensionPath = toPosix(path.relative(path.dirname(settingsPath), extensionPath));
	settings.extensions = [relativeExtensionPath];
	await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function initProject(targetArg: string | undefined, force: boolean): Promise<void> {
	const targetRoot = path.resolve(targetArg ?? ".");
	const piTarget = path.join(targetRoot, ".pi");
	const smallTarget = path.join(targetRoot, ".small");

	await ensureFileExists(packagePiDir, "Bundled .pi assets");
	await ensureFileExists(packageSmallDir, "Bundled .small assets");
	await ensureFileExists(extensionPath, "Compiled Boardroom extension");

	const collisions: string[] = [];
	for (const candidate of [piTarget, smallTarget]) {
		if (await pathExists(candidate)) collisions.push(path.relative(targetRoot, candidate) || candidate);
	}
	if (collisions.length > 0 && !force) {
		throw new Error(
			`Refusing to overwrite existing ${collisions.join(", ")}. Re-run with --force if you want to replace them.`,
		);
	}

	if (force) {
		await fs.rm(piTarget, { recursive: true, force: true });
		await fs.rm(smallTarget, { recursive: true, force: true });
	}

	await fs.mkdir(targetRoot, { recursive: true });
	await copyDirectory(packagePiDir, piTarget);
	await copyDirectory(packageSmallDir, smallTarget);
	await rewritePiSettings(targetRoot);

	console.log(`Initialized Boardroom in ${targetRoot}`);
	console.log("Next steps:");
	console.log(`  cd ${targetRoot}`);
	console.log("  boardroom start");
	console.log("  # or run `pi` if you want Pi to use the generated .pi/settings.json");
}

async function runPi(extraArgs: string[]): Promise<number> {
	await ensureFileExists(extensionPath, "Compiled Boardroom extension");
	const piBinary = resolvePiBinary();
	const args = ["-e", extensionPath, ...extraArgs];

	return await new Promise<number>((resolve, reject) => {
		const child = spawn(piBinary, args, {
			cwd: process.cwd(),
			stdio: "inherit",
			env: process.env,
		});

		child.on("error", (error) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				reject(
					new Error(
						`Pi CLI was not found. Install ${packageName} dependencies with npm install, or add pi to PATH.`,
					),
				);
				return;
			}
			reject(error);
		});

		child.on("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`Pi exited from signal ${signal}`));
				return;
			}
			resolve(code ?? 0);
		});
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "start") {
		const extraArgs = !command ? args : args.slice(1).filter((arg) => arg !== "--");
		process.exitCode = await runPi(extraArgs);
		return;
	}

	if (command === "init") {
		const rest = args.slice(1);
		const force = rest.includes("--force");
		const targetArg = rest.find((arg) => arg !== "--force");
		await initProject(targetArg, force);
		return;
	}

	if (command === "help" || command === "--help" || command === "-h") {
		printHelp();
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
