import { Slider } from "../../components/ui/Slider";
import { usePlayerStore } from "../../state/player-store";

/** Volume slider with mute toggle. */
export function VolumeControl() {
	const volume = usePlayerStore((s) => s.volume);
	const muted = usePlayerStore((s) => s.muted);

	return (
		<div className="flex min-w-28 items-center gap-1">
			<button
				type="button"
				aria-label={muted ? "Unmute" : "Mute"}
				aria-pressed={muted}
				onClick={() => usePlayerStore.getState().toggleMute()}
				className="rounded-full p-2 text-muted transition-colors hover:bg-elevated hover:text-ink"
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="currentColor"
					aria-hidden="true"
				>
					{muted ? (
						<path d="M3 9v6h4l5 5V4L7 9H3zm13.59 3 2.7-2.7-1.41-1.41-2.7 2.7-2.7-2.7-1.41 1.41 2.7 2.7-2.7 2.7 1.41 1.41 2.7-2.7 2.7 2.7 1.41-1.41-2.7-2.7z" />
					) : (
						<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
					)}
				</svg>
			</button>
			<Slider
				label="Volume"
				value={muted ? 0 : volume}
				min={0}
				max={1}
				step={0.01}
				textValue={muted ? "Muted" : `${Math.round(volume * 100)} percent`}
				onChange={(v) => usePlayerStore.getState().setVolume(v)}
			/>
		</div>
	);
}
