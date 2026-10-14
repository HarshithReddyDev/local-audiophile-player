import type { Track } from "../../types/library";
import { getPlaybackEngine } from "../player/use-playback";

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string {
	if (seconds == null || !Number.isFinite(seconds)) return "unknown";
	const total = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Track analysis panel: only what the container tags plus the browser
 * honestly expose. Anything unmeasurable without a full decode says so
 * instead of guessing.
 */
export function TrackAnalysis({ track }: { track: Track | null }) {
	if (!track) {
		return <p className="text-sm text-muted">No track loaded.</p>;
	}
	const info = track.audioInfo;
	const renderRate = getPlaybackEngine()?.getSampleRate() ?? null;
	const extension = track.fileName.includes(".")
		? (track.fileName.split(".").pop() ?? "").toUpperCase()
		: "unknown";
	const rows: [string, string][] = [
		["Container", extension || "unknown"],
		["Codec", info?.codec ?? "unknown (browser does not expose it)"],
		[
			"Sample rate",
			info?.sampleRate
				? `${(info.sampleRate / 1000).toFixed(1)} kHz`
				: "unknown",
		],
		["Channels", info?.channels ? String(info.channels) : "unknown"],
		[
			"Bit depth",
			info?.bitsPerSample ? `${info.bitsPerSample}-bit` : "unknown",
		],
		[
			"Bitrate",
			info?.bitrate ? `${Math.round(info.bitrate / 1000)} kbps` : "unknown",
		],
		["Duration", formatDuration(track.duration)],
		["File size", formatSize(track.fileSize)],
		[
			"ReplayGain",
			track.replayGain &&
			(track.replayGain.trackGainDb !== null ||
				track.replayGain.albumGainDb !== null)
				? [
						track.replayGain.trackGainDb !== null
							? `track ${track.replayGain.trackGainDb.toFixed(2)} dB`
							: null,
						track.replayGain.albumGainDb !== null
							? `album ${track.replayGain.albumGainDb.toFixed(2)} dB`
							: null,
					]
						.filter(Boolean)
						.join(" · ")
				: "no tags",
		],
		[
			"Output render rate",
			renderRate
				? `${(renderRate / 1000).toFixed(1)} kHz (browser mixer — not a hardware claim)`
				: "unknown yet (starts with playback)",
		],
		[
			"Peak / loudness estimate",
			"not computed (requires a full decode, not performed)",
		],
	];
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
			{rows.map(([label, value]) => (
				<div key={label} className="contents">
					<dt className="text-muted">{label}</dt>
					<dd className="break-words">{value}</dd>
				</div>
			))}
		</dl>
	);
}
