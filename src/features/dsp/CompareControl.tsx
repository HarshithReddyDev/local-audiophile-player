import { useDspStore } from "../../state/dsp-store";

/**
 * A/B comparison: momentarily bypass the chain for listening comparison.
 * Only listening state changes — stored presets, device profile, and EQ
 * values are never modified. Turning compare off restores the exact
 * previous sound; unmounting always restores it too.
 */
export function CompareControl() {
	const comparing = useDspStore((s) => s.comparing);

	return (
		<div
			role="group"
			aria-label="A/B comparison: current DSP versus bypassed"
			className="flex items-center gap-1 rounded-full border border-line p-1"
		>
			<button
				type="button"
				aria-pressed={!comparing}
				onClick={() => useDspStore.getState().setComparing(false)}
				className={`rounded-full px-3 py-1 text-xs transition-colors ${
					!comparing ? "bg-elevated font-semibold" : "text-muted hover:text-ink"
				}`}
			>
				A · DSP
			</button>
			<button
				type="button"
				aria-pressed={comparing}
				onClick={() => useDspStore.getState().setComparing(true)}
				className={`rounded-full px-3 py-1 text-xs transition-colors ${
					comparing ? "bg-elevated font-semibold" : "text-muted hover:text-ink"
				}`}
			>
				B · Bypass
			</button>
			{comparing ? (
				<span role="status" className="px-1 text-[11px] text-muted">
					Comparing bypass — settings untouched
				</span>
			) : null}
		</div>
	);
}
