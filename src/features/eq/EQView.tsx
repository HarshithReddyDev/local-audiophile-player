import { useMemo, useState } from "react";
import { Slider } from "../../components/ui/Slider";
import { suggestedPreampCompensation } from "../../dsp/preamp";
import type { EQBand, FilterType } from "../../dsp/types";
import { BAND_LIMITS, FILTER_TYPES, usesGain } from "../../dsp/types";
import { useDspStore } from "../../state/dsp-store";
import { MAX_UI_BANDS, useEQStore } from "../../state/eq-store";
import { useIEMStore } from "../../state/iem-store";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { useSettingsStore } from "../../state/settings-store";
import { LearnLink } from "../guides/LearnLink";
import { effectivePreampDb } from "../player/use-playback";
import { PresetLibrary } from "../presets/PresetLibrary";
import { ChainGraph } from "./ChainGraph";
import { GraphicEditor } from "./GraphicEditor";
import { PresetFormatActions, PresetImportControl } from "./PresetFormats";
import { ResponseGraph } from "./ResponseGraph";
import { useChainInput, useChainPeakBoost } from "./use-chain";

/** First genuine EQ interface: enable, preamp, bands, graph, presets. */
export function EQView({
	onOpenGuide,
}: {
	onOpenGuide?: ((guideId: string) => void) | undefined;
}) {
	const profile = useEQStore((s) => s.profile);
	const presets = useEQStore((s) => s.presets);
	const selectedProfileId = useSettingsStore((s) => s.selectedIemProfileId);
	const profiles = useIEMStore((s) => s.profiles);
	const selectedProfile =
		selectedProfileId != null ? (profiles[selectedProfileId] ?? null) : null;
	const [presetName, setPresetName] = useState("");
	const [editingPreset, setEditingPreset] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");

	const chain = useChainInput();
	const peak = useChainPeakBoost(chain);
	const suggestion = suggestedPreampCompensation(peak);
	const activeDeviceName = useDspStore((s) => s.activeDeviceName);
	const limiter = useDspStore((s) => s.limiter);
	const replayGainMode = useDspStore((s) => s.replayGainMode);
	const eqMode = useDspStore((s) => s.eqMode);
	const currentTrackId = usePlayerStore(
		(s) => s.queue[s.currentIndex]?.trackId ?? null,
	);
	const currentTrack = useLibraryStore((s) =>
		currentTrackId ? (s.tracks[currentTrackId] ?? null) : null,
	);
	const appliedPreamp = useMemo(
		() =>
			effectivePreampDb(
				profile.preamp,
				replayGainMode,
				currentTrack ?? undefined,
			),
		[profile.preamp, replayGainMode, currentTrack],
	);

	return (
		<div className="flex max-w-3xl flex-col gap-4">
			{eqMode === "graphic" ? null : <h2 className="sr-only">Parametric EQ</h2>}
			<div className="flex flex-wrap items-center gap-3">
				<label className="flex items-center gap-2 text-sm font-medium">
					<input
						type="checkbox"
						checked={profile.enabled}
						onChange={(e) => useEQStore.getState().setEnabled(e.target.checked)}
						aria-label="Enable parametric EQ"
					/>
					EQ enabled
				</label>
				<span className="text-xs text-muted">
					{profile.enabled
						? `${profile.bands.filter((b) => b.enabled).length} active bands`
						: "Bypassed — audio passes through untouched"}
				</span>
				<span className="flex-1" />
				<span className="text-xs text-muted" role="status">
					{selectedProfile
						? `IEM profile: ${selectedProfile.name}${selectedProfile.eq ? " (has generated EQ)" : " (no stored EQ)"}`
						: "IEM profile: none selected"}
				</span>
				<button
					type="button"
					onClick={() => useEQStore.getState().resetProfile()}
					className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					Reset EQ
				</button>
			</div>

			<div
				role="tablist"
				aria-label="EQ mode"
				className="flex gap-1 self-start rounded-full border border-line p-1"
			>
				{(
					[
						["parametric", "Parametric"],
						["graphic", "Graphic"],
					] as const
				).map(([mode, label]) => (
					<button
						key={mode}
						type="button"
						role="tab"
						aria-selected={eqMode === mode}
						onClick={() => useDspStore.getState().setEqMode(mode)}
						className={`rounded-full px-3 py-1 text-sm ${eqMode === mode ? "bg-elevated font-semibold" : "text-muted hover:text-ink"}`}
					>
						{label}
					</button>
				))}
			</div>

			<div className={profile.enabled ? undefined : "opacity-40"}>
				{activeDeviceName ? (
					<p className="mb-1 text-[13px] text-muted">
						Editing on top of{" "}
						<strong className="text-ink">{activeDeviceName}</strong>.{" "}
						<button
							type="button"
							onClick={() => useDspStore.getState().clearDevice()}
							className="text-accent hover:underline"
						>
							Use global
						</button>
					</p>
				) : null}
				{eqMode === "graphic" ? (
					<ChainGraph />
				) : (
					<ResponseGraph profile={profile} />
				)}
			</div>

			<section
				aria-labelledby="preamp-heading"
				className="rounded-xl border border-line bg-surface p-3"
			>
				<div className="flex items-center justify-between gap-2">
					<h2 id="preamp-heading" className="text-sm font-semibold">
						Preamp{" "}
						<span className="font-normal text-muted">
							{profile.preamp > 0
								? `+${profile.preamp.toFixed(1)}`
								: profile.preamp.toFixed(1)}{" "}
							dB
						</span>
					</h2>
					{profile.preamp !== 0 ? (
						<button
							type="button"
							onClick={() => useEQStore.getState().setPreamp(0)}
							className="text-xs text-muted hover:text-ink"
						>
							Reset
						</button>
					) : null}
				</div>
				<Slider
					label="Preamp gain"
					value={profile.preamp}
					min={BAND_LIMITS.preamp.min}
					max={BAND_LIMITS.preamp.max}
					step={0.5}
					textValue={`${profile.preamp.toFixed(1)} decibels`}
					onChange={(v) => useEQStore.getState().setPreamp(v)}
				/>
				{suggestion < 0 && profile.preamp > suggestion ? (
					<p className="mt-1 text-xs text-muted">
						Chain boosts peak at +{peak.toFixed(1)} dB (EQ + tone + tuner +
						loudness). Suggested preamp {suggestion.toFixed(1)} dB to protect
						headroom.{" "}
						<button
							type="button"
							onClick={() => useEQStore.getState().setPreamp(suggestion)}
							className="text-accent hover:underline"
						>
							Apply
						</button>
					</p>
				) : (
					<p className="mt-1 text-xs text-muted">
						Peak boost +{peak.toFixed(1)} dB · limiter{" "}
						{limiter.enabled
							? `on (ceiling ${limiter.ceilingDb.toFixed(1)} dBFS)`
							: "off"}
						.
					</p>
				)}
				<p className="mt-1 text-xs text-muted">
					Applied preamp {appliedPreamp.preampDb.toFixed(1)} dB
					{appliedPreamp.rgDb !== 0
						? ` (manual ${profile.preamp.toFixed(1)} + ReplayGain ${appliedPreamp.rgDb.toFixed(1)} from ${appliedPreamp.rgSource} tags, added once)`
						: replayGainMode !== "off"
							? ` (ReplayGain ${replayGainMode}: no usable tags on this track)`
							: " (ReplayGain off)"}
					.
				</p>
			</section>

			{eqMode === "graphic" ? (
				<section aria-labelledby="graphic-heading">
					<h2 id="graphic-heading" className="sr-only">
						Graphic EQ
					</h2>
					<GraphicEditor />
				</section>
			) : (
				<section
					aria-labelledby="bands-heading"
					className="flex flex-col gap-2"
				>
					<div className="flex items-center gap-2">
						<h2 id="bands-heading" className="text-sm font-semibold">
							Bands ({profile.bands.length}/{MAX_UI_BANDS})
						</h2>
						<span className="flex-1" />
						<AddBandControl disabled={profile.bands.length >= MAX_UI_BANDS} />
					</div>
					{profile.bands.length === 0 ? (
						<p className="rounded-xl border border-line bg-surface p-4 text-center text-sm text-muted">
							No bands yet. Add one to start shaping — peaking at 1 kHz is a
							good first experiment.
						</p>
					) : (
						<ol className="flex flex-col gap-2">
							{profile.bands.map((band, index) => (
								<BandRow key={band.id} band={band} index={index} />
							))}
						</ol>
					)}
				</section>
			)}

			<section
				aria-labelledby="presets-heading"
				className="rounded-xl border border-line bg-surface p-3"
			>
				<div className="mb-2 flex items-center gap-2">
					<h2 id="presets-heading" className="text-sm font-semibold">
						Presets
					</h2>
					<span className="flex-1" />
					<PresetImportControl />
				</div>
				<form
					className="mb-2 flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (useEQStore.getState().savePreset(presetName)) setPresetName("");
					}}
				>
					<label className="sr-only" htmlFor="preset-name">
						Preset name
					</label>
					<input
						id="preset-name"
						type="text"
						value={presetName}
						placeholder="Save current EQ as…"
						onChange={(e) => setPresetName(e.target.value)}
						className="min-w-40 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm outline-none placeholder:text-muted"
					/>
					<button
						type="submit"
						disabled={presetName.trim() === ""}
						className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
					>
						Save
					</button>
				</form>
				{presets.length === 0 ? (
					<p className="text-xs text-muted">No presets saved yet.</p>
				) : (
					<ul className="flex flex-col gap-1">
						{presets.map((preset) => (
							<li
								key={preset.id}
								className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 hover:bg-elevated"
							>
								{editingPreset === preset.id ? (
									<form
										className="flex min-w-0 flex-1 gap-1"
										onSubmit={(e) => {
											e.preventDefault();
											useEQStore.getState().renamePreset(preset.id, editValue);
											setEditingPreset(null);
										}}
									>
										<label className="sr-only" htmlFor={`rename-${preset.id}`}>
											Rename preset
										</label>
										<input
											id={`rename-${preset.id}`}
											type="text"
											value={editValue}
											onChange={(e) => setEditValue(e.target.value)}
											className="min-w-0 flex-1 rounded-md border border-line bg-abyss px-2 py-0.5 text-sm"
										/>
										<button type="submit" className="text-xs text-accent">
											Save
										</button>
									</form>
								) : (
									<>
										<button
											type="button"
											onClick={() =>
												useEQStore.getState().loadPreset(preset.id)
											}
											aria-label={`Load preset ${preset.name}`}
											className="min-w-32 flex-1 truncate text-left text-sm font-medium"
										>
											{preset.name}
										</button>
										<span className="text-[11px] text-muted">
											{preset.data.bands.length} bands
										</span>
										<button
											type="button"
											onClick={() => {
												setEditValue(preset.name);
												setEditingPreset(preset.id);
											}}
											aria-label={`Rename preset ${preset.name}`}
											className="text-xs text-muted hover:text-ink"
										>
											Rename
										</button>
										<button
											type="button"
											onClick={() =>
												useEQStore.getState().deletePreset(preset.id)
											}
											aria-label={`Delete preset ${preset.name}`}
											className="text-xs text-muted hover:text-ink"
										>
											Delete
										</button>
										<button
											type="button"
											onClick={() =>
												useEQStore.getState().togglePresetFavorite(preset.id)
											}
											aria-pressed={preset.favorite ?? false}
											aria-label={`Favorite preset ${preset.name}`}
											className="text-xs text-muted hover:text-ink"
										>
											{preset.favorite ? "★" : "☆"}
										</button>
									</>
								)}
								<PresetFormatActions preset={preset} />
							</li>
						))}
					</ul>
				)}
			</section>

			<section
				aria-labelledby="builtin-presets-heading"
				className="rounded-xl border border-line bg-surface p-3"
			>
				<div className="mb-2 flex items-center gap-2">
					<h2 id="builtin-presets-heading" className="text-sm font-semibold">
						Built-in presets
					</h2>
					<span className="flex-1" />
					<LearnLink guideId="eq-iem" onOpenGuide={onOpenGuide} />
				</div>
				<PresetLibrary />
			</section>

			<aside
				aria-label="Quick EQ tips"
				className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted"
			>
				<span className="font-semibold text-ink">Quick tips:</span> start flat ·
				small changes · keep headroom (apply the suggested preamp) · A/B at
				matched loudness · don&apos;t chase every measurement wiggle.{" "}
				<LearnLink
					guideId="eq-basics"
					onOpenGuide={onOpenGuide}
					label="EQ basics"
				/>
			</aside>
		</div>
	);
}

