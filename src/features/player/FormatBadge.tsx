import type { Track } from "../../types/library";

/**
 * Honest format/quality badge from parsed container metadata only.
 * Shows what is known (container, codec, bitrate, bit depth, sample
 * rate); unknown fields are omitted, never inferred.
 */
export function FormatBadge({ track }: { track: Track }) {
	const info = track.audioInfo;
	const parts: string[] = [];
	const ext = extensionOf(track.fileName);
	if (ext) parts.push(ext);
	if (info?.codec) parts.push(info.codec);
	if (info?.bitrate && info.bitrate > 0) {
		parts.push(`${Math.round(info.bitrate / 1000)} kbps`);
	}
	if (info?.bitsPerSample && info.bitsPerSample > 0) {
		parts.push(`${info.bitsPerSample}-bit`);
	}
	if (info?.sampleRate && info.sampleRate > 0) {
		const khz = info.sampleRate / 1000;
		parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`);
	}
	if (parts.length === 0) return null;
	return (
		<span
			className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted"
			title="Format details from file metadata"
		>
			{parts.join(" · ")}
		</span>
	);
}

function extensionOf(fileName: string): string {
	const dot = fileName.lastIndexOf(".");
	if (dot < 0) return "";
	return fileName.slice(dot + 1).toUpperCase();
}
