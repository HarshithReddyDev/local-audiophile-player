/**
 * Measurement/target text parser with format detection. Handles the layouts
 * seen in the wild (AutoEQ `frequency,raw`, squiglink exports, REW exports,
 * bare whitespace tables) without depending on any single website:
 *
 *   File → detect delimiter/columns → parse rows → validate → normalize
 *
 * Failures throw CurveParseError with line numbers and reasons — never
 * silent data loss.
 */

import type { CurveChannel, ResponseCurve } from "./curves";
import { normalizeCurve } from "./curves";

export class CurveParseError extends Error {
	readonly line: number | null;
	constructor(message: string, line: number | null = null) {
		super(line == null ? message : `line ${line}: ${message}`);
		this.name = "CurveParseError";
		this.line = line;
	}
}

export interface ParsedCurve {
	channel: CurveChannel;
	curve: ResponseCurve;
	columns: { frequency: string | null; response: string | null };
}

export interface ParsedCurveFile {
	curves: ParsedCurve[];
	warnings: string[];
	format: string;
}

const COMMENTS = ["#", "*", '"', "//", ";", "!"];

function isComment(line: string): boolean {
	const trimmed = line.trimStart();
	return COMMENTS.some((marker) => trimmed.startsWith(marker));
}

function sniffDelimiter(lines: string[]): { delimiter: RegExp; name: string } {
	const candidates: { re: RegExp; name: string; pattern: RegExp }[] = [
		{ re: /,/, name: "comma", pattern: /,/ },
		{ re: /\t/, name: "tab", pattern: /\t/ },
		{ re: /;/, name: "semicolon", pattern: /;/ },
	];
	let best: { name: string; score: number } = { name: "whitespace", score: 0 };
	for (const candidate of candidates) {
		let score = 0;
		for (const line of lines.slice(0, 5)) {
			const parts = line.split(candidate.pattern).length;
			if (parts >= 2) score += parts;
		}
		if (score > best.score) best = { name: candidate.name, score };
	}
	switch (best.name) {
		case "comma":
			return { delimiter: /,/, name: "comma-separated" };
		case "tab":
			return { delimiter: /\t/, name: "tab-separated" };
		case "semicolon":
			return { delimiter: /;/, name: "semicolon-separated" };
		default:
			return { delimiter: /\s+/, name: "whitespace-separated" };
	}
}

function toNumber(cell: string): number | null {
	const trimmed = cell.trim().replace(",", ".");
	if (trimmed === "" || trimmed === "-" || trimmed === ".") return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

function headerIndex(cells: string[], names: string[]): number {
	for (let i = 0; i < cells.length; i++) {
		const cell = (cells[i] ?? "").trim().toLowerCase();
		if (names.some((name) => cell === name || cell.includes(name))) return i;
	}
	return -1;
}

/**
 * Parse curve text. Returns one curve per response channel found
 * (stereo L/R exports yield two). Throws CurveParseError on malformed input.
 */
export function parseCurveText(
	text: string,
	sourceName: string,
): ParsedCurveFile {
	const lines = text.split(/\r?\n/);
	const dataLines: { line: number; text: string }[] = [];
	lines.forEach((raw, index) => {
		if (raw.trim() === "" || isComment(raw)) return;
		dataLines.push({ line: index + 1, text: raw });
	});
	if (dataLines.length === 0) {
		throw new CurveParseError(`"${sourceName}" contains no data rows`, null);
	}
	const { delimiter, name: format } = sniffDelimiter(
		dataLines.map((l) => l.text),
	);
	const rows = dataLines.map(({ line, text: row }) => ({
		line,
		// Keep empty cells: positions must hold so missing values skip the row.
		cells: row.split(delimiter).map((c) => c.trim()),
	}));

	// Header detection: first row with a non-numeric cell while other rows parse.
	let header: string[] | null = null;
	const first = rows[0];
	if (first && first.cells.some((c) => toNumber(c) === null)) {
		header = first.cells;
		rows.shift();
	}
	if (rows.length === 0) {
		throw new CurveParseError(
			`"${sourceName}" has a header but no data rows`,
			null,
		);
	}
	const width = Math.max(...rows.map((r) => r.cells.length));
	if (width < 2) {
		throw new CurveParseError(
			`"${sourceName}" needs at least frequency + response columns (found ${width})`,
			rows[0]?.line ?? null,
		);
	}

	const freqCol = header ? Math.max(0, headerIndex(header, ["freq", "hz"])) : 0;

	// Response column mapping. Stereo L/R (or ch1/ch2) exports → two curves.
	const responseCols: {
		index: number;
		channel: CurveChannel;
		label: string | null;
	}[] = [];
	if (header) {
		const left = headerIndex(header, ["left", " ch1", "ch 1", "(l)"]);
		const right = headerIndex(header, ["right", "ch2", "ch 2", "(r)"]);
		const leftExact = header.findIndex((c) =>
			["l", "left"].includes(c.trim().toLowerCase()),
		);
		const rightExact = header.findIndex((c) =>
			["r", "right"].includes(c.trim().toLowerCase()),
		);
		const lIdx = leftExact !== -1 ? leftExact : left;
		const rIdx = rightExact !== -1 ? rightExact : right;
		if (
			lIdx !== -1 &&
			rIdx !== -1 &&
			lIdx !== rIdx &&
			lIdx !== freqCol &&
			rIdx !== freqCol
		) {
			responseCols.push(
				{ index: lIdx, channel: "left", label: header[lIdx] ?? null },
				{ index: rIdx, channel: "right", label: header[rIdx] ?? null },
			);
		}
	}
	if (responseCols.length === 0) {
		let responseCol = -1;
		let responseLabel: string | null = null;
		if (header) {
			for (const name of [
				"raw",
				"spl",
				"db",
				"magnitude",
				"gain",
				"response",
				"amplitude",
			]) {
				const idx = headerIndex(header, [name]);
				if (idx !== -1 && idx !== freqCol) {
					responseCol = idx;
					responseLabel = header[idx] ?? null;
					break;
				}
			}
		}
		if (responseCol === -1) {
			responseCol = freqCol === 0 ? 1 : 0;
		}
		responseCols.push({
			index: responseCol,
			channel: "unknown",
			label: responseLabel,
		});
	}

	const warnings: string[] = [];
	const curves: ParsedCurve[] = [];
	for (const { index, channel, label } of responseCols) {
		const frequencies: number[] = [];
		const gains: number[] = [];
		let skipped = 0;
		let firstSkipped: number | null = null;
		for (const row of rows) {
			const f = toNumber(row.cells[freqCol] ?? "");
			const g = toNumber(row.cells[index] ?? "");
			if (f === null || g === null) {
				skipped += 1;
				firstSkipped ??= row.line;
				continue;
			}
			frequencies.push(f);
			gains.push(g);
		}
		if (skipped > 0) {
			warnings.push(
				`${skipped} unparseable row${skipped === 1 ? "" : "s"} skipped (first at line ${firstSkipped})`,
			);
		}
		const normalized = normalizeCurve(frequencies, gains);
		if ("error" in normalized) {
			throw new CurveParseError(`"${sourceName}": ${normalized.error}`, null);
		}
		curves.push({
			channel,
			curve: normalized.curve,
			columns: {
				frequency: header?.[freqCol] ?? null,
				response: label,
			},
		});
	}
	return { curves, warnings, format };
}
