import { useEffect, useMemo, useRef, useState } from "react";
import type {
	FitRangePresetId,
	FitResult,
	HfTreatment,
} from "../../dsp/autoeq";
import {
	FIT_RANGE_PRESETS,
	OPTIMIZER_VERSION,
	resolvePresetRange,
} from "../../dsp/autoeq";
import type { ResponseCurve } from "../../dsp/curves";
import { interpolateLog, resampleLog } from "../../dsp/curves";
import { peqMagnitudeDb } from "../../dsp/response";
import type { SmoothingPresetId } from "../../dsp/smoothing";
import { SMOOTHING_PRESETS, smoothByPreset } from "../../dsp/smoothing";
import type { PEQProfile } from "../../dsp/types";
import { libraryService } from "../../library/library-service";
import { useEQStore } from "../../state/eq-store";
import { useIEMStore } from "../../state/iem-store";
import type { FitProgress } from "../../workers/autoeq-client";
import { AutoEQCancelled, runAutoEQFit } from "../../workers/autoeq-client";
import { LearnLink } from "../guides/LearnLink";
import { CurveGraph } from "./CurveGraph";

type Phase = "idle" | "running" | "done" | "error";

const STAGE_LABEL: Record<string, string> = {
	gridding: "Analyzing measurement…",
	placing: "Placing filters…",
	refining: "Refining…",
};

