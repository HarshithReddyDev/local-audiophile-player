import { useDspStore } from "../../state/dsp-store";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { formatTime } from "../../utils/time";
import { ActiveDeviceBadge } from "../dsp/ActiveDeviceBadge";
import { TrackArtwork } from "../library/TrackArtwork";
import { FormatBadge } from "./FormatBadge";
import { ProgressBar } from "./ProgressBar";
import { TransportControls } from "./TransportControls";
import { VolumeControl } from "./VolumeControl";

/** Bottom playback bar: artwork + track info, transport, progress, volume, queue. */
export function PlayerBar({
	onOpenNowPlaying,
	queueOpen,
	onToggleQueue,
	onOpenDevices,
}: {
	onOpenNowPlaying: () => void;
	queueOpen: boolean;
	onToggleQueue: () => void;
	onOpenDevices?: () => void;
}) {
	const trackId = usePlayerStore((s) => s.currentTrackId());
	const status = usePlayerStore((s) => s.status);
	const error = usePlayerStore((s) => s.error);
	const track = useLibraryStore((s) =>
		trackId ? (s.tracks[trackId] ?? null) : null,
	);
	const queueLength = usePlayerStore((s) => s.queue.length);
	const masterBypass = useDspStore((s) => s.masterBypass);
	const comparing = useDspStore((s) => s.comparing);
	const dspOff = masterBypass || comparing;

	return (
		<footer
			className="border-t border-line bg-surface/95 backdrop-blur"
			aria-label="Player"
		>
			{error ? (
				<details className="border-b border-line bg-elevated px-4 py-1.5 text-center">
					<summary role="alert" className="cursor-pointer text-xs text-red-300">
						Couldn't play this track. Reconnect the source and try again.
					</summary>
					<p className="mx-auto max-w-2xl pt-1 text-left text-[11px] break-all text-muted">
						{error}
					</p>
				</details>
			) : null}
			<div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-2.5 md:px-8">
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<button
						type="button"
						onClick={onOpenNowPlaying}
						aria-label={
							track ? `Open now playing: ${track.title}` : "Now playing"
						}
						className="flex min-w-0 items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-elevated/60"
					>
						<TrackArtwork
							artworkId={track?.artworkId ?? null}
							title={track?.title ?? "No track"}
							size={48}
						/>
						<span className="min-w-0">
							<span className="block truncate text-[14px] font-semibold">
								{track?.title ?? "No track loaded"}
							</span>
							<span className="block truncate text-[13px] text-muted">
								{track
									? `${track.artist} • ${track.album}`
									: "Add local audio files to begin"}
							</span>
						</span>
					</button>
					<span className="flex min-w-0 flex-wrap items-center gap-1.5">
						<ActiveDeviceBadge {...(onOpenDevices ? { onOpenDevices } : {})} />
						{track ? <FormatBadge track={track} /> : null}
					</span>
					<div className="hidden sm:block">
						<TransportControls />
					</div>
					<div className="hidden items-center gap-2 md:flex">
						<button
							type="button"
							onClick={() =>
								useDspStore.getState().setMasterBypass(!masterBypass)
							}
							aria-pressed={!masterBypass}
							title={
								masterBypass
									? "DSP bypassed — enable to restore your sound"
									: "DSP active — bypass without changing settings"
							}
							className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
								dspOff
									? "border-accent/50 text-accent"
									: "border-line text-muted hover:bg-elevated hover:text-ink"
							}`}
						>
							{comparing ? "B · Bypass" : masterBypass ? "DSP OFF" : "DSP ON"}
						</button>
						<VolumeControl />
						<button
							type="button"
							aria-label={queueOpen ? "Close queue" : "Open queue"}
							aria-expanded={queueOpen}
							onClick={onToggleQueue}
							className={`rounded-full p-2 transition-colors hover:bg-elevated ${queueOpen ? "text-accent" : "text-muted"}`}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M4 6h12v2H4zm0 5h12v2H4zm0 5h7v2H4zm14-9 4 4-4 4v-3h-3V9h3z" />
							</svg>
						</button>
					</div>
				</div>
				<div className="sm:hidden">
					<TransportControls />
				</div>
				<ProgressBar />
				<span className="sr-only" role="status">
					{status === "playing"
						? `Playing ${track?.title ?? ""}`
						: `Player ${status}`}
					{queueLength > 0 ? `, ${queueLength} in queue` : ""}{" "}
					{formatTime(usePlayerStore.getState().currentTime)}
				</span>
			</div>
		</footer>
	);
}
