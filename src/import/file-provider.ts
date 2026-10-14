/**
 * FileImportProvider: fully-local playlist import from user files.
 * Supported: M3U/M3U8 (incl. #EXTINF), CSV (header-detected), and the
 * documented JSON playlist shape. Everything runs on-device; nothing is
 * uploaded. Malformed input fails with a reason, never a partial import.
 */

import type {
	ExternalPlaylist,
	ExternalTrack,
	ImportProviderId,
} from "./model";

export class PlaylistFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlaylistFileError";
	}
}

const PROVIDER: ImportProviderId = "file";

/** Only http(s) URLs survive; anything else (file:, javascript:) is dropped. */
export function cleanUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	try {
		const u = new URL(trimmed);
		if (u.protocol === "https:" || u.protocol === "http:") return u.href;
		return null;
	} catch {
		return null;
	}
}

function parseDurationSec(raw: string): number | null {
	const t = raw.trim();
	if (t === "") return null;
	if (/^\d+(\.\d+)?$/.test(t)) {
		const v = Number(t);
		return Number.isFinite(v) && v > 0 ? v : null;
	}
	const parts = t.split(":").map(Number);
	if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
	let total = 0;
	for (const p of parts) total = total * 60 + p;
	return total > 0 ? total : null;
}

/** Split "Artist - Title" (common in M3U EXTINF and filenames). */
export function splitArtistTitle(text: string): {
	artist: string;
	title: string;
} {
	const m = text.match(/^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/);
	if (m?.[1] && m?.[2]) return { artist: m[1], title: m[2] };
	return { artist: "", title: text.trim() };
}

function fileStem(path: string): string {
	const base = path.split(/[\\/]/).pop() ?? path;
	return base.replace(/\.[^.]+$/, "").trim();
}

function extOf(fileName: string): string {
	return (fileName.split(".").pop() ?? "").toLowerCase();
}

export function detectPlaylistFormat(fileName: string): "m3u" | "csv" | "json" {
	const ext = extOf(fileName);
	if (ext === "m3u" || ext === "m3u8") return "m3u";
	if (ext === "csv" || ext === "txt") return "csv";
	if (ext === "json") return "json";
	throw new PlaylistFileError(
		`Unsupported playlist file ".${ext}". Use .m3u/.m3u8, .csv, or .json.`,
	);
}

function splitCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i += 1;
				} else quoted = false;
			} else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === "," || c === ";" || c === "\t") {
			out.push(cur.trim());
			cur = "";
		} else cur += c;
	}
	out.push(cur.trim());
	return out;
}

const CSV_ALIASES: Record<string, string[]> = {
	title: ["title", "track", "name", "song"],
	artist: ["artist", "artists", "performer"],
	album: ["album", "record"],
	duration: ["duration", "length", "time", "duration_sec", "durationsec"],
	isrc: ["isrc"],
	url: ["url", "link"],
};

function mapCsvColumns(header: string[]): Record<string, number> {
	const map: Record<string, number> = {};
	header.forEach((h, i) => {
		const key = h.trim().toLowerCase();
		for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
			if (aliases.includes(key) && map[field] === undefined) map[field] = i;
		}
	});
	return map;
}

function parseM3U(text: string, fileName: string): ExternalTrack[] {
	const tracks: ExternalTrack[] = [];
	const lines = text.split(/\r?\n/);
	let pending: { title: string; duration: number | null } | null = null;
	let position = 0;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line === "") continue;
		if (line.startsWith("#EXTINF:")) {
			const rest = line.slice("#EXTINF:".length);
			const comma = rest.indexOf(",");
			const dur = comma >= 0 ? Number(rest.slice(0, comma).trim()) : NaN;
			const title = comma >= 0 ? rest.slice(comma + 1).trim() : "";
			pending = {
				title,
				duration: Number.isFinite(dur) && dur > 0 ? dur : null,
			};
			continue;
		}
		if (line.startsWith("#")) continue;
		// A media line: local path or stream URL. Stream audio is never
		// downloaded — the URL is kept as a metadata reference only.
		const url = cleanUrl(line);
		const stem = fileStem(line);
		const { artist, title } = pending?.title
			? splitArtistTitle(pending.title)
			: splitArtistTitle(stem);
		tracks.push({
			provider: PROVIDER,
			externalId: url ?? `file:${stem}`,
			title: title || stem,
			artists: artist ? [artist] : [],
			album: null,
			durationSec: pending?.duration ?? null,
			isrc: null,
			trackNumber: null,
			sourceUrl: url,
			position: position++,
		});
		pending = null;
	}
	if (tracks.length === 0) {
		throw new PlaylistFileError(`"${fileName}" contains no playlist entries.`);
	}
	return tracks;
}