function AddBandControl({ disabled }: { disabled: boolean }) {
	const [type, setType] = useState<FilterType>("peaking");
	return (
		<span className="flex items-center gap-1">
			<label className="sr-only" htmlFor="new-band-type">
				New band type
			</label>
			<select
				id="new-band-type"
				value={type}
				disabled={disabled}
				onChange={(e) => setType(e.target.value as FilterType)}
				className="rounded-md border border-line bg-surface px-1 py-1 text-xs"
			>
				{FILTER_TYPES.map((t) => (
					<option key={t} value={t}>
						{t}
					</option>
				))}
			</select>
			<button
				type="button"
				disabled={disabled}
				onClick={() => useEQStore.getState().addBand(type)}
				className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-40"
			>
				Add band
			</button>
		</span>
	);
}

function BandRow({ band, index }: { band: EQBand; index: number }) {
	const store = useEQStore.getState();
	const gain = usesGain(band.type);
	return (
		<li className="rounded-xl border border-line bg-surface p-3">
			<div className="mb-2 flex items-center gap-2">
				<label className="flex items-center gap-1 text-xs">
					<input
						type="checkbox"
						checked={band.enabled}
						onChange={(e) =>
							store.updateBand(band.id, { enabled: e.target.checked })
						}
						aria-label={`Enable band ${index + 1}`}
					/>
				</label>
				<span className="text-xs font-semibold text-muted">#{index + 1}</span>
				<label className="flex items-center gap-1 text-xs">
					Type
					<select
						value={band.type}
						onChange={(e) =>
							store.updateBand(band.id, { type: e.target.value as FilterType })
						}
						aria-label={`Band ${index + 1} type`}
						className="rounded-md border border-line bg-abyss px-1 py-0.5 text-xs"
					>
						{FILTER_TYPES.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				</label>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() => store.removeBand(band.id)}
					aria-label={`Remove band ${index + 1}`}
					className="rounded-md px-2 py-0.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					Remove
				</button>
			</div>
			<div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
				<BandControl
					label="Frequency"
					value={band.frequency}
					min={20}
					max={20000}
					step={1}
					unit="Hz"
					text={`${band.frequency} hertz`}
					log
					onChange={(frequency) => store.updateBand(band.id, { frequency })}
				/>
				<BandControl
					label="Gain"
					value={band.gain}
					min={BAND_LIMITS.gain.min}
					max={BAND_LIMITS.gain.max}
					step={0.5}
					unit="dB"
					text={`${band.gain} decibels`}
					disabled={!gain}
					onChange={(gainValue) =>
						store.updateBand(band.id, { gain: gainValue })
					}
				/>
				<BandControl
					label="Q"
					value={band.q}
					min={BAND_LIMITS.q.min}
					max={BAND_LIMITS.q.max}
					step={0.05}
					unit=""
					text={`Q ${band.q}`}
					disabled={band.type === "lowshelf" || band.type === "highshelf"}
					disabledNote="fixed slope"
					onChange={(q) => store.updateBand(band.id, { q })}
				/>
			</div>
		</li>
	);
}

