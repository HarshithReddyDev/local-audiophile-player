/**
 * CUE sheet parser (standalone .cue files + embedded cuesheets later).
 * Grammar covered: REM comments, PERFORMER/TITLE (global + per-track),
 * FILE "…" <type>, TRACK nn AUDIO, INDEX 00/01 mm:ss:ff (75 fps).
 * Everything else is ignored (never an error). Times clamp to ≥ 0;
 * endSec of a track is the next track's start, last track runs to EOF
 * (null endSec — the controller stops at file end naturally).
 */

export interface CueTrackEntry {
	number: number;
	title: string | null;
	performer: string | null;
	/** Pregap/index-00 start, seconds. Null when absent. */
	pauseStartSec: number | null;
	/** Index-01 start, seconds. */
	startSec: number;
	/** Next track's start, or null for the last track. */
	endSec: number | null;
}

export interface ParsedCueSheet {
	/** FILE "…" operand as written (matched case-insensitively on import). */
	audioFileName: string | null;
	title: string | null;
	performer: string | null;
	tracks: CueTrackEntry[];
	warnings: string[];
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** mm:ss:ff (frames at 75 fps) → seconds; null when malformed. */
export function cueTimeToSeconds(stamp: string): number | null {
	const match = stamp.trim().match(/^(\d+):([0-5]?\d):([0-7]?\d)$/);
	if (!match?.[1] || !match[2] || !match[3]) return null;
	const minutes = Number(match[1]);
	const seconds = Number(match[2]);
	const frames = Number(match[3]);
	if (!Number.isFinite(minutes + seconds + frames)) return null;
	return Math.max(0, minutes * 60 + seconds + frames / 75);
}

export function parseCueSheet(text: string): ParsedCueSheet | null {
	if (typeof text !== "string" || text.trim() === "") return null;
	const warnings: string[] = [];
	let audioFileName: string | null = null;
	let title: string | null = null;
	let performer: string | null = null;
	const tracks: CueTrackEntry[] = [];
	let current: {
		number: number;
		title: string | null;
		performer: string | null;
		index00: number | null;
		index01: number | null;
	} | null = null;

	const finishTrack = (): void => {
		if (!current || current.index01 === null) {
			if (current) {
				warnings.push(
					`Track ${current.number} has no INDEX 01 and was skipped.`,
				);
			}
			current = null;
			return;
		}
		tracks.push({
			number: current.number,
			title: current.title,
			performer: current.performer,
			pauseStartSec: current.index00,
			startSec: current.index01,
			endSec: null,
		});
		current = null;
	};

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "") continue;
		const upper = line.toUpperCase();
		if (upper.startsWith("REM ")) continue;
		if (upper.startsWith("FILE ")) {
			const match = /^FILE\s+(.+?)\s+\S+\s*$/i.exec(line);
			if (match?.[1]) audioFileName = unquote(match[1]);
			continue;
		}
		if (upper.startsWith("TRACK ")) {
			finishTrack();
			const match = /^TRACK\s+(\d+)\s+(\S+)/i.exec(line);
			if (!match?.[1]) {
				warnings.push(`Skipped malformed TRACK line: "${line.slice(0, 60)}".`);
				continue;
			}
			current = {
				number: Number(match[1]),
				title: null,
				performer: null,
				index00: null,
				index01: null,
			};
			continue;
		}
		if (upper.startsWith("TITLE ")) {
			const value = unquote(line.slice(6)) || null;
			if (current) current.title = value;
			else title = value;
			continue;
		}
		if (upper.startsWith("PERFORMER ")) {
			const value = unquote(line.slice(10)) || null;
			if (current) current.performer = value;
			else performer = value;
			continue;
		}
		if (upper.startsWith("INDEX ")) {
			if (!current) continue;
			const match = /^INDEX\s+(0\d|\d+)\s+(\S+)/i.exec(line);
			if (!match?.[1] || !match[2]) continue;
			const seconds = cueTimeToSeconds(match[2]);
			if (seconds === null) {
				warnings.push(
					`Track ${current.number} has a malformed INDEX and may mistime.`,
				);
				continue;
			}
			if (match[1] === "01") current.index01 = seconds;
			else if (match[1] === "00" && current.index00 === null)
				current.index00 = seconds;
			continue;
		}
	}
	finishTrack();
	if (tracks.length === 0) return null;
	tracks.sort((a, b) => a.startSec - b.startSec || a.number - b.number);
	for (let i = 0; i < tracks.length - 1; i++) {
		const next = tracks[i + 1];
		const entry = tracks[i];
		if (entry && next) entry.endSec = next.startSec;
	}
	return { audioFileName, title, performer, tracks, warnings };
}
