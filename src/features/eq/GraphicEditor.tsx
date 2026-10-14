import { useState } from "react";
import {
	GRAPHIC_GAIN_DB,
	GRAPHIC_LAYOUTS,
	graphicLayout,
	sampleToGraphic,
} from "../../dsp/graphic";
import { peqMagnitudeDb } from "../../dsp/response";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";

/**
 * Graphic EQ editor: fixed-center sliders driving the same biquad pool
 * as parametric mode (no second DSP). Switching modes never destroys the
 * other mode's data — both persist side by side.
 */
export function GraphicEditor() {
	const graphic = useDspStore((s) => s.graphic);
	const [name, setName] = useState("");
	const layout = graphicLayout(graphic.layoutId);

	const setGain = (index: number, gain: number): void => {
		const gains = graphic.gains.slice();
		gains[index] = Math.min(
			GRAPHIC_GAIN_DB.max,
			Math.max(GRAPHIC_GAIN_DB.min, gain),
		);
		useDspStore.getState().setGraphic({ ...graphic, gains });
	};

	const adoptParametric = (): void => {
		// Sample the live parametric response at the layout centers.
		// Stated as approximation in the button-adjacent copy.
		const profile = useEQStore.getState().profile;
		const sampled = sampleToGraphic(
			graphic.layoutId,
			(f) => peqMagnitudeDb(profile, f, 48000) - profile.preamp,
		);
		useDspStore.getState().setGraphic({ ...sampled, enabled: true });
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<label className="flex items-center gap-2 text-xs">
					Layout
					<select
						value={graphic.layoutId}
						onChange={(e) => {
							const next = graphicLayout(e.target.value);
							if (next)
								useDspStore.getState().setGraphic({
									layoutId: next.id,
									gains: next.centers.map(() => 0),
									enabled: graphic.enabled,
								});
						}}
						aria-label="Graphic EQ layout"
						className="rounded-md border border-line bg-surface px-1 py-1 text-xs"
					>
						{GRAPHIC_LAYOUTS.map((l) => (
							<option key={l.id} value={l.id}>
								{l.label}
							</option>
						))}
					</select>
				</label>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() =>
						useDspStore.getState().setGraphic({
							...graphic,
							gains: graphic.gains.map(() => 0),
						})
					}
					className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Flatten
				</button>
				<button
					type="button"
					onClick={adoptParametric}
					title="Approximate the current parametric curve with these sliders"
					className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Match parametric (approx)
				</button>
			</div>
			<div
				className="grid gap-x-4 gap-y-3"
				style={{
					gridTemplateColumns: `repeat(${Math.min(layout?.centers.length ?? 10, 8)}, minmax(0, 1fr))`,
				}}
			>
				{(layout?.centers ?? []).map((frequency, i) => (
					<div key={frequency} className="flex flex-col items-center gap-1">
						<span className="text-[11px] tabular-nums text-accent">
							{(graphic.gains[i] ?? 0) > 0 ? "+" : ""}
							{(graphic.gains[i] ?? 0).toFixed(1)}
						</span>
						<div className="flex h-32 items-stretch justify-center">
							<VerticalSlider
								label={`${frequency >= 1000 ? `${frequency / 1000} kilohertz` : `${frequency} hertz`} band gain`}
								value={graphic.gains[i] ?? 0}
								onChange={(v) => setGain(i, v)}
							/>
						</div>
						<span className="text-[10px] text-muted">
							{frequency >= 1000
								? `${Math.round((frequency / 1000) * 10) / 10}k`
								: frequency}
						</span>
					</div>
				))}
			</div>
			<p className="text-xs text-muted">
				Fixed centers, constant Q 1.0, ±12 dB. "Match parametric" samples the
				parametric curve — an approximation, not a conversion.
			</p>
			<GraphicPresets name={name} onName={setName} />
		</div>
	);
}

function VerticalSlider({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<input
			type="range"
			aria-label={label}
			aria-valuetext={`${value.toFixed(1)} decibels`}
			min={GRAPHIC_GAIN_DB.min}
			max={GRAPHIC_GAIN_DB.max}
			step={0.5}
			value={value}
			onChange={(e) => onChange(Number(e.target.value))}
			className="h-32 w-6 cursor-pointer"
			style={{ writingMode: "vertical-lr", direction: "rtl" }}
		/>
	);
}

function GraphicPresets({
	name,
	onName,
}: {
	name: string;
	onName: (value: string) => void;
}) {
	const presets = useDspStore((s) => s.graphicPresets);
	const [editing, setEditing] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");
	return (
		<div className="rounded-xl border border-line bg-surface p-3">
			<h3 className="mb-2 text-sm font-semibold">Graphic presets</h3>
			<form
				className="mb-2 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (useDspStore.getState().saveGraphicPreset(name)) onName("");
				}}
			>
				<label className="sr-only" htmlFor="graphic-preset-name">
					Graphic preset name
				</label>
				<input
					id="graphic-preset-name"
					type="text"
					value={name}
					placeholder="Save current sliders as…"
					onChange={(e) => onName(e.target.value)}
					className="min-w-40 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm outline-none placeholder:text-muted"
				/>
				<button
					type="submit"
					disabled={name.trim() === ""}
					className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
				>
					Save
				</button>
			</form>
			{presets.length === 0 ? (
				<p className="text-xs text-muted">No graphic presets saved yet.</p>
			) : (
				<ul className="flex flex-col gap-1">
					{presets.map((preset) => (
						<li
							key={preset.id}
							className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-elevated"
						>
							{editing === preset.id ? (
								<form
									className="flex min-w-0 flex-1 gap-1"
									onSubmit={(e) => {
										e.preventDefault();
										useDspStore
											.getState()
											.renameGraphicPreset(preset.id, editValue);
										setEditing(null);
									}}
								>
									<label className="sr-only" htmlFor={`grename-${preset.id}`}>
										Rename graphic preset
									</label>
									<input
										id={`grename-${preset.id}`}
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
											useDspStore.getState().loadGraphicPreset(preset.id)
										}
										aria-label={`Load graphic preset ${preset.name}`}
										className="min-w-0 flex-1 truncate text-left text-sm font-medium"
									>
										{preset.name}
									</button>
									<button
										type="button"
										onClick={() => {
											setEditValue(preset.name);
											setEditing(preset.id);
										}}
										aria-label={`Rename graphic preset ${preset.name}`}
										className="text-xs text-muted hover:text-ink"
									>
										Rename
									</button>
									<button
										type="button"
										onClick={() =>
											useDspStore.getState().deleteGraphicPreset(preset.id)
										}
										aria-label={`Delete graphic preset ${preset.name}`}
										className="text-xs text-muted hover:text-ink"
									>
										Delete
									</button>
								</>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
