import { usePlayerStore } from "../../state/player-store";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Playback-rate control. Rate changes element speed; the browser preserves
 * pitch by default (preservesPitch) — rate and pitch are independent.
 */
export function RateControl() {
	const rate = usePlayerStore((s) => s.rate);

	return (
		<div className="flex items-center gap-2">
			<label htmlFor="playback-rate" className="text-xs text-muted">
				Speed
			</label>
			<select
				id="playback-rate"
				value={rate}
				onChange={(e) =>
					usePlayerStore.getState().setRate(Number(e.target.value))
				}
				className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
			>
				{RATES.map((r) => (
					<option key={r} value={r}>
						{r}×
					</option>
				))}
			</select>
			{rate !== 1 ? (
				<button
					type="button"
					onClick={() => usePlayerStore.getState().setRate(1)}
					className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					Reset
				</button>
			) : null}
		</div>
	);
}