function BandControl({
	label,
	value,
	min,
	max,
	step,
	unit,
	text,
	log,
	disabled,
	disabledNote,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	text: string;
	log?: boolean;
	disabled?: boolean;
	disabledNote?: string;
	onChange: (value: number) => void;
}) {
	// Frequency edits on a log scale: slider position maps exponentially.
	const toSlider = log
		? (v: number) =>
				((Math.log10(Math.max(min, v)) - Math.log10(min)) /
					(Math.log10(max) - Math.log10(min))) *
				100
		: (v: number) => v;
	const fromSlider = log
		? (s: number) =>
				Math.round(
					10 **
						(Math.log10(min) + (s / 100) * (Math.log10(max) - Math.log10(min))),
				)
		: (s: number) => s;
	const sliderMin = log ? 0 : min;
	const sliderMax = log ? 100 : max;
	const sliderStep = log ? 0.5 : step;
	return (
		<div className={disabled ? "opacity-40" : undefined}>
			<div className="flex items-baseline justify-between gap-2">
				<label className="text-xs text-muted">
					{label}
					{disabled && disabledNote ? ` (${disabledNote})` : ""}
				</label>
				<span className="flex items-center gap-1 text-xs tabular-nums">
					<input
						type="number"
						value={Math.round(value * 100) / 100}
						min={min}
						max={max}
						step={step}
						disabled={disabled}
						onChange={(e) => onChange(Number(e.target.value))}
						aria-label={`${label} value in ${unit || "units"}`}
						className="w-20 rounded-md border border-line bg-abyss px-1 py-0.5 text-right text-xs"
					/>
					<span className="text-muted">{unit}</span>
				</span>
			</div>
			<Slider
				label={label}
				value={toSlider(value)}
				min={sliderMin}
				max={sliderMax}
				step={sliderStep}
				disabled={disabled ?? false}
				textValue={text}
				onChange={(v) => onChange(fromSlider(v))}
			/>
		</div>
	);
}
