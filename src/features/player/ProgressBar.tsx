import { Slider } from "../../components/ui/Slider";
import { usePlayerStore } from "../../state/player-store";
import { formatTime } from "../../utils/time";
import { seekTo } from "./use-playback";

/** Seek bar with elapsed/total labels. */
export function ProgressBar() {
	const currentTime = usePlayerStore((s) => s.currentTime);
	const duration = usePlayerStore((s) => s.duration);
	const hasTrack = usePlayerStore((s) => s.currentTrackId() !== null);
	const max = duration ?? 0;

	return (
		<div className="flex items-center gap-2">
			<span
				className="w-12 shrink-0 text-right text-xs tabular-nums text-muted"
				aria-hidden="true"
			>
				{formatTime(currentTime)}
			</span>
			<Slider
				label="Seek"
				value={Math.min(currentTime, max)}
				min={0}
				max={max}
				step={0.1}
				disabled={!hasTrack || max <= 0}
				textValue={`${formatTime(currentTime)} of ${formatTime(duration)}`}
				onChange={seekTo}
			/>
			<span
				className="w-12 shrink-0 text-xs tabular-nums text-muted"
				aria-hidden="true"
			>
				{formatTime(duration)}
			</span>
		</div>
	);
}
