import { useRef, useState } from "react";
import {
	exportPresetFile,
	importPresetFile,
	PresetFileError,
} from "../../catalog/preset-file";
import type { PresetOrigin } from "../../catalog/types";
import {
	exportCurveCsv,
	exportGraphicEq,
	exportParametricText,
	parseCurveCsv,
	parseGraphicEq,
	parseParametricText,
} from "../../dsp/formats";
import type { EQPreset } from "../../state/eq-store";
import { useEQStore } from "../../state/eq-store";

function download(name: string, text: string, mime = "application/json"): void {
	const blob = new Blob([text], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(name: string): string {
	const cleaned = name.replaceAll(/[^\w\- ]+/g, "").trim();
	return cleaned === "" ? "preset" : cleaned;
}

/** Standalone preset-file import (native JSON, parametric text, GraphicEQ, CSV). */
export function PresetImportControl() {
	const fileRef = useRef<HTMLInputElement>(null);
	const [message, setImportMessage] = useState<string | null>(null);
	return (
		<span className="inline-flex items-center gap-2">
			<label className="cursor-pointer rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated">
				Import file
				<input
					ref={fileRef}
					type="file"
					accept=".json,.txt,.csv,.preset.json"
					className="sr-only"
					aria-label="Import preset file"
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = "";
						if (file) void importPresetFileIntoLibrary(file, setImportMessage);
					}}
				/>
			</label>
			{message ? (
				<span role="status" className="text-[11px] text-muted">
					{message}
				</span>
			) : null}
		</span>
	);
}

async function importPresetFileIntoLibrary(
	file: File,
	setMessage: (message: string | null) => void,
): Promise<void> {
	setMessage(null);
	const text = await file.text();
	// 1. Native JSON (lossless, validated).
	try {
		const parsed = importPresetFile(text);
		const nativeMeta: {
			origin: PresetOrigin | "user";
			deviceName?: string;
		} = {
			origin: parsed.origin === "user" ? "user" : parsed.origin,
		};
		if (parsed.deviceName !== null) nativeMeta.deviceName = parsed.deviceName;
		const id = useEQStore
			.getState()
			.importPreset(parsed.name, parsed.peq, nativeMeta);
		setMessage(
			id ? `Imported "${parsed.name}".` : "That preset could not be imported.",
		);
		return;
	} catch (error) {
		if (!(error instanceof PresetFileError)) {
			setMessage("That file could not be read.");
			return;
		}
		// Fall through to text formats when it is not native JSON.
	}
	// 2. Parametric text (Preamp + Filter lines).
	const parametric =
		/^\s*preamp\s*:/gim.test(text) || /filter\s*\d*\s*:/gim.test(text)
			? parseParametricText(text)
			: null;
	// 3. GraphicEQ text.
	const graphic =
		!parametric && /graphiceq\s*:/gim.test(text) ? parseGraphicEq(text) : null;
	// 4. Curve CSV.
	const csv = !parametric && !graphic ? parseCurveCsv(text) : null;
	const parsed = parametric ?? graphic ?? csv;
	if (!parsed) {
		setMessage(
			"No usable filters found. Supported: native .preset.json, parametric text (Preamp + Filter lines), GraphicEQ text, frequency,gain CSV.",
		);
		return;
	}
	const id = useEQStore.getState().importPreset(
		file.name.replace(/\.[^.]+$/, ""),
		{
			version: 1,
			preamp: parsed.preampDb,
			enabled: true,
			bands: parsed.bands,
		},
		{ origin: "user" },
	);
	const notes =
		parsed.warnings.length > 0 ? ` Notes: ${parsed.warnings.join(" ")}` : "";
	setMessage(
		id
			? `Imported ${parsed.bands.length} bands.${notes}`
			: "That preset could not be imported.",
	);
}

/** Export / duplicate actions for one user preset. */
export function PresetFormatActions({ preset }: { preset: EQPreset }) {
	const [message, setMessage] = useState<string | null>(null);

	const duplicate = (): void => {
		const store = useEQStore.getState();
		const meta: {
			origin: PresetOrigin | "user";
			deviceName?: string;
			sourceAttribution?: string;
			sourceLicense?: string;
			sourceUrl?: string;
			sourcePresetId?: string;
		} = { origin: preset.origin ?? "user" };
		if (preset.deviceName !== undefined) meta.deviceName = preset.deviceName;
		if (preset.sourceAttribution !== undefined)
			meta.sourceAttribution = preset.sourceAttribution;
		if (preset.sourceLicense !== undefined)
			meta.sourceLicense = preset.sourceLicense;
		if (preset.sourceUrl !== undefined) meta.sourceUrl = preset.sourceUrl;
		if (preset.sourcePresetId !== undefined)
			meta.sourcePresetId = preset.sourcePresetId;
		const id = store.importPreset(`${preset.name} (copy)`, preset.data, meta);
		setMessage(
			id ? "Duplicated as an independent copy." : "Could not duplicate.",
		);
	};

	const exportNative = (): void => {
		const args: {
			name: string;
			deviceName?: string;
			origin: PresetOrigin | "user";
			attribution?: string;
			peq: typeof preset.data;
		} = {
			name: preset.name,
			origin: preset.origin ?? "user",
			peq: preset.data,
		};
		if (preset.deviceName !== undefined) args.deviceName = preset.deviceName;
		if (preset.sourceAttribution !== undefined)
			args.attribution = preset.sourceAttribution;
		download(`${safeName(preset.name)}.preset.json`, exportPresetFile(args));
	};

	const exportText = (format: "graphiceq" | "apo" | "csv"): void => {
		const bands = preset.data.bands
			.filter((b) => b.enabled)
			.map((b) => ({ ...b }));
		if (format === "graphiceq") {
			download(
				`${safeName(preset.name)}.graphiceq.txt`,
				exportGraphicEq(
					bands.map((b) => b.frequency),
					bands.map((b) => b.gain),
					preset.data.preamp,
				),
				"text/plain",
			);
		} else if (format === "apo") {
			download(
				`${safeName(preset.name)}.apo.txt`,
				exportParametricText(preset.data.preamp, bands),
				"text/plain",
			);
		} else {
			download(
				`${safeName(preset.name)}.csv`,
				exportCurveCsv(
					bands.map((b) => b.frequency),
					bands.map((b) => b.gain),
				),
				"text/csv",
			);
		}
		setMessage(
			"Exported enabled bands only — bypassed bands are not in text formats.",
		);
	};

	return (
		<span className="flex shrink-0 flex-wrap items-center gap-1">
			<button
				type="button"
				onClick={duplicate}
				aria-label={`Duplicate preset ${preset.name}`}
				className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
			>
				Duplicate
			</button>
			<button
				type="button"
				onClick={exportNative}
				aria-label={`Export preset ${preset.name} as JSON`}
				className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
			>
				JSON
			</button>
			<button
				type="button"
				onClick={() => exportText("graphiceq")}
				aria-label={`Export preset ${preset.name} as GraphicEQ text`}
				className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
			>
				GraphicEQ
			</button>
			<button
				type="button"
				onClick={() => exportText("apo")}
				aria-label={`Export preset ${preset.name} as parametric text`}
				className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
			>
				APO txt
			</button>
			<button
				type="button"
				onClick={() => exportText("csv")}
				aria-label={`Export preset ${preset.name} as CSV`}
				className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
			>
				CSV
			</button>
			{message ? (
				<span role="status" className="w-full text-[11px] text-muted">
					{message}
				</span>
			) : null}
		</span>
	);
}
