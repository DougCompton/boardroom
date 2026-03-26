import { formatDurationFromMs, formatUsdFromMicros } from "./accounting.js";
import type { FinalMemoInput } from "./schema.js";

export function renderMemo(input: FinalMemoInput): string {
	const durationText = formatDurationFromMs(input.elapsed_ms);
	const costText = formatUsdFromMicros(input.cost_usd_micros);
	const boardMembers = input.board_members.map((member) => member.display_name);
	const voteLines = input.board_members.map((member) => `| ${member.display_name} | ${capitalize(member.vote)} |`);
	const boardPositionSections = input.board_members
		.map((member) => `### ${member.display_name}\n\n${member.position_markdown.trim() || "_No position captured._"}`)
		.join("\n\n");

	const frontmatter = [
		"---",
		`artifact_version: "${input.artifact_version}"`,
		`run_id: "${input.run_id}"`,
		`brief_id: "${input.brief_id}"`,
		`status: "${input.status}"`,
		`started_at: "${input.started_at}"`,
		`closed_at: "${input.closed_at}"`,
		`duration: "${durationText}"`,
		`budget_used: "${costText}"`,
		"board_members:",
		...boardMembers.map((member) => `  - "${member}"`),
		`brief: "${input.relative_paths.brief}"`,
		`transcript: "${input.relative_paths.transcript}"`,
		`memo: "${input.relative_paths.memo}"`,
		"---",
		"",
	].join("\n");

	const body = [
		`# Board Memo: ${input.brief_id}`,
		"",
		"## Session",
		`- Artifact Version: ${input.artifact_version}`,
		`- Run ID: ${input.run_id}`,
		`- Brief ID: ${input.brief_id}`,
		`- Status: ${input.status}`,
		`- Started: ${input.started_at}`,
		`- Closed: ${input.closed_at}`,
		`- Duration: ${durationText}`,
		`- Deliberation Cost: ${costText}`,
		`- Brief Path: ${input.relative_paths.brief}`,
		`- Transcript Path: ${input.relative_paths.transcript}`,
		"",
		"## Decision",
		input.decision.trim(),
		"",
		"## Board Vote",
		"",
		"| Seat | Vote |",
		"|------|------|",
		...voteLines,
		"",
		`Result: ${input.vote_summary.accept} accept / ${input.vote_summary.reject} reject / ${input.vote_summary.defer} defer / ${input.vote_summary.other} other`,
		"",
		"## Recommendation Rationale",
		input.narrative.rationale_markdown.trim(),
		"",
		"## Conditions / Risks",
		input.narrative.conditions_markdown.trim(),
		"",
		"## Immediate Next Moves",
		input.narrative.next_moves_markdown.trim(),
		"",
		"## Final Board Positions",
		"",
		boardPositionSections,
		"",
	].join("\n");

	return `${frontmatter}${body.trim()}\n`;
}

function capitalize(value: string): string {
	return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}
