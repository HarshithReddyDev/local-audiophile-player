/**
 * Audio-format support for remote files: provider/container reality crossed
 * with actual browser decoding ability. Nothing is transcoded (no backend);
 * the catalog stores what the browser can really play.
 *
 * Detection order: provider MIME type first, file extension second. The
 * browser verdict comes from canPlayType at runtime; the static table only
 * provides the MIME guess and the honest fallback bucket.
 */

export type FormatSupport = "supported" | "possibly-supported" | "unsupported";

/** Extension → MIME guess for common audio containers. */
const EXTENSION_MIME: Record<string, string> = {
	mp3: "audio/mpeg",
	wav: "audio/wav",
	flac: "audio/flac",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/opus",
	m4a: "audio/mp4",
	aac: "audio/aac",
	aiff: "audio/aiff",
	aif: "audio/aiff",
	webm: "audio/webm",
	mp4: "audio/mp4",
	wma: "audio/x-ms-wma",
	alac: "audio/mp4",
};

/** Extensions treated as audio for discovery (superset of local scan). */
export const CLOUD_AUDIO_EXTENSIONS = new Set([
	"mp3",
	"wav",
	"flac",
	"ogg",
	"oga",
	"opus",
	"m4a",
	"aac",
	"aiff",
	"aif",
	"webm",
	"mp4",
	"wma",
]);

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** MIME guess from provider metadata or file extension ("" when unknown). */
export function guessAudioMime(name: string, mimeType: string | null): string {
	if (mimeType && mimeType.trim() !== "") return mimeType.trim();
	return EXTENSION_MIME[extensionOf(name)] ?? "";
}

/** True for files worth listing as music (provider MIME or extension). */
export function isAudioFile(name: string, mimeType: string | null): boolean {
	if (mimeType) {
		const m = mimeType.toLowerCase();
		if (m.startsWith("audio/")) return true;
		// Providers sometimes report containers generically.
		if (m === "application/ogg" || m === "video/mp4") return true;
	}
	return CLOUD_AUDIO_EXTENSIONS.has(extensionOf(name));
}

function canPlayType(mime: string): "" | "maybe" | "probably" {
	try {
		if (typeof document === "undefined") return "";
		const el = document.createElement("audio");
		if (typeof el.canPlayType !== "function") return "";
		return el.canPlayType(mime) as "" | "maybe" | "probably";
	} catch {
		return "";
	}
}

/**
 * Browser playback verdict for one remote file. "supported" = the browser
 * claims it; "possibly-supported" = unknown container/codec (try at play
 * time, report honestly on failure); "unsupported" = the browser refuses.
 */
export function browserFormatSupport(
	name: string,
	mimeType: string | null,
): FormatSupport {
	const mime = guessAudioMime(name, mimeType);
	if (!mime) return "possibly-supported";
	const verdict = canPlayType(mime);
	if (verdict === "probably" || verdict === "maybe") return "supported";
	// canPlayType is conservative ("" ≠ cannot-play): containers the MIME
	// database doesn't know stay in the honest middle bucket.
	return mime.startsWith("audio/") || mime === "application/ogg"
		? "possibly-supported"
		: "unsupported";
}
