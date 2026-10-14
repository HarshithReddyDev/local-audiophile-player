import { useState } from "react";
import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { formatBytes } from "../../utils/time";
import { ActiveDeviceBadge } from "../dsp/ActiveDeviceBadge";
import { CompareControl } from "../dsp/CompareControl";
import { QuickDspPanel } from "../dsp/QuickDspPanel";
import { TrackArtwork } from "../library/TrackArtwork";
import { ProgressBar } from "../player/ProgressBar";
import { RateControl } from "../player/RateControl";
import { TransportControls } from "../player/TransportControls";
import { VolumeControl } from "../player/VolumeControl";
import { LyricsPanel } from "./LyricsPanel";
import { TrackAnalysis } from "./TrackAnalysis";
import { Visualizer } from "./Visualizer";

/** Full-screen now-playing view for mobile and focused listening. */
export function NowPlayingView({
	onClose,
	onOpenQueue,
	onOpenDsp,
	onOpenDevices,
	initialTab = "info",
}: {
	onClose: () => void;
	onOpenQueue: () => void;
	onOpenDsp?: () => void;
	onOpenDevices?: () => void;
	initialTab?: NowPlayingTab;
}) {
	const trackId = usePlayerStore((s) => s.currentTrackId());
	const track = useLibraryStore((s) =>
		trackId ? (s.tracks[trackId] ?? null) : null,
	);
	const favored = useLibraryStore((s) =>
		trackId ? s.favorites.includes(trackId) : false,
	);

	return (
		<div
			className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 py-6 md:max-w-2xl md:gap-5"
			role="region"
			aria-label="Now playing"
		>
			<div className="flex w-full items-center">
				<button
					type="button"
					onClick={onClose}
					aria-label="Back to library"
					className="rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					← Library
				</button>
				<span className="flex-1" />
				{track ? (
					<button
						type="button"
						onClick={() => void libraryService.toggleFavorite(track.id)}
						aria-label={
							favored
								? `Remove ${track.title} from favorites`
								: `Add ${track.title} to favorites`
						}
						aria-pressed={favored}
						className={`rounded-full p-2.5 transition-colors hover:bg-elevated ${favored ? "text-accent" : "text-muted hover:text-ink"}`}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill={favored ? "currentColor" : "none"}
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
						</svg>
					</button>
				) : null}
			</div>
			<div className="overflow-hidden rounded-2xl shadow-[var(--shadow-pop)] ring-1 ring-line">
				<TrackArtwork
					artworkId={track?.artworkId ?? null}
					title={track?.title ?? "No track"}
					size={264}
				/>
			</div>
			<div className="text-center">
				<h2 className="text-2xl font-bold tracking-tight">
					{track?.title ?? "No track loaded"}
				</h2>
				<p className="mt-1 text-[15px] text-muted">
					{track
						? `${track.artist} • ${track.album}`
						: "Add local audio files to begin"}
				</p>
				{track?.year ? (
					<p className="mt-0.5 text-[13px] text-muted">{track.year}</p>
				) : null}
			</div>
			<div className="w-full">
				<ProgressBar />
			</div>
			<TransportControls />
			<div className="flex items-center gap-2">
				<div className="w-40">
					<VolumeControl />
				</div>
				<button
					type="button"
					onClick={onOpenQueue}
					className="rounded-full border border-line px-4 py-1.5 text-[13px] text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					Queue
				</button>
			</div>
			<RateControl />
			<div className="flex w-full flex-col items-center gap-2">
				<ActiveDeviceBadge {...(onOpenDevices ? { onOpenDevices } : {})} />
				<CompareControl />
			</div>
			<QuickDspPanel
				{...(onOpenDevices ? { onOpenDevices } : {})}
				{...(onOpenDsp ? { onOpenDsp } : {})}
			/>
			<NowPlayingTabs trackId={trackId} initialTab={initialTab} />
		</div>
	);
}

export type NowPlayingTab = "info" | "lyrics" | "visuals";

function NowPlayingTabs({
	trackId,
	initialTab = "info",
}: {
	trackId: string | null;
	initialTab?: NowPlayingTab;
}) {
	const [tab, setTab] = useState<NowPlayingTab>(initialTab);
	const track = useLibraryStore((s) =>
		trackId ? (s.tracks[trackId] ?? null) : null,
	);
	return (
		<div className="flex w-full flex-col gap-2">
			<div
				role="tablist"
				aria-label="Now playing details"
				className="flex gap-1 self-center rounded-full border border-line p-1"
			>
				{(
					[
						["info", "Info"],
						["lyrics", "Lyrics"],
						["visuals", "Visuals"],
					] as const
				).map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={`rounded-full px-3 py-1 text-xs ${tab === id ? "bg-elevated font-semibold" : "text-muted hover:text-ink"}`}
					>
						{label}
					</button>
				))}
			</div>
			<div className="w-full rounded-xl border border-line bg-surface p-3">
				{tab === "info" ? (
					<>
						{track ? (
							<dl className="mb-2 flex justify-between py-0.5 text-xs text-muted">
								<div className="flex justify-between py-0.5">
									<dt>File</dt>
									<dd className="truncate pl-4 text-ink">{track.fileName}</dd>
								</div>
								<div className="flex justify-between py-0.5">
									<dt>Size</dt>
									<dd className="text-ink">{formatBytes(track.fileSize)}</dd>
								</div>
								{track.genre.length > 0 ? (
									<div className="flex justify-between py-0.5">
										<dt>Genre</dt>
										<dd className="text-ink">{track.genre.join(", ")}</dd>
									</div>
								) : null}
							</dl>
						) : null}
						<TrackAnalysis track={track} />
					</>
				) : tab === "lyrics" ? (
					<LyricsPanel track={track} />
				) : (
					<Visualizer />
				)}
			</div>
		</div>
	);
}
