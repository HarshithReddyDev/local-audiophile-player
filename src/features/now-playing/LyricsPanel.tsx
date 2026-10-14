import { useEffect, useRef, useState } from "react";
import { activeLyricIndex, parseLrc } from "../../dsp/lyrics";
import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import type { Track } from "../../types/library";

/**
 * Lyrics panel: embedded tags first, .lrc sidecar on demand. Synced
 * lines auto-scroll (toggleable); plain text renders as-is. No network
 * lyric services — local data only, stated in the empty state.
 */
export function LyricsPanel({ track }: { track: Track | null }) {
	const currentTime = usePlayerStore((s) => s.currentTime);
	const [autoscroll, setAutoscroll] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const activeRef = useRef<HTMLLIElement>(null);
	const synced = track?.lyrics?.synced ?? null;
	const plain = track?.lyrics?.plain ?? null;
	const active = synced ? activeLyricIndex(synced, currentTime) : -1;

	useEffect(() => {
		if (autoscroll && activeRef.current) {
			activeRef.current.scrollIntoView({ block: "nearest" });
		}
	}, [active, autoscroll]);

	if (!track) {
		return <p className="text-sm text-muted">No track loaded.</p>;
	}

	const attachLrc = async (file: File): Promise<void> => {
		setError(null);
		if (file.size > 1024 * 1024) {
			setError("That .lrc file is suspiciously large — skipped.");
			return;
		}
		try {
			const parsed = parseLrc(await file.text());
			if (!parsed) {
				setError("No usable lines found in that .lrc file.");
				return;
			}
			const ok = await libraryService.attachLyrics(track.id, {
				plain: parsed.synced
					? null
					: parsed.lines.map((l) => l.text).join("\n"),
				synced: parsed.synced ? parsed.lines : null,
				source: "lrc",
			});
			if (!ok) setError("Could not attach lyrics to this track.");
		} catch {
			setError("That .lrc file could not be read.");
		}
	};

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex items-center gap-3">
				<span className="text-xs text-muted">
					{track.lyrics?.source === "embedded"
						? "From embedded tags"
						: track.lyrics?.source === "lrc"
							? "From .lrc file"
							: "No lyrics found"}
				</span>
				<span className="flex-1" />
				{synced ? (
					<label className="flex items-center gap-1 text-xs text-muted">
						<input
							type="checkbox"
							checked={autoscroll}
							onChange={(e) => setAutoscroll(e.target.checked)}
							aria-label="Auto-scroll synchronized lyrics"
						/>
						Auto-scroll
					</label>
				) : null}
				<label className="cursor-pointer rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated">
					Attach .lrc
					<input
						type="file"
						accept=".lrc,.txt"
						className="sr-only"
						aria-label="Attach lyrics file to current track"
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (file) void attachLrc(file);
						}}
					/>
				</label>
			</div>
			{error ? (
				<p role="alert" className="text-xs text-red-300">
					{error}
				</p>
			) : null}
			{synced ? (
				<ol
					className="flex max-h-64 flex-col gap-1 overflow-y-auto"
					aria-label="Synchronized lyrics"
				>
					{synced.map((line, i) => (
						<li
							key={`${line.t}-${i}`}
							ref={i === active ? activeRef : undefined}
							aria-current={i === active ? "true" : undefined}
							className={`rounded px-2 py-0.5 text-sm transition-colors ${i === active ? "bg-elevated font-semibold" : "text-muted"}`}
						>
							{line.text === "" ? "♪" : line.text}
						</li>
					))}
				</ol>
			) : plain ? (
				<p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm">
					{plain}
				</p>
			) : (
				<p className="text-sm text-muted">
					No embedded lyrics in this file. Attach an .lrc sidecar to sing along
					— nothing is fetched from the network.
				</p>
			)}
		</div>
	);
}

/** Persist lyrics onto a track (service helper used by the panel). */
export async function attachLyricsToTrack(
	trackId: string,
	lyrics: NonNullable<Track["lyrics"]>,
): Promise<boolean> {
	return libraryService.attachLyrics(trackId, lyrics);
}

export function useTrackLyrics(trackId: string | null) {
	return useLibraryStore((s) =>
		trackId ? (s.tracks[trackId]?.lyrics ?? null) : null,
	);
}