function parseCSV(text: string, fileName: string): ExternalTrack[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
	if (lines.length === 0) {
		throw new PlaylistFileError(`"${fileName}" is empty.`);
	}
	const hasHeader =
		/[a-zA-Z]/.test(lines[0] ?? "") && !/^\d/.test(lines[0] ?? "");
	const header = hasHeader ? splitCsvLine(lines[0] ?? "") : [];
	const columns = hasHeader ? mapCsvColumns(header) : {};
	if (
		hasHeader &&
		columns["title"] === undefined &&
		columns["artist"] === undefined
	) {
		throw new PlaylistFileError(
			`"${fileName}" needs at least a title or artist column (found: ${header.join(", ") || "none"}).`,
		);
	}
	const rows = hasHeader ? lines.slice(1) : lines;
	const tracks: ExternalTrack[] = [];
	rows.forEach((row, i) => {
		const cells = splitCsvLine(row);
		const at = (key: string): string => {
			const idx =
				columns[key] ?? (key === "title" ? 0 : key === "artist" ? 1 : -1);
			return idx >= 0 ? (cells[idx] ?? "") : "";
		};
		const title = at("title").trim();
		const artist = at("artist").trim();
		if (title === "" && artist === "") return; // skip blank rows
		const artists = artist
			? artist
					.split(/\s*[;&]\s*|\s+and\s+/i)
					.map((a) => a.trim())
					.filter(Boolean)
			: [];
		tracks.push({
			provider: PROVIDER,
			externalId: `csv:${i}`,
			title: title || "Untitled",
			artists,
			album: at("album").trim() || null,
			durationSec: parseDurationSec(at("duration")),
			isrc: at("isrc").trim() || null,
			trackNumber: null,
			sourceUrl: cleanUrl(at("url")),
			position: tracks.length,
		});
	});
	if (tracks.length === 0) {
		throw new PlaylistFileError(`"${fileName}" contains no playlist rows.`);
	}
	return tracks;
}

interface JsonPlaylistShape {
	name?: unknown;
	description?: unknown;
	tracks?: unknown;
}

function parseJSON(
	text: string,
	fileName: string,
): {
	name: string;
	description: string | null;
	tracks: ExternalTrack[];
} {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new PlaylistFileError(`"${fileName}" is not valid JSON.`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new PlaylistFileError(
			`"${fileName}" must be an object like {"name": ..., "tracks": [{title, artist}]}.`,
		);
	}
	const v = raw as JsonPlaylistShape;
	if (!Array.isArray(v.tracks) || v.tracks.length === 0) {
		throw new PlaylistFileError(`"${fileName}" has no "tracks" array.`);
	}
	const tracks: ExternalTrack[] = [];
	v.tracks.forEach((item, i) => {
		if (typeof item !== "object" || item === null) {
			throw new PlaylistFileError(
				`"${fileName}" track ${i + 1} must be an object.`,
			);
		}
		const t = item as Record<string, unknown>;
		const title = typeof t["title"] === "string" ? t["title"].trim() : "";
		const artistRaw = t["artist"] ?? t["artists"] ?? "";
		const artists = (
			Array.isArray(artistRaw)
				? artistRaw.filter((a): a is string => typeof a === "string")
				: typeof artistRaw === "string"
					? [artistRaw]
					: []
		)
			.map((a) => a.trim())
			.filter(Boolean);
		if (title === "" && artists.length === 0) {
			throw new PlaylistFileError(
				`"${fileName}" track ${i + 1} needs a title or artist.`,
			);
		}
		tracks.push({
			provider: PROVIDER,
			externalId:
				typeof t["id"] === "string" && t["id"] ? t["id"] : `json:${i}`,
			title: title || "Untitled",
			artists,
			album: typeof t["album"] === "string" ? t["album"] : null,
			durationSec:
				typeof t["duration"] === "number" && t["duration"] > 0
					? t["duration"]
					: typeof t["duration"] === "string"
						? parseDurationSec(t["duration"])
						: null,
			isrc: typeof t["isrc"] === "string" ? t["isrc"] : null,
			trackNumber:
				typeof t["trackNumber"] === "number" ? t["trackNumber"] : null,
			sourceUrl: typeof t["url"] === "string" ? cleanUrl(t["url"]) : null,
			position: tracks.length,
		});
	});
	return {
		name:
			typeof v["name"] === "string" && v["name"].trim()
				? v["name"].trim()
				: fileName.replace(/\.[^.]+$/, ""),
		description: typeof v["description"] === "string" ? v["description"] : null,
		tracks,
	};
}

/** Parse a user playlist file into provider-neutral metadata. */
export function parsePlaylistFile(
	text: string,
	fileName: string,
	importedAt = Date.now(),
): ExternalPlaylist {
	const format = detectPlaylistFormat(fileName);
	const stem = fileName.replace(/\.[^.]+$/, "");
	// Identity is the file name, NOT a content hash: re-importing an edited
	// file with the same name diffs as an update (added/removed), which is
	// the useful behavior. Same-named unrelated files share identity — the
	// UI offers "create copy" for that case.
	const externalId = `file:${stem}`;
	if (format === "json") {
		const parsed = parseJSON(text, fileName);
		return {
			provider: PROVIDER,
			externalId,
			name: parsed.name,
			description: parsed.description,
			owner: null,
			sourceUrl: null,
			importedAt,
			tracks: parsed.tracks,
		};
	}
	const tracks =
		format === "m3u" ? parseM3U(text, fileName) : parseCSV(text, fileName);
	return {
		provider: PROVIDER,
		externalId,
		name: stem,
		description: null,
		owner: null,
		sourceUrl: null,
		importedAt,
		tracks,
	};
}
