/**
 * Lyrics: LRC parsing + embedded-tag normalization. No network lyric APIs
 * anywhere — local files and sidecars only, per the local-first model.
 *
 * LRC grammar covered: [mm:ss.xx] (centisecond or millisecond precision),
 * multiple timestamps per line, [ti:]/[ar:]/[al:]/[offset:±ms] headers,
 * [00:00.00] metadata lines kept as plain lines only when they carry text.
 * Malformed lines are skipped, never fatal.
 */

export interface LyricLine {
	/** Seconds (offset header already applied). */
	t: number;
	text: string;
}

export interface ParsedLyrics {
	lines: LyricLine[];
	/** True when at least one timestamp was found (else plain text). */
	synced: boolean;
	title: string | null;
	artist: string | null;
}

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const HEADER = /^\s*\[(ti|ar|al|offset)\s*:\s*([^\]]*)\]\s*$/i;

function stampToSeconds(
	minutes: string,
	seconds: string,
	fraction: string | undefined,
): number | null {
	const m = Number(minutes);
	const s = Number(seconds);
	if (!Number.isFinite(m + s) || m < 0 || s < 0 || s >= 60) return null;
	let frac = 0;
	if (fraction !== undefined) {
		// 1–2 digits = centiseconds, 3 digits = milliseconds.
		const scale = fraction.length >= 3 ? 1000 : 100;
		const n = Number(fraction);
		if (!Number.isFinite(n)) return null;
		frac = n / scale;
	}
	return m * 60 + s + frac;
}

export function parseLrc(text: string): ParsedLyrics | null {
	if (typeof text !== "string" || text.trim() === "") return null;
	let title: string | null = null;
	let artist: string | null = null;
	let offsetMs = 0;
	const lines: LyricLine[] = [];
	let plain: string[] = [];
	let sawTimestamp = false;

	for (const rawLine of text.split(/\r?\n/)) {
		const header = HEADER.exec(rawLine);
		if (header?.[1] && header[2] !== undefined) {
			const kind = header[1].toLowerCase();
			const value = header[2].trim();
			if (kind === "ti" && value !== "") title = value;
			else if (kind === "ar" && value !== "") artist = value;
			else if (kind === "offset") {
				const ms = Number(value);
				if (Number.isFinite(ms)) offsetMs = ms;
			}
			continue;
		}
		const stamps: number[] = [];
		let match: RegExpExecArray | null;
		TIMESTAMP.lastIndex = 0;
		while ((match = TIMESTAMP.exec(rawLine)) !== null) {
			const seconds = stampToSeconds(match[1] ?? "", match[2] ?? "", match[3]);
			if (seconds !== null) stamps.push(seconds);
		}
		const lyricText = rawLine.replace(TIMESTAMP, "").trim();
		TIMESTAMP.lastIndex = 0;
		if (stamps.length === 0) {
			if (lyricText !== "") plain.push(lyricText);
			continue;
		}
		sawTimestamp = true;
		for (const stamp of stamps) {
			lines.push({ t: Math.max(0, stamp + offsetMs / 1000), text: lyricText });
		}
	}
	if (!sawTimestamp) {
		if (plain.length === 0) return null;
		return {
			lines: plain.map((text) => ({ t: 0, text })),
			synced: false,
			title,
			artist,
		};
	}
	lines.sort((a, b) => a.t - b.t);
	return { lines, synced: true, title, artist };
}

/**
 * Normalize an embedded tag payload (music-metadata ILyricsTag shape:
 * { text?, syncText?: [{ text, timestamp? }] }) to ParsedLyrics.
 * Defensive: unknown shapes yield null, never throw.
 */
export function normalizeEmbeddedLyrics(raw: unknown): ParsedLyrics | null {
	if (typeof raw !== "object" || raw === null) return null;
	const tags = Array.isArray(raw) ? raw : [raw];
	for (const tag of tags) {
		if (typeof tag !== "object" || tag === null) continue;
		const entry = tag as Record<string, unknown>;
		const sync = entry["syncText"];
		if (Array.isArray(sync) && sync.length > 0) {
			const lines: LyricLine[] = [];
			for (const item of sync) {
				if (typeof item !== "object" || item === null) continue;
				const row = item as Record<string, unknown>;
				const text = typeof row["text"] === "string" ? row["text"].trim() : "";
				const timestamp = row["timestamp"];
				const t =
					typeof timestamp === "number" && Number.isFinite(timestamp)
						? timestamp / 1000
						: null;
				if (text === "" || t === null) continue;
				lines.push({ t: Math.max(0, t), text });
			}
			if (lines.length > 0) {
				lines.sort((a, b) => a.t - b.t);
				return { lines, synced: true, title: null, artist: null };
			}
		}
		const text = entry["text"];
		if (typeof text === "string" && text.trim() !== "") {
			return {
				lines: text
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter((line) => line !== "")
					.map((line) => ({ t: 0, text: line })),
				synced: false,
				title: null,
				artist: null,
			};
		}
	}
	return null;
}

/** Active lyric line index at a playback position (last line ≤ t). */
export function activeLyricIndex(lines: LyricLine[], t: number): number {
	let active = -1;
	for (let i = 0; i < lines.length; i++) {
		if ((lines[i]?.t ?? Infinity) <= t + 1e-9) active = i;
		else break;
	}
	return active;
}
