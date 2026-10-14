import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import type { Track } from "../../types/library";
import { formatTime } from "../../utils/time";
import { RemoteStatusNote, SourceBadge } from "../cloud/SourceBadge";
import { playTrack } from "../player/use-playback";
import { TrackArtwork } from "./TrackArtwork";

/** Playable track rows. Clicking a row replaces the queue and plays it. */
export function TrackList({
	tracks,
	onRemove,
}: {
	tracks: Track[];
	onRemove?: (trackId: string) => void;
}) {
	const currentTrackId = usePlayerStore((s) => s.currentTrackId());
	const status = usePlayerStore((s) => s.status);

	const playAll = (startIndex: number) => {
		const ids = tracks.map((t) => t.id);
		usePlayerStore.getState().setQueue(ids, startIndex);
		void playTrack(ids[startIndex] ?? null, true);
	};

	return (
		<ol aria-label="Tracks">
			{tracks.map((track, index) => {
				const current = track.id === currentTrackId;
				return (
					<TrackRow
						key={track.id}
						track={track}
						current={current}
						playing={current && status === "playing"}
						onPlay={() => playAll(index)}
						onRemove={onRemove ? () => onRemove(track.id) : undefined}
					/>
				);
			})}
		</ol>
	);
}

function TrackRow({
	track,
	current,
	playing,
	onPlay,
	onRemove,
}: {
	track: Track;
	current: boolean;
	playing: boolean;
	onPlay: () => void;
	onRemove?: (() => void) | undefined;
}) {
	const favored = useLibraryStore((s) => s.favorites.includes(track.id));
	return (
		<li
			className={`group flex items-center gap-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-elevated ${current ? "bg-elevated" : ""}`}
		>
			<button
				type="button"
				onClick={onPlay}
				aria-current={current ? "true" : undefined}
				aria-label={`Play ${track.title} by ${track.artist}`}
				className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left"
			>
				<TrackArtwork
					artworkId={track.artworkId}
					title={track.title}
					size={40}
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium">
						{playing ? "♪ " : ""}
						{track.title}
						{track.missing ? (
							<span className="ml-2 rounded-full border border-line px-1.5 py-0.5 align-middle text-[10px] font-normal text-muted">
								Unavailable
							</span>
						) : null}
						<RemoteStatusNote track={track} />
					</span>
					<span className="block truncate text-xs text-muted">
						{track.artist} • {track.album}
					</span>
				</span>
				<span className="hidden shrink-0 text-xs tabular-nums text-muted sm:block">
					{track.trackNumber ? `#${track.trackNumber}` : ""}
				</span>
				<span className="shrink-0 text-xs tabular-nums text-muted">
					{formatTime(track.duration)}
				</span>
				<SourceBadge track={track} />
			</button>
			<button
				type="button"
				onClick={() => void libraryService.toggleFavorite(track.id)}
				aria-label={
					favored
						? `Remove ${track.title} from favorites`
						: `Add ${track.title} to favorites`
				}
				aria-pressed={favored}
				// Hover-reveal keeps rows clean: always visible when favored,
				// on hover/focus, and on touch devices (no hover capability).
				className={`shrink-0 rounded-full p-1.5 transition-all hover:bg-elevated ${
					favored
						? "text-accent"
						: "text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
				}`}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill={favored ? "currentColor" : "none"}
					stroke="currentColor"
					strokeWidth="2"
					aria-hidden="true"
				>
					<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
				</svg>
			</button>
			{onRemove ? (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${track.title} from this playlist`}
					className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					✕
				</button>
			) : null}
		</li>
	);
}

export function useTrackMap() {
	return useLibraryStore((s) => s.tracks);
}
