import type { ReactNode } from "react";
import { usePlayerStore } from "../../state/player-store";
import { nextTrack, previousTrack, togglePlayback } from "./use-playback";

function Icon({ d }: { d: string }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d={d} />
		</svg>
	);
}

const PATHS = {
	prev: "M6 5h2.5v14H6zM19.5 5v14L9.5 12z",
	play: "M8 5v14l11-7z",
	pause: "M6.5 5h4v14h-4zM13.5 5h4v14h-4z",
	next: "M15.5 5H18v14h-2.5zM4.5 5v14l10-7z",
	shuffle:
		"M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20l12.55-12.54L19 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
	repeat: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
};

function repeatLabel(repeat: string): string {
	switch (repeat) {
		case "all":
			return "Repeat all (on)";
		case "one":
			return "Repeat one (on)";
		default:
			return "Repeat (off)";
	}
}

function ControlButton({
	label,
	onClick,
	disabled,
	pressed,
	active,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	pressed?: boolean;
	active?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={pressed}
			disabled={disabled}
			onClick={onClick}
			className={`flex items-center justify-center rounded-full p-2 transition-colors hover:bg-elevated disabled:opacity-40 ${active ? "text-accent" : "text-muted"}`}
		>
			{children}
		</button>
	);
}

/** Prev / play-pause / next plus shuffle and repeat toggles. */
export function TransportControls() {
	const status = usePlayerStore((s) => s.status);
	const shuffle = usePlayerStore((s) => s.shuffle);
	const repeat = usePlayerStore((s) => s.repeat);
	const hasTrack = usePlayerStore((s) => s.currentTrackId() !== null);
	const playing = status === "playing";
	const busy = status === "loading";

	return (
		<div
			className="flex items-center gap-1"
			role="group"
			aria-label="Playback controls"
		>
			<ControlButton
				label="Shuffle"
				pressed={shuffle}
				active={shuffle}
				onClick={() => usePlayerStore.getState().toggleShuffle()}
			>
				<Icon d={PATHS.shuffle} />
			</ControlButton>
			<ControlButton
				label="Previous track"
				disabled={!hasTrack}
				onClick={previousTrack}
			>
				<Icon d={PATHS.prev} />
			</ControlButton>
			<button
				type="button"
				aria-label={busy ? "Loading…" : playing ? "Pause" : "Play"}
				aria-busy={busy || undefined}
				disabled={!hasTrack || busy}
				onClick={togglePlayback}
				className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-ink transition-transform hover:scale-105 disabled:opacity-40"
			>
				<Icon d={playing ? PATHS.pause : PATHS.play} />
			</button>
			<ControlButton
				label="Next track"
				disabled={!hasTrack}
				onClick={nextTrack}
			>
				<Icon d={PATHS.next} />
			</ControlButton>
			<ControlButton
				label={repeatLabel(repeat)}
				pressed={repeat !== "off"}
				active={repeat !== "off"}
				onClick={() => usePlayerStore.getState().cycleRepeat()}
			>
				<span className="relative inline-flex">
					<Icon d={PATHS.repeat} />
					{repeat === "one" ? (
						<span className="absolute -top-1 -right-1 rounded-full bg-accent px-1 text-[9px] font-bold text-accent-ink">
							1
						</span>
					) : null}
				</span>
			</ControlButton>
		</div>
	);
}