function formatHz(f: number): string {
	return f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`;
}

const HF_NOTE: Record<HfTreatment, string> = {
	average: "averaged above 10 kHz",
	fit: "fitted as measured",
	exclude: "ignored above 10 kHz",
};

/**
 * Engineering A/B: toggles the live EQ (the applied profile) against bypass
 * with the level difference stated up front. No double application — one
 * profile, one enable flag. The estimate is mean-dB, not LUFS: match levels
 * by ear before judging, since louder almost always sounds "better".
 */
function CompareControl() {
	const enabled = useEQStore((s) => s.profile.enabled);
	const profile = useEQStore((s) => s.profile);
	const levelDb = useMemo(() => {
		if (profile.bands.length === 0) return 0;
		const grid = resampleLog(
			{ frequencies: [20, 20000], gains: [0, 0] },
			64,
			20,
			20000,
		);
		let sum = 0;
		for (const f of grid.frequencies) sum += peqMagnitudeDb(profile, f, 48000);
		return sum / grid.frequencies.length;
	}, [profile]);
	return (
		<div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
			<button
				type="button"
				onClick={() => useEQStore.getState().setEnabled(!enabled)}
				aria-pressed={enabled}
				className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
			>
				{enabled ? "Bypass EQ (hear original)" : "Enable EQ (hear correction)"}
			</button>
			<span className="text-[11px] text-muted">
				Estimated level vs bypass: {levelDb >= 0 ? "+" : ""}
				{levelDb.toFixed(1)} dB average. Not loudness-matched — louder can sound
				better regardless of EQ.
			</span>
		</div>
	);
}

/** AutoEQ workflow: options → fit (worker) → preview → apply/discard. */
export function AutoEQPanel({ profileId }: { profileId: string }) {
	const profile = useIEMStore((s) => s.profiles[profileId]);
	const measurements = useIEMStore((s) => s.measurements);
	const targets = useIEMStore((s) => s.targets);
	const [maxBands, setMaxBands] = useState(8);
	const [maxGain, setMaxGain] = useState(12);
	const [fitPreset, setFitPreset] = useState<FitRangePresetId>("full");
	const [rangeMin, setRangeMin] = useState(20);
	const [rangeMax, setRangeMax] = useState(20000);
	const [hfTreatment, setHfTreatment] = useState<HfTreatment>("average");
	const [smoothing, setSmoothing] = useState<SmoothingPresetId>("off");
	const [shelves, setShelves] = useState(true);
	const [phase, setPhase] = useState<Phase>("idle");
	const [progress, setProgress] = useState<FitProgress | null>(null);
	const [result, setResult] = useState<FitResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const runRef = useRef(0);
	const cancelRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			runRef.current += 1;
			cancelRef.current?.();
		};
	}, []);

	const measurement = profile?.measurementId
		? (measurements[profile.measurementId] ?? null)
		: null;
	const target = (() => {
		if (!profile?.targetId) return null;
		if (profile.targetId === "builtin-flat") {
			return { frequencies: [20, 20000], gains: [0, 0] };
		}
		return targets[profile.targetId] ?? null;
	})();

	const predicted = useMemo(() => {
		if (!result || !measurement || !target) return null;
		const eq: PEQProfile = {
			preamp: result.profile.preamp,
			enabled: true,
			bands: result.profile.bands.map((b, i) => ({ ...b, id: `preview-${i}` })),
		};
		// The curve used for fitting: raw measurement, or its smoothed
		// derivative when smoothing is enabled (raw is never modified).
		let fitting: ResponseCurve = {
			frequencies: measurement.frequencies,
			gains: measurement.gains,
		};
		let smoothed: ResponseCurve | null = null;
		if (smoothing !== "off") {
			try {
				smoothed = smoothByPreset(fitting, smoothing);
				fitting = smoothed;
			} catch {
				smoothed = null;
			}
		}
		const grid = resampleLog(fitting, 128, 20, 20000);
		const gains = grid.frequencies.map(
			(f, i) => (grid.gains[i] ?? 0) + peqMagnitudeDb(eq, f, 48000),
		);
		const predictedCurve: ResponseCurve = {
			frequencies: grid.frequencies,
			gains,
		};
		const targetCurve: ResponseCurve = {
			frequencies: target.frequencies,
			gains: target.gains,
		};
		const residual: ResponseCurve = {
			frequencies: grid.frequencies,
			gains: grid.gains.map((_, i) => {
				const t = target
					? (interpolateLog(
							{ frequencies: target.frequencies, gains: target.gains },
							grid.frequencies[i] ?? 20,
						) ?? 0)
					: 0;
				return (gains[i] ?? 0) - t;
			}),
		};
		const rawCurve: ResponseCurve = {
			frequencies: measurement.frequencies,
			gains: measurement.gains,
		};
		return { predictedCurve, residual, targetCurve, smoothed, rawCurve };
	}, [result, measurement, target, smoothing]);

	if (!profile) return null;

	const canRun = measurement !== null && target !== null && phase !== "running";
	const { minFrequency, maxFrequency } = resolvePresetRange(
		fitPreset,
		rangeMin,
		rangeMax,
	);

	const start = () => {
		if (!measurement || !target) return;
		const run = (runRef.current += 1);
		cancelRef.current?.();
		setPhase("running");
		setError(null);
		setResult(null);
		setProgress({ stage: "gridding", done: 0, total: 1 });
		// Optional preprocessing (Phase 8D): derive the fitting input from
		// the raw measurement. Synchronous and millisecond-fast, so it runs
		// before worker dispatch without affecting cancellation. The raw
		// measurement is never modified.
		let fitting: ResponseCurve;
		try {
			fitting =
				smoothing === "off"
					? {
							frequencies: measurement.frequencies,
							gains: measurement.gains,
						}
					: smoothByPreset(
							{
								frequencies: measurement.frequencies,
								gains: measurement.gains,
							},
							smoothing,
						);
		} catch (e) {
			setProgress(null);
			setError(e instanceof Error ? e.message : "Smoothing failed.");
			setPhase("error");
			return;
		}
		const handle = runAutoEQFit(
			{
				measurement: fitting,
				target: { frequencies: target.frequencies, gains: target.gains },
				frequencyRange: { min: minFrequency, max: maxFrequency },
				fittingOptions: {
					maxBands,
					maxGainDb: maxGain,
					preferParametric: true,
				},
			},
			{
				minFrequency,
				maxFrequency,
				maxBands,
				maxBoostDb: maxGain,
				maxCutDb: maxGain,
				allowLowShelf: shelves,
				allowHighShelf: shelves,
				hfTreatment,
				hfKneeHz: 10000,
			},
			(p) => {
				if (runRef.current === run) setProgress(p);
			},
		);
		cancelRef.current = handle.cancel;
		void handle.promise.then(
			(r) => {
				if (runRef.current !== run) return; // stale generation: drop
				setResult(r);
				setProgress(null);
				setPhase("done");
			},
			(e) => {
				if (runRef.current !== run) return;
				setProgress(null);
				if (e instanceof AutoEQCancelled) {
					setPhase("idle");
				} else {
					setError(e instanceof Error ? e.message : "Fitting failed.");
					setPhase("error");
				}
			},
		);
	};

	const apply = () => {
		if (!result) return;
		void libraryService
			.applyAutoEQResult(profile.id, result.profile, {
				optimizerVersion: result.metrics.optimizerVersion,
				fittedAt: Date.now(),
				rmsAfterDb: result.metrics.rmsAfterDb,
				maxBands,
				hfTreatment: result.metrics.hfTreatment,
				fitRangePreset: fitPreset,
				effectiveRangeHz: result.metrics.rangeHz,
				smoothingPreset: smoothing,
			})
			.then(() => {
				setResult(null);
				setPhase("idle");
			})
			.catch((e: unknown) => {
				// Persistence (e.g. IDB quota) failed after a good fit: keep
				// the preview so nothing is lost, and say what happened.
				setError(
					e instanceof Error
						? `Could not save the result: ${e.message}`
						: "Could not save the result.",
				);
				setPhase("error");
			});
	};

	return (
		<section
			aria-label="Automatic EQ"
			className="rounded-xl border border-line bg-surface p-3"
		>
			<div className="mb-1 flex items-center gap-2">
				<h3 className="text-sm font-semibold">Automatic EQ</h3>
				<span className="flex-1" />
				<LearnLink guideId="autoeq" />
			</div>
			{profile.eq && profile.eqMeta ? (
				<>
					<p className="mb-2 text-xs text-muted" role="status">
						Generated {new Date(profile.eqMeta.fittedAt).toLocaleDateString()} ·{" "}
						{profile.eq.bands.length} bands · residual RMS{" "}
						{profile.eqMeta.rmsAfterDb.toFixed(2)} dB · optimizer v
						{profile.eqMeta.optimizerVersion}. Editable in the EQ section.
					</p>
					<CompareControl />
				</>
			) : (
				<p className="mb-2 text-xs text-muted">
					Fit PEQ bands to this profile's correction curve, on this device.
					Preview first — nothing is applied until you choose Apply.
				</p>
			)}

			<div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
				<label className="flex flex-col gap-1 text-xs text-muted">
					Max bands
					<select
						value={maxBands}
						onChange={(e) => setMaxBands(Number(e.target.value))}
						disabled={phase === "running"}
						className="rounded-md border border-line bg-abyss px-2 py-1 text-sm text-ink"
					>
						{[4, 6, 8, 10, 12].map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Max gain ±dB
					<select
						value={maxGain}
						onChange={(e) => setMaxGain(Number(e.target.value))}
						disabled={phase === "running"}
						className="rounded-md border border-line bg-abyss px-2 py-1 text-sm text-ink"
					>
						{[6, 12].map((n) => (
							<option key={n} value={n}>
								±{n}
							</option>
						))}
					</select>
				</label>
				<fieldset className="col-span-2">
					<legend className="text-xs text-muted">Fit range</legend>
					<div
						className="flex flex-wrap gap-x-3 gap-y-1"
						role="radiogroup"
						aria-label="Fit range preset"
					>
						{FIT_RANGE_PRESETS.map((preset) => (
							<label
								key={preset.id}
								title={preset.description}
								className="flex items-center gap-1 text-xs text-muted"
							>
								<input
									type="radio"
									name="autoeq-fit-range"
									value={preset.id}
									checked={fitPreset === preset.id}
									disabled={phase === "running"}
									onChange={() => setFitPreset(preset.id)}
								/>
								{preset.label}
							</label>
						))}
					</div>
					{fitPreset === "custom" ? (
						<span className="mt-1 flex items-center gap-1 text-xs text-muted">
							Custom range
							<select
								value={rangeMin}
								onChange={(e) => setRangeMin(Number(e.target.value))}
								disabled={phase === "running"}
								aria-label="Fit range minimum"
								className="rounded-md border border-line bg-abyss px-1 py-1 text-sm text-ink"
							>
								{[10, 20, 50, 100].map((n) => (
									<option key={n} value={n}>
										{n}
									</option>
								))}
							</select>
							–
							<select
								value={rangeMax}
								onChange={(e) => setRangeMax(Number(e.target.value))}
								disabled={phase === "running"}
								aria-label="Fit range maximum"
								className="rounded-md border border-line bg-abyss px-1 py-1 text-sm text-ink"
							>
								{[8000, 10000, 16000, 20000].map((n) => (
									<option key={n} value={n}>
										{n / 1000}k
									</option>
								))}
							</select>
							Hz
						</span>
					) : (
						<p className="mt-1 text-[11px] text-muted">
							{FIT_RANGE_PRESETS.find((p) => p.id === fitPreset)?.description}{" "}
							Range is always clamped to the measured data — never extrapolated.
						</p>
					)}
				</fieldset>
				<label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
					High-frequency treatment
					<select
						value={hfTreatment}
						onChange={(e) => setHfTreatment(e.target.value as HfTreatment)}
						disabled={phase === "running"}
						className="rounded-md border border-line bg-abyss px-2 py-1 text-sm text-ink"
					>
						<option value="average">Average above 10 kHz (recommended)</option>
						<option value="fit">Fit as measured</option>
						<option value="exclude">Ignore above 10 kHz</option>
					</select>
					<span className="text-[11px]">
						High-frequency measurement behavior is often less reliable. This
						controls how frequencies above 10 kHz are treated during fitting:
						averaged for stability, fitted as measured for trusted rigs, or
						ignored entirely.
					</span>
				</label>
				<fieldset className="col-span-2">
					<legend className="text-xs text-muted">Smoothing</legend>
					<div
						className="flex flex-wrap gap-x-3 gap-y-1"
						role="radiogroup"
						aria-label="Measurement smoothing"
					>
						{SMOOTHING_PRESETS.map((preset) => (
							<label
								key={preset.id}
								title={preset.description}
								className="flex items-center gap-1 text-xs text-muted"
							>
								<input
									type="radio"
									name="autoeq-smoothing"
									value={preset.id}
									checked={smoothing === preset.id}
									disabled={phase === "running"}
									onChange={() => setSmoothing(preset.id as SmoothingPresetId)}
								/>
								{preset.label}
							</label>
						))}
					</div>
					<p className="mt-1 text-[11px] text-muted">
						Reduces small measurement fluctuations before EQ fitting. Stronger
						smoothing can ignore legitimate narrow features. The imported
						measurement is never modified — smoothing derives a separate fitting
						curve, shown in the preview when enabled.
					</p>
				</fieldset>
				<label className="flex items-center gap-2 text-xs text-muted">
					<input
						type="checkbox"
						checked={shelves}
						disabled={phase === "running"}
						onChange={(e) => setShelves(e.target.checked)}
					/>
					Shelf filters
				</label>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{phase === "running" ? (
					<>
						<button
							type="button"
							onClick={() => cancelRef.current?.()}
							className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-elevated"
						>
							Cancel
						</button>
						<span role="status" className="text-xs text-muted">
							{progress ? (
								<>
									{STAGE_LABEL[progress.stage] ?? progress.stage}{" "}
									{progress.total > 1
										? `${progress.done}/${progress.total}`
										: null}
								</>
							) : (
								"Starting…"
							)}
						</span>
					</>
				) : (
					<button
						type="button"
						disabled={!canRun}
						onClick={start}
						className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
					>
						Generate EQ
					</button>
				)}
				{!measurement || !target ? (
					<span className="text-xs text-muted">
						Select a measurement and target above first.
					</span>
				) : null}
			</div>

			{phase === "error" && error ? (
				<p role="alert" className="mt-2 text-sm text-red-300">
					{error}
				</p>
			) : null}

			{result ? (
				<div className="mt-3 flex flex-col gap-2">
					<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
						<div className="flex justify-between gap-2">
							<dt className="text-muted">RMS before → after</dt>
							<dd className="tabular-nums">
								{result.metrics.rmsBeforeDb.toFixed(2)} →{" "}
								{result.metrics.rmsAfterDb.toFixed(2)} dB
							</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt className="text-muted">Max residual</dt>
							<dd className="tabular-nums">
								{result.metrics.maxAbsAfterDb.toFixed(2)} dB
							</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt className="text-muted">Bands</dt>
							<dd className="tabular-nums">{result.metrics.bands}</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt className="text-muted">Preamp</dt>
							<dd className="tabular-nums">
								{result.metrics.preampDb.toFixed(1)} dB
							</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt className="text-muted">Effective range</dt>
							<dd className="tabular-nums">
								{formatHz(result.metrics.rangeHz[0])}–
								{formatHz(result.metrics.rangeHz[1])}
							</dd>
						</div>
					</dl>
					{predicted ? (
						<CurveGraph
							series={[
								{
									id: "t",
									label: "Target",
									color: "muted",
									curve: predicted.targetCurve,
								},
								...(predicted.smoothed
									? [
											{
												id: "m",
												label: "Measurement (raw)",
												color: "muted" as const,
												curve: predicted.rawCurve,
											},
											{
												id: "s",
												label: "Fitting curve (smoothed)",
												color: "teal" as const,
												curve: predicted.smoothed,
											},
										]
									: []),
								{
									id: "p",
									label: "Predicted corrected",
									color: "accent",
									curve: predicted.predictedCurve,
								},
								{
									id: "r",
									label: "Residual",
									color: "warn",
									curve: predicted.residual,
								},
							]}
						/>
					) : null}
					<table className="w-full text-xs">
						<caption className="sr-only">Generated filters</caption>
						<thead>
							<tr className="text-left text-muted">
								<th className="py-1 pr-2 font-normal">Type</th>
								<th className="py-1 pr-2 font-normal">Freq</th>
								<th className="py-1 pr-2 font-normal">Gain</th>
								<th className="py-1 font-normal">Q</th>
							</tr>
						</thead>
						<tbody>
							{result.profile.bands.map((b, i) => (
								<tr key={i} className="border-t border-line tabular-nums">
									<td className="py-1 pr-2">{b.type}</td>
									<td className="py-1 pr-2">
										{b.frequency >= 1000
											? `${(b.frequency / 1000).toFixed(1)}k`
											: Math.round(b.frequency)}
									</td>
									<td className="py-1 pr-2">
										{b.gain > 0 ? "+" : ""}
										{b.gain.toFixed(1)}
									</td>
									<td className="py-1">{b.q.toFixed(2)}</td>
								</tr>
							))}
						</tbody>
					</table>
					<p className="text-[11px] text-muted">
						Optimizer v{OPTIMIZER_VERSION} · {result.metrics.elapsedMs} ms ·
						preamp covers +{result.metrics.maxBoostDb.toFixed(1)} dB boost · HF{" "}
						{HF_NOTE[result.metrics.hfTreatment]}
						{smoothing !== "off"
							? ` · Smoothing: ${SMOOTHING_PRESETS.find((p) => p.id === smoothing)?.label ?? smoothing}`
							: null}
						. Applies as normal editable EQ.
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={apply}
							className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink"
						>
							Apply to EQ
						</button>
						<button
							type="button"
							onClick={() => {
								setResult(null);
								setPhase("idle");
							}}
							className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-elevated"
						>
							Discard
						</button>
					</div>
				</div>
			) : null}
		</section>
	);
}
