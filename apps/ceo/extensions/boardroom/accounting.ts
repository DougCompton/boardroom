export function parseBudget(value: string | number): number {
	if (typeof value === "number") return value;
	const parsed = Number.parseFloat(String(value).replace(/[^0-9.]+/g, ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

export function usdToMicros(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return roundHalfAwayFromZero(value * 1_000_000);
}

export function microsToUsd(value: number): number {
	return value / 1_000_000;
}

export function sumMicros(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

export function formatUsdFromMicros(micros: number): string {
	const roundedCents = roundHalfAwayFromZero(micros / 10_000);
	const absolute = Math.abs(roundedCents);
	const dollars = (absolute / 100).toFixed(2);
	return roundedCents < 0 ? `-$${dollars}` : `$${dollars}`;
}

export function formatDurationFromMs(milliseconds: number): string {
	return `${(milliseconds / 60_000).toFixed(1)} minutes`;
}

export function elapsedMsFromIso(startedAt: string, closedAt: string): number {
	const delta = Date.parse(closedAt) - Date.parse(startedAt);
	return Math.max(0, Number.isFinite(delta) ? delta : 0);
}

function roundHalfAwayFromZero(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value === 0) return 0;
	return value > 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}
