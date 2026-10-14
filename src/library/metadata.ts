/**
 * Tag reading for local files. Runs off the React render path (async, called
 * from the scanner) and never throws: unparseable files fall back to
 * filename-derived metadata so the track still plays.
 */
import type { ArtworkPayload, Track } from "../types/library";
import { makeTrack, newId } from "../types/library";

function basename(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function toFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** IRatio { dB } or plain number → dB, else null. */
function ratioDb(value: unknown): number | null {
	if (typeof value === "number") return toFiniteNumber(value);
	if (typeof value === "object" && value !== null) {
		return toFiniteNumber((value as { dB?: unknown }).dB);
	}
	return null;
}

/** IRatio { ratio } or plain number → linear peak, else null. */
function ratioPeak(value: unknown): number | null {
	if (typeof value === "number") return value > 0 ? value : null;
	if (typeof value === "object" && value !== null) {
		const ratio = (value as { ratio?: unknown }).ratio;
		return typeof ratio === "number" && ratio > 0 ? ratio : null;
	}
	return null;
}

/**
 * Embedded lyrics (ID3 USLT/SYLT via music-metadata ILyricsTag):
 * synchronized lines preferred, plain text otherwise, null when absent.
 * Defensive against unknown shapes — never throws.
 */
function embeddedLyrics(raw: unknown): Exclude<Track["lyrics"], undefined> {
	if (!Array.isArray(raw)) return null;
	for (const tag of raw) {
		if (typeof tag !== "object" || tag === null) continue;
		const entry = tag as Record<string, unknown>;
		const sync = entry["syncText"];
		if (Array.isArray(sync) && sync.length > 0) {
			const lines: { t: number; text: string }[] = [];
			for (const item of sync) {
				if (typeof item !== "object" || item === null) continue;
				const row = item as Record<string, unknown>;
				const text = typeof row["text"] === "string" ? row["text"].trim() : "";
				const timestamp = row["timestamp"];
				if (text === "" || typeof timestamp !== "number") continue;
				if (!Number.isFinite(timestamp)) continue;
				lines.push({ t: Math.max(0, timestamp / 1000), text });
			}
			if (lines.length > 0) {
				lines.sort((a, b) => a.t - b.t);
				return { plain: null, synced: lines, source: "embedded" };
			}
		}
		const text = entry["text"];
		if (typeof text === "string" && text.trim() !== "") {
			return { plain: text.trim(), synced: null, source: "embedded" };
		}
	}
	return null;
}

/** Best-effort track when tags are missing or unreadable. */
export function fallbackTrack(file: File): Track {
	return makeTrack({
		id: newId("track"),
		title: basename(file.name),
		fileName: file.name,
		fileType: file.type,
		fileSize: file.size,
		mtime: file.lastModified,
	});
}

/**
 * Tag parse result. Artwork travels separately from the track so the artwork
 * cache (content-hash dedupe, downscale, Blob persistence) owns the bytes
 * while the track only carries the resulting artworkId. The track id here is
 * temporary — the library service replaces it with a stable identity.
 */
export interface ParsedAudio {
	track: Track;
	artwork: ArtworkPayload | null;
}

/**
 * Parse tags + embedded artwork. Never throws: unparseable files fall back
 * to filename-derived metadata so the track still plays. Duration is left
 * null — the media element reports authoritative duration on loadedmetadata.
 */
export async function parseFileMetadata(file: File): Promise<ParsedAudio> {
	const base = fallbackTrack(file);
	try {
		// Dynamic import keeps the ~300KB parser out of the initial chunk;
		// it loads on first file import instead of first paint.
		const { parseBlob } = await import("music-metadata");
		const metadata = await parseBlob(file, { duration: false });
		const common = metadata.common;
		let artwork: ArtworkPayload | null = null;
		const picture = common.picture?.[0];
		if (picture?.data) {
			const bytes = picture.data as Uint8Array;
			artwork = {
				bytes: new Uint8Array(bytes),
				mime: picture.format || "image/jpeg",
			};
		}
		const genre = Array.isArray(common.genre)
			? common.genre.filter((g: string) => g.trim() !== "")
			: [];
		return {
			track: {
				...base,
				title: common.title?.trim() || base.title,
				artist: common.artist?.trim() || "Unknown artist",
				album: common.album?.trim() || "Unknown album",
				albumArtist:
					common.albumartist?.trim() ||
					common.artist?.trim() ||
					"Unknown artist",
				trackNumber: toFiniteNumber(common.track.no),
				discNumber: toFiniteNumber(common.disk.no),
				year: toFiniteNumber(common.year),
				genre,
				audioInfo: {
					sampleRate: toFiniteNumber(metadata.format.sampleRate),
					channels: toFiniteNumber(metadata.format.numberOfChannels),
					bitrate: toFiniteNumber(metadata.format.bitrate),
					bitsPerSample: toFiniteNumber(metadata.format.bitsPerSample),
					codec:
						typeof metadata.format.codec === "string"
							? metadata.format.codec
							: null,
				},
				replayGain: {
					trackGainDb: ratioDb(common.replaygain_track_gain),
					trackPeak: ratioPeak(common.replaygain_track_peak),
					albumGainDb: ratioDb(common.replaygain_album_gain),
					albumPeak: ratioPeak(common.replaygain_album_peak),
				},
				lyrics: embeddedLyrics(common.lyrics),
			},
			artwork,
		};
	} catch {
		return { track: base, artwork: null };
	}
}
