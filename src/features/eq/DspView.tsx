import { useEffect, useState } from "react";
import { Slider } from "../../components/ui/Slider";
import { BEHAVIORAL_PRESETS, behavioralPreset } from "../../dsp/behavioral";
import { COMPRESSOR_LIMITS, suggestedMakeupDb } from "../../dsp/dynamics";
import {
	LOUDNESS_LIMITS,
	LOUDNESS_REFERENCE_DB,
	loudnessCompensation,
} from "../../dsp/loudness";
import { CHANNEL_MODES } from "../../dsp/spatial";
import { BASS_TUNER_LIMITS, TONE_LIMITS, tunerPeakDb } from "../../dsp/tone";
import { useDspStore } from "../../state/dsp-store";
import { MAX_UI_BANDS } from "../../state/eq-store";
import { CollapsibleModule } from "../dsp/CollapsibleModule";
import { CompareControl } from "../dsp/CompareControl";
import { DeviceSelector } from "../dsp/DeviceSelector";
import { DspPresetBar } from "../dsp/DspPresetBar";
import { formatDb } from "../dsp/dsp-summary";
import { getPlaybackEngine } from "../player/use-playback";
import { ChainGraph } from "./ChainGraph";

function Card({
	id,
	title,
	note,
	onReset,
	children,
}: {
	id: string;
	title: string;
	note?: string;
	onReset?: () => void;
	children: React.ReactNode;
}) {
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="rounded-xl border border-line bg-surface p-3"
		>
			<div className="mb-2 flex items-center gap-2">
				<h2 id={`${id}-heading`} className="text-sm font-semibold">
					{title}
				</h2>
				<span className="flex-1" />
				{onReset ? (
					<button
						type="button"
						onClick={onReset}
						className="text-xs text-muted hover:text-ink"
					>
						Reset
					</button>
				) : null}
			</div>
			{note ? <p className="mb-2 text-xs text-muted">{note}</p> : null}
			{children}
		</section>
	);
}

function EnableRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<label className="flex items-center gap-2 text-sm font-medium">
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				aria-label={label}
			/>
			{label}
		</label>
	);
}

function ParamSlider({
	label,
	value,
	min,
	max,
	step,
	unit,
	text,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	text: string;
	onChange: (value: number) => void;
}) {
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-xs text-muted">{label}</span>
				<span className="text-xs tabular-nums">
					{value} {unit}
				</span>
			</div>
			<Slider
				label={label}
				value={value}
				min={min}
				max={max}
				step={step}
				textValue={text}
				onChange={onChange}
			/>
		</div>
	);
}

