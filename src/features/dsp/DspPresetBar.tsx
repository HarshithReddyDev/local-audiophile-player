import { useState } from "react";
import { useEQStore } from "../../state/eq-store";
import { PresetFormatActions, PresetImportControl } from "../eq/PresetFormats";

/**
 * DSP workspace preset bar: pick a user preset, save the current EQ
 * under a new name, reset the editor, import/export files. Overwriting
 * is never silent — Save As always creates a new entry.
 */
export function DspPresetBar() {
	const presets = useEQStore((s) => s.presets);
	const [selectedId, setSelectedId] = useState("");
	const [name, setName] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const selected = presets.find((p) => p.id === selectedId) ?? null;

	const loadSelected = (id: string): void => {
		setSelectedId(id);
		if (id === "") return;
		useEQStore.getState().loadPreset(id);
		const preset = useEQStore.getState().presets.find((p) => p.id === id);
		setStatus(preset ? `Loaded preset “${preset.name}”.` : null);
	};

	const saveAs = (): void => {
		const id = useEQStore.getState().savePreset(name);
		if (id) {
			setName("");
			setSelectedId(id);
			setStatus("Preset saved.");
		} else {
			setStatus("Give the preset a name first.");
		}
	};

	return (
		<section
			aria-label="DSP preset bar"
			className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<label className="flex items-center gap-2 text-xs">
					Preset
					<select
						value={selectedId}
						onChange={(e) => loadSelected(e.target.value)}
						aria-label="Load user preset"
						className="max-w-44 rounded-md border border-line bg-abyss px-2 py-1 text-xs"
					>
						<option value="">Choose…</option>
						{presets.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</label>
				<label className="sr-only" htmlFor="dsp-preset-name">
					New preset name
				</label>
				<input
					id="dsp-preset-name"
					type="text"
					value={name}
					placeholder="Save current as…"
					onChange={(e) => setName(e.target.value)}
					className="min-w-32 flex-1 rounded-full border border-line bg-abyss px-3 py-1 text-xs outline-none placeholder:text-muted sm:flex-none"
				/>
				<button
					type="button"
					onClick={saveAs}
					className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
				>
					Save As
				</button>
				<button
					type="button"
					onClick={() => {
						if (
							window.confirm(
								"Reset the EQ editor to flat? Saved presets are kept.",
							)
						) {
							useEQStore.getState().resetProfile();
							setStatus("Editor reset to flat. Presets kept.");
						}
					}}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Reset
				</button>
				<PresetImportControl />
			</div>
			{selected ? <PresetFormatActions preset={selected} /> : null}
			{status ? (
				<p role="status" className="text-xs text-muted">
					{status}
				</p>
			) : null}
		</section>
	);
}
