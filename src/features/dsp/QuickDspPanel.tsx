import { Slider } from "../../components/ui/Slider";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { ActiveDeviceBadge } from "./ActiveDeviceBadge";
import { DSPSummary } from "./DSPSummary";

/**
 * Compact quick-access DSP panel for the player: profile, EQ switch,
 * preamp/bass/treble, limiter, and a way out to the full workspace.
 * Deliberately six controls — everything else lives in DSP view.
 */
export function QuickDspPanel({
	onOpenDevices,
	onOpenDsp,
}: {
	onOpenDevices?: () => void;
	onOpenDsp?: () => void;
}) {
	const eqEnabled = useEQStore((s) => s.profile.enabled);
	const eqPreamp = useEQStore((s) => s.profile.preamp);
	const bass = useDspStore((s) => s.bass);
	const treble = useDspStore((s) => s.treble);
	const limiter = useDspStore((s) => s.limiter);
	const masterBypass = useDspStore((s) => s.masterBypass);
	const comparing = useDspStore((s) => s.comparing);

	return (
		<section
			aria-label="Quick audio controls"
			className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface p-3"
		>
			<div className="flex items-center gap-2">
				<h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
					Audio
				</h3>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() => useDspStore.getState().setMasterBypass(!masterBypass)}
					aria-pressed={!masterBypass}
					title="Master DSP bypass — listening only, settings are kept"
					className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
						masterBypass || comparing
							? "border-accent/50 text-accent"
							: "border-line text-muted hover:bg-elevated hover:text-ink"
					}`}
				>
					{comparing ? "A/B" : masterBypass ? "DSP OFF" : "DSP ON"}
				</button>
				<ActiveDeviceBadge {...(onOpenDevices ? { onOpenDevices } : {})} />
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<label className="flex items-center gap-2 text-xs">
					<input
						type="checkbox"
						checked={eqEnabled}
						onChange={(e) => useEQStore.getState().setEnabled(e.target.checked)}
						aria-label="Enable EQ"
					/>
					EQ
				</label>
				<label className="flex items-center gap-2 text-xs">
					<input
						type="checkbox"
						checked={limiter.enabled}
						onChange={(e) =>
							useDspStore
								.getState()
								.setLimiter({ ...limiter, enabled: e.target.checked })
						}
						aria-label="Enable peak safety limiter"
					/>
					Limiter
				</label>
				{onOpenDsp ? (
					<button
						type="button"
						onClick={onOpenDsp}
						className="ml-auto rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
					>
						More DSP →
					</button>
				) : null}
			</div>
			<div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
				<div>
					<div className="flex items-baseline justify-between">
						<span className="text-xs text-muted">Preamp</span>
						<span className="text-xs tabular-nums">
							{eqPreamp > 0 ? "+" : ""}
							{eqPreamp.toFixed(1)} dB
						</span>
					</div>
					<Slider
						label="Quick preamp gain"
						value={eqPreamp}
						min={-24}
						max={24}
						step={0.5}
						textValue={`${eqPreamp.toFixed(1)} decibels`}
						onChange={(v) => useEQStore.getState().setPreamp(v)}
					/>
				</div>
				<div>
					<div className="flex items-baseline justify-between">
						<span className="text-xs text-muted">Bass</span>
						<span className="text-xs tabular-nums">
							{bass.gainDb > 0 ? "+" : ""}
							{bass.gainDb.toFixed(1)} dB
						</span>
					</div>
					<Slider
						label="Quick bass gain"
						value={bass.gainDb}
						min={-12}
						max={12}
						step={0.5}
						textValue={`${bass.gainDb.toFixed(1)} decibels`}
						onChange={(gainDb) =>
							useDspStore.getState().setBass({ ...bass, enabled: true, gainDb })
						}
					/>
				</div>
				<div>
					<div className="flex items-baseline justify-between">
						<span className="text-xs text-muted">Treble</span>
						<span className="text-xs tabular-nums">
							{treble.gainDb > 0 ? "+" : ""}
							{treble.gainDb.toFixed(1)} dB
						</span>
					</div>
					<Slider
						label="Quick treble gain"
						value={treble.gainDb}
						min={-12}
						max={12}
						step={0.5}
						textValue={`${treble.gainDb.toFixed(1)} decibels`}
						onChange={(gainDb) =>
							useDspStore
								.getState()
								.setTreble({ ...treble, enabled: true, gainDb })
						}
					/>
				</div>
			</div>
			<DSPSummary compact />
		</section>
	);
}