/** Live gain-reduction readout from the compressor node (null when idle). */
function GainReductionMeter() {
	const enabled = useDspStore((s) => s.compressor.enabled);
	const [reduction, setReduction] = useState<number | null>(null);
	useEffect(() => {
		if (!enabled) {
			setReduction(null);
			return;
		}
		let live = true;
		const timer = setInterval(() => {
			if (document.hidden || !live) return;
			setReduction(getPlaybackEngine()?.getReductionDb() ?? null);
		}, 150);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [enabled]);
	if (!enabled) return null;
	return (
		<p className="text-xs text-muted" role="status">
			Gain reduction: {reduction === null ? "—" : `${reduction.toFixed(1)} dB`}
		</p>
	);
}

/** Full DSP deck: every module with bypass, params, defaults, and reset. */
export type DspFocus = "all" | "tone" | "dynamics" | "spatial" | "loudness";

export function DspView({
	focus = "all",
	onOpenGuide,
}: {
	focus?: DspFocus;
	onOpenGuide?: ((guideId: string) => void) | undefined;
}) {
	const dsp = useDspStore();
	const activeDeviceName = useDspStore((s) => s.activeDeviceName);
	const makeupSuggestion = suggestedMakeupDb(dsp.compressor, -12);
	const loud = loudnessCompensation(dsp.loudness);
	const tunerPeak = tunerPeakDb(dsp.tuner);

	const applyBehavioral = (id: string): void => {
		const preset = behavioralPreset(id);
		if (!preset) return;
		const state = useDspStore.getState();
		const patch = preset.patch;
		if (patch.graphic) state.setGraphic({ ...patch.graphic });
		if (patch.bass) state.setBass({ ...patch.bass });
		if (patch.treble) state.setTreble({ ...patch.treble });
		if (patch.tuner) state.setTuner({ ...patch.tuner });
		if (patch.loudness) state.setLoudness({ ...patch.loudness });
		if (patch.spatial) state.setSpatial({ ...patch.spatial });
		if (patch.reverb) state.setReverb({ ...patch.reverb });
		if (patch.compressor) state.setCompressor({ ...patch.compressor });
	};

	const showTone = focus === "all" || focus === "tone";
	const showDynamics = focus === "all" || focus === "dynamics";
	const showSpatial = focus === "all" || focus === "spatial";
	const showLoudness = focus === "all" || focus === "loudness";

	return (
		<div className="flex max-w-3xl flex-col gap-4">
			{activeDeviceName ? (
				<p className="text-[13px] text-muted">
					Editing on top of{" "}
					<strong className="text-ink">{activeDeviceName}</strong>.{" "}
					<button
						type="button"
						onClick={() => useDspStore.getState().clearDevice()}
						className="text-accent hover:underline"
					>
						Back to global
					</button>
				</p>
			) : null}
			<details className="rounded-xl bg-surface px-3 py-2 text-[13px] text-muted">
				<summary className="cursor-pointer font-medium hover:text-ink">
					About this DSP chain
				</summary>
				<p className="pt-1">
					Order: preamp → EQ → tone → dynamics → spatial → limiter. Reverb runs
					in parallel. These effects apply only inside this player.{" "}
					{onOpenGuide ? (
						<button
							type="button"
							onClick={() => onOpenGuide("dsp")}
							className="text-accent hover:underline"
						>
							Learn how each processor works →
						</button>
					) : null}
				</p>
			</details>
			<aside
				aria-label="Quick DSP tips"
				className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted"
			>
				<span className="font-semibold text-ink">Quick tips:</span> start flat ·
				small changes · keep headroom · A/B at matched loudness · don&apos;t
				chase every measurement wiggle.
			</aside>

			<section
				aria-label="Device quick switcher"
				className="rounded-xl border border-line bg-surface p-3"
			>
				<DeviceSelector />
			</section>

			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
				<label className="flex items-center gap-2 text-xs font-medium">
					<input
						type="checkbox"
						checked={!dsp.masterBypass}
						onChange={(e) => dsp.setMasterBypass(!e.target.checked)}
						aria-label="Enable DSP chain"
					/>
					{dsp.masterBypass ? "DSP BYPASSED" : "DSP ON"}
				</label>
				<span className="flex-1" />
				<CompareControl />
			</div>

			<DspPresetBar />

			<ChainGraph />

			{showTone ? (
				<CollapsibleModule
					id="tone"
					title="Bass / Treble"
					summary={`${dsp.bass.enabled && dsp.bass.gainDb !== 0 ? `Bass ${formatDb(dsp.bass.gainDb)}` : "Bass off"} · ${dsp.treble.enabled && dsp.treble.gainDb !== 0 ? `Treble ${formatDb(dsp.treble.gainDb)}` : "Treble off"}`}
					enabled={dsp.bass.enabled || dsp.treble.enabled}
					onToggleEnabled={(on) => {
						dsp.setBass({ ...dsp.bass, enabled: on });
						dsp.setTreble({ ...dsp.treble, enabled: on });
					}}
					enableLabel="Enable bass and treble"
					note="Shelving filters with visible turnover points."
					onReset={() => {
						dsp.resetModule("bass");
						dsp.resetModule("treble");
					}}
				>
					<div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
						<div className="flex flex-col gap-2">
							<EnableRow
								label="Enable bass"
								checked={dsp.bass.enabled}
								onChange={(enabled) => dsp.setBass({ ...dsp.bass, enabled })}
							/>
							<ParamSlider
								label="Bass gain"
								value={dsp.bass.gainDb}
								min={TONE_LIMITS.gainDb.min}
								max={TONE_LIMITS.gainDb.max}
								step={0.5}
								unit="dB"
								text={`${dsp.bass.gainDb} decibels bass`}
								onChange={(gainDb) => dsp.setBass({ ...dsp.bass, gainDb })}
							/>
							<ParamSlider
								label="Bass turnover"
								value={dsp.bass.turnoverHz}
								min={TONE_LIMITS.bassTurnover.min}
								max={TONE_LIMITS.bassTurnover.max}
								step={5}
								unit="Hz"
								text={`${dsp.bass.turnoverHz} hertz turnover`}
								onChange={(turnoverHz) =>
									dsp.setBass({ ...dsp.bass, turnoverHz })
								}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<EnableRow
								label="Enable treble"
								checked={dsp.treble.enabled}
								onChange={(enabled) =>
									dsp.setTreble({ ...dsp.treble, enabled })
								}
							/>
							<ParamSlider
								label="Treble gain"
								value={dsp.treble.gainDb}
								min={TONE_LIMITS.gainDb.min}
								max={TONE_LIMITS.gainDb.max}
								step={0.5}
								unit="dB"
								text={`${dsp.treble.gainDb} decibels treble`}
								onChange={(gainDb) => dsp.setTreble({ ...dsp.treble, gainDb })}
							/>
							<ParamSlider
								label="Treble turnover"
								value={dsp.treble.turnoverHz}
								min={TONE_LIMITS.trebleTurnover.min}
								max={TONE_LIMITS.trebleTurnover.max}
								step={50}
								unit="Hz"
								text={`${dsp.treble.turnoverHz} hertz turnover`}
								onChange={(turnoverHz) =>
									dsp.setTreble({ ...dsp.treble, turnoverHz })
								}
							/>
						</div>
					</div>
				</CollapsibleModule>
			) : null}

			{showTone ? (
				<CollapsibleModule
					id="bass-tuner"
					title="Bass Tuner"
					summary={
						dsp.tuner.enabled && dsp.tuner.amountDb > 0
							? `${formatDb(dsp.tuner.amountDb)} @ ${Math.round(dsp.tuner.centerHz)} Hz`
							: "Off"
					}
					enabled={dsp.tuner.enabled}
					onToggleEnabled={(enabled) => dsp.setTuner({ ...dsp.tuner, enabled })}
					enableLabel="Enable bass tuner"
					note="Controlled low-frequency shaping — shelf lift plus optional sub-bass emphasis. Neutral by default."
					onReset={() => dsp.resetModule("tuner")}
				>
					<EnableRow
						label="Enable bass tuner"
						checked={dsp.tuner.enabled}
						onChange={(enabled) => dsp.setTuner({ ...dsp.tuner, enabled })}
					/>
					<div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
						<ParamSlider
							label="Bass amount"
							value={dsp.tuner.amountDb}
							min={0}
							max={12}
							step={0.5}
							unit="dB"
							text={`${dsp.tuner.amountDb} decibels bass amount`}
							onChange={(amountDb) => dsp.setTuner({ ...dsp.tuner, amountDb })}
						/>
						<ParamSlider
							label="Center frequency"
							value={dsp.tuner.centerHz}
							min={BASS_TUNER_LIMITS.centerHz.min}
							max={BASS_TUNER_LIMITS.centerHz.max}
							step={1}
							unit="Hz"
							text={`${dsp.tuner.centerHz} hertz center`}
							onChange={(centerHz) => dsp.setTuner({ ...dsp.tuner, centerHz })}
						/>
						<ParamSlider
							label="Sub-bass emphasis"
							value={dsp.tuner.subDb}
							min={0}
							max={6}
							step={0.5}
							unit="dB"
							text={`${dsp.tuner.subDb} decibels sub-bass`}
							onChange={(subDb) => dsp.setTuner({ ...dsp.tuner, subDb })}
						/>
						<ParamSlider
							label="Resonance"
							value={dsp.tuner.resonance}
							min={0.5}
							max={2}
							step={0.05}
							unit="Q"
							text={`resonance Q ${dsp.tuner.resonance}`}
							onChange={(resonance) =>
								dsp.setTuner({ ...dsp.tuner, resonance })
							}
						/>
					</div>
					{tunerPeak > 0 ? (
						<p className="mt-1 text-xs text-muted">
							Low-end lift up to +{tunerPeak.toFixed(1)} dB — check the preamp
							headroom readout in EQ.
						</p>
					) : null}
				</CollapsibleModule>
			) : null}

			{showDynamics ? (
				<CollapsibleModule
					id="dynamics"
					title="Compressor"
					summary={
						dsp.compressor.enabled
							? `${formatDb(dsp.compressor.thresholdDb)} · ${dsp.compressor.ratio}:1`
							: "Off"
					}
					enabled={dsp.compressor.enabled}
					onToggleEnabled={(enabled) =>
						dsp.setCompressor({ ...dsp.compressor, enabled })
					}
					enableLabel="Enable compressor"
					note="Native dynamics processor (no worklet needed). Gain-reduction meter reads the live node."
					onReset={() => dsp.resetModule("compressor")}
				>
					<EnableRow
						label="Enable compressor"
						checked={dsp.compressor.enabled}
						onChange={(enabled) =>
							dsp.setCompressor({ ...dsp.compressor, enabled })
						}
					/>
					<div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
						<ParamSlider
							label="Threshold"
							value={dsp.compressor.thresholdDb}
							min={COMPRESSOR_LIMITS.thresholdDb.min}
							max={COMPRESSOR_LIMITS.thresholdDb.max}
							step={1}
							unit="dB"
							text={`threshold ${dsp.compressor.thresholdDb} decibels`}
							onChange={(thresholdDb) =>
								dsp.setCompressor({ ...dsp.compressor, thresholdDb })
							}
						/>
						<ParamSlider
							label="Ratio"
							value={dsp.compressor.ratio}
							min={COMPRESSOR_LIMITS.ratio.min}
							max={COMPRESSOR_LIMITS.ratio.max}
							step={0.5}
							unit=":1"
							text={`ratio ${dsp.compressor.ratio} to 1`}
							onChange={(ratio) =>
								dsp.setCompressor({ ...dsp.compressor, ratio })
							}
						/>
						<ParamSlider
							label="Knee"
							value={dsp.compressor.kneeDb}
							min={COMPRESSOR_LIMITS.kneeDb.min}
							max={COMPRESSOR_LIMITS.kneeDb.max}
							step={1}
							unit="dB"
							text={`knee ${dsp.compressor.kneeDb} decibels`}
							onChange={(kneeDb) =>
								dsp.setCompressor({ ...dsp.compressor, kneeDb })
							}
						/>
						<ParamSlider
							label="Attack"
							value={dsp.compressor.attackSec}
							min={COMPRESSOR_LIMITS.attackSec.min}
							max={COMPRESSOR_LIMITS.attackSec.max}
							step={0.001}
							unit="s"
							text={`attack ${dsp.compressor.attackSec} seconds`}
							onChange={(attackSec) =>
								dsp.setCompressor({ ...dsp.compressor, attackSec })
							}
						/>
						<ParamSlider
							label="Release"
							value={dsp.compressor.releaseSec}
							min={COMPRESSOR_LIMITS.releaseSec.min}
							max={COMPRESSOR_LIMITS.releaseSec.max}
							step={0.01}
							unit="s"
							text={`release ${dsp.compressor.releaseSec} seconds`}
							onChange={(releaseSec) =>
								dsp.setCompressor({ ...dsp.compressor, releaseSec })
							}
						/>
						<ParamSlider
							label="Makeup gain"
							value={dsp.compressor.makeupDb}
							min={COMPRESSOR_LIMITS.makeupDb.min}
							max={COMPRESSOR_LIMITS.makeupDb.max}
							step={0.5}
							unit="dB"
							text={`makeup ${dsp.compressor.makeupDb} decibels`}
							onChange={(makeupDb) =>
								dsp.setCompressor({ ...dsp.compressor, makeupDb })
							}
						/>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-2">
						<GainReductionMeter />
						{makeupSuggestion > 0.5 ? (
							<button
								type="button"
								onClick={() =>
									dsp.setCompressor({
										...dsp.compressor,
										makeupDb: Math.round(makeupSuggestion * 2) / 2,
									})
								}
								className="text-xs text-accent hover:underline"
							>
								Apply suggested makeup ({makeupSuggestion.toFixed(1)} dB at −12
								dBFS)
							</button>
						) : null}
					</div>
				</CollapsibleModule>
			) : null}

			{showSpatial ? (
				<CollapsibleModule
					id="spatial"
					title="Channels & Stereo"
					summary={
						!dsp.spatial.enabled
							? "Off"
							: dsp.spatial.mode !== "stereo"
								? `Mode: ${dsp.spatial.mode}`
								: dsp.spatial.width !== 1
									? `Width ${Math.round(dsp.spatial.width * 100)}%`
									: dsp.spatial.balance !== 0
										? `Balance ${dsp.spatial.balance < 0 ? "L" : "R"}`
										: dsp.spatial.crossfeed > 0
											? "Crossfeed on"
											: "On · neutral"
					}
					enabled={dsp.spatial.enabled}
					onToggleEnabled={(enabled) =>
						dsp.setSpatial({ ...dsp.spatial, enabled })
					}
					enableLabel="Enable channel processing"
					note="Balance, channel routing, width, and crossfeed in one documented 2×2 matrix. Works identically for local and cloud audio."
					onReset={() => dsp.resetModule("spatial")}
				>
					<EnableRow
						label="Enable channel processing"
						checked={dsp.spatial.enabled}
						onChange={(enabled) => dsp.setSpatial({ ...dsp.spatial, enabled })}
					/>
					<div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
						<ParamSlider
							label="Balance"
							value={dsp.spatial.balance}
							min={-1}
							max={1}
							step={0.05}
							unit={
								dsp.spatial.balance === 0
									? "center"
									: dsp.spatial.balance < 0
										? "left"
										: "right"
							}
							text={`balance ${dsp.spatial.balance}`}
							onChange={(balance) =>
								dsp.setSpatial({ ...dsp.spatial, balance })
							}
						/>
						<div>
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-xs text-muted">Channel mode</span>
							</div>
							<select
								value={dsp.spatial.mode}
								onChange={(e) =>
									dsp.setSpatial({
										...dsp.spatial,
										mode: e.target.value as typeof dsp.spatial.mode,
									})
								}
								aria-label="Channel mode"
								className="mt-1 w-full rounded-md border border-line bg-abyss px-2 py-1.5 text-sm"
							>
								{CHANNEL_MODES.map((mode) => (
									<option key={mode} value={mode}>
										{mode}
									</option>
								))}
							</select>
						</div>
						<ParamSlider
							label="Stereo width"
							value={dsp.spatial.width}
							min={0}
							max={1.5}
							step={0.05}
							unit={dsp.spatial.width === 1 ? "neutral" : ""}
							text={`stereo width ${dsp.spatial.width}`}
							onChange={(width) => dsp.setSpatial({ ...dsp.spatial, width })}
						/>
						<ParamSlider
							label="Crossfeed"
							value={dsp.spatial.crossfeed}
							min={0}
							max={0.5}
							step={0.01}
							unit=""
							text={`crossfeed ${dsp.spatial.crossfeed}`}
							onChange={(crossfeed) =>
								dsp.setSpatial({ ...dsp.spatial, crossfeed })
							}
						/>
					</div>
					{dsp.spatial.width > 1 ? (
						<p className="mt-1 text-xs text-muted">
							Width above neutral can cause phase cancellation on mono playback
							— check mixes in mono mode.
						</p>
					) : null}
					<p className="mt-1 text-xs text-muted">
						Crossfeed softens hard-panned headphone imaging. An imaging aid —
						not room simulation.
					</p>
				</CollapsibleModule>
			) : null}

			{showSpatial ? (
				<CollapsibleModule
					id="reverb"
					title="Reverb"
					summary={
						dsp.reverb.enabled && dsp.reverb.mix > 0
							? `${Math.round(dsp.reverb.mix * 100)}% wet`
							: "Off"
					}
					enabled={dsp.reverb.enabled}
					onToggleEnabled={(enabled) =>
						dsp.setReverb({ ...dsp.reverb, enabled })
					}
					enableLabel="Enable reverb"
					note="Adds artificial room ambience (locally generated impulse — no files, no licensing). Off by default; audiophile listening usually wants none."
					onReset={() => dsp.resetModule("reverb")}
				>
					<EnableRow
						label="Enable reverb"
						checked={dsp.reverb.enabled}
						onChange={(enabled) => dsp.setReverb({ ...dsp.reverb, enabled })}
					/>
					<div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
						<ParamSlider
							label="Mix"
							value={dsp.reverb.mix}
							min={0}
							max={1}
							step={0.01}
							unit=""
							text={`reverb mix ${Math.round(dsp.reverb.mix * 100)} percent`}
							onChange={(mix) => dsp.setReverb({ ...dsp.reverb, mix })}
						/>
						<ParamSlider
							label="Room size"
							value={dsp.reverb.roomSec}
							min={0.3}
							max={3}
							step={0.1}
							unit="s"
							text={`room size ${dsp.reverb.roomSec} seconds`}
							onChange={(roomSec) => dsp.setReverb({ ...dsp.reverb, roomSec })}
						/>
						<ParamSlider
							label="Decay"
							value={dsp.reverb.decay}
							min={0.5}
							max={8}
							step={0.1}
							unit=""
							text={`decay ${dsp.reverb.decay}`}
							onChange={(decay) => dsp.setReverb({ ...dsp.reverb, decay })}
						/>
						<ParamSlider
							label="Damping"
							value={dsp.reverb.damping}
							min={0}
							max={1}
							step={0.01}
							unit=""
							text={`damping ${dsp.reverb.damping}`}
							onChange={(damping) => dsp.setReverb({ ...dsp.reverb, damping })}
						/>
						<ParamSlider
							label="Pre-delay"
							value={dsp.reverb.predelaySec}
							min={0}
							max={0.1}
							step={0.005}
							unit="s"
							text={`pre-delay ${dsp.reverb.predelaySec} seconds`}
							onChange={(predelaySec) =>
								dsp.setReverb({ ...dsp.reverb, predelaySec })
							}
						/>
					</div>
				</CollapsibleModule>
			) : null}

			{showLoudness ? (
				<CollapsibleModule
					id="loudness"
					title="Equal Loudness"
					summary={
						dsp.loudness.enabled
							? `On · ${formatDb(dsp.loudness.listeningLevelDb)}`
							: "Off"
					}
					enabled={dsp.loudness.enabled}
					onToggleEnabled={(enabled) =>
						dsp.setLoudness({ ...dsp.loudness, enabled })
					}
					enableLabel="Enable equal loudness"
					note="Relative, approximate compensation for low listening levels — browser volume is not calibrated SPL, so no absolute claim is possible. Fades to exactly zero at reference."
					onReset={() => dsp.resetModule("loudness")}
				>
					<EnableRow
						label="Enable equal loudness"
						checked={dsp.loudness.enabled}
						onChange={(enabled) =>
							dsp.setLoudness({ ...dsp.loudness, enabled })
						}
					/>
					<ParamSlider
						label="Listening level (relative)"
						value={dsp.loudness.listeningLevelDb}
						min={LOUDNESS_LIMITS.listeningLevelDb.min}
						max={LOUDNESS_REFERENCE_DB}
						step={1}
						unit="dB"
						text={`listening level ${dsp.loudness.listeningLevelDb} decibels relative`}
						onChange={(listeningLevelDb) =>
							dsp.setLoudness({ ...dsp.loudness, listeningLevelDb })
						}
					/>
					<p className="text-xs text-muted" role="status">
						Compensation now: +{loud.bassDb.toFixed(1)} dB bass, +
						{loud.trebleDb.toFixed(1)} dB treble.
					</p>
				</CollapsibleModule>
			) : null}

			{showDynamics ? (
				<CollapsibleModule
					id="limiter"
					title="Peak Safety Limiter"
					summary={
						dsp.limiter.enabled
							? `On · ${formatDb(dsp.limiter.ceilingDb)}FS`
							: "OFF — unprotected"
					}
					enabled={dsp.limiter.enabled}
					onToggleEnabled={(enabled) =>
						dsp.setLimiter({ ...dsp.limiter, enabled })
					}
					enableLabel="Enable peak safety limiter"
					note="Sample-peak backstop against EQ-boost overshoot — NOT a true-peak limiter (no oversampling). Proper gain staging still comes from the preamp."
					onReset={() => dsp.resetModule("limiter")}
				>
					<EnableRow
						label="Enable peak safety limiter"
						checked={dsp.limiter.enabled}
						onChange={(enabled) => dsp.setLimiter({ ...dsp.limiter, enabled })}
					/>
					<ParamSlider
						label="Ceiling"
						value={dsp.limiter.ceilingDb}
						min={-12}
						max={0}
						step={0.5}
						unit="dBFS"
						text={`limiter ceiling ${dsp.limiter.ceilingDb} dBFS`}
						onChange={(ceilingDb) =>
							dsp.setLimiter({ ...dsp.limiter, ceilingDb })
						}
					/>
				</CollapsibleModule>
			) : null}

			<Card
				id="behavioral"
				title="Listening Presets"
				note="Named starting points for common situations — subjective, not measurements, and everything stays editable afterwards."
			>
				<div className="flex flex-wrap gap-2">
					{BEHAVIORAL_PRESETS.map((preset) => (
						<button
							key={preset.id}
							type="button"
							title={preset.description}
							onClick={() => applyBehavioral(preset.id)}
							className="rounded-full border border-line px-3 py-1.5 text-xs hover:bg-elevated"
						>
							{preset.name}
						</button>
					))}
				</div>
			</Card>

			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs text-muted">
					PEQ bands are capped at {MAX_UI_BANDS} in the editor; the engine pool
					holds more for graphic + tone + loudness stages.
				</span>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() => useDspStore.getState().resetAll()}
					className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Reset all DSP
				</button>
			</div>
		</div>
	);
}
