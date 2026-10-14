import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { effectivePreampDb } from "../player/use-playback";
import { summarizeDsp } from "./dsp-summary";

/**
 * Compact active-configuration summary: EQ state plus only the
 * non-default processors. Rendered in the player and DSP workspace so
 * DSP state is never a mystery.
 */
export function DSPSummary({ compact = false }: { compact?: boolean }) {
	const eqMode = useDspStore((s) => s.eqMode);
	const eqEnabled = useEQStore((s) => s.profile.enabled);
	const eqBands = useEQStore((s) => s.profile.bands);
	const eqPreamp = useEQStore((s) => s.profile.preamp);
	const bass = useDspStore((s) => s.bass);
	const treble = useDspStore((s) => s.treble);
	const tuner = useDspStore((s) => s.tuner);
	const limiter = useDspStore((s) => s.limiter);
	const compressor = useDspStore((s) => s.compressor);
	const spatial = useDspStore((s) => s.spatial);
	const reverb = useDspStore((s) => s.reverb);
	const loudness = useDspStore((s) => s.loudness);
	const replayGainMode = useDspStore((s) => s.replayGainMode);
	const currentId = usePlayerStore(
		(s) => s.queue[s.currentIndex]?.trackId ?? null,
	);
	const libraryTracks = useLibraryStore((s) => s.tracks);

	const track = currentId ? libraryTracks[currentId] : undefined;
	const { preampDb, rgDb } = effectivePreampDb(eqPreamp, replayGainMode, track);
	const rows = summarizeDsp({
		eqMode,
		eqEnabled,
		eqActiveBands: eqBands.filter((b) => b.enabled).length,
		preampDb,
		replayGainDb: rgDb,
		bass,
		treble,
		tuner,
		limiter,
		compressor,
		spatial,
		reverb,
		loudness,
	});

	return (
		<dl
			aria-label="Active DSP configuration"
			className={
				compact
					? "flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
					: "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs"
			}
		>
			{rows.map((row) => (
				<div key={row.key} className={compact ? "flex gap-1" : "contents"}>
					<dt className="text-muted">{row.label}</dt>
					<dd
						className={
							row.warning ? "font-medium text-red-300" : "tabular-nums"
						}
					>
						{row.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
