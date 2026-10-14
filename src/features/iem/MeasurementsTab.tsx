import { useMemo, useRef, useState } from "react";
import { parseCurveText } from "../../dsp/curve-io";
import type { ResponseCurve } from "../../dsp/curves";
import { libraryService } from "../../library/library-service";
import { useIEMStore } from "../../state/iem-store";
import { CurveGraph } from "./CurveGraph";

interface Preview {
	file: File;
	fileName: string;
	curves: {
		channel: string;
		points: number;
		minF: number;
		maxF: number;
		curve: ResponseCurve;
	}[];
	warnings: string[];
	error: string | null;
}

export function MeasurementsTab() {
	const measurements = useIEMStore((s) => s.measurements);
	const fileRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [name, setName] = useState("");
	const [source, setSource] = useState("");
	const list = useMemo(
		() => Object.values(measurements).sort((a, b) => b.createdAt - a.createdAt),
		[measurements],
	);

	const onFile = async (file: File) => {
		const text = await file.text();
		try {
			const parsed = parseCurveText(text, file.name);
			setPreview({
				file,
				fileName: file.name,
				curves: parsed.curves.map((c) => ({
					channel: c.channel,
					points: c.curve.frequencies.length,
					minF: c.curve.frequencies[0] ?? 0,
					maxF: c.curve.frequencies[c.curve.frequencies.length - 1] ?? 0,
					curve: { frequencies: c.curve.frequencies, gains: c.curve.gains },
				})),
				warnings: parsed.warnings,
				error: null,
			});
			setName(file.name.replace(/\.[^.]+$/, ""));
			setSource("");
		} catch (e) {
			setPreview({
				file,
				fileName: file.name,
				curves: [],
				warnings: [],
				error: e instanceof Error ? e.message : "Could not parse this file.",
			});
		}
	};

	const save = async () => {
		if (!preview || preview.error) return;
		const text = await preview.file.text();
		try {
			await libraryService.importMeasurementFile(
				text,
				preview.fileName,
				source.trim() || "imported file",
				name.trim() || undefined,
			);
			setPreview(null);
			setName("");
			setSource("");
		} catch (e) {
			setPreview({
				...preview,
				error: e instanceof Error ? e.message : "Import failed.",
			});
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<input
					ref={fileRef}
					data-iem-file="measurement"
					type="file"
					accept=".csv,.txt,.tsv,.dat,.frd"
					className="sr-only"
					aria-hidden="true"
					tabIndex={-1}
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void onFile(file);
						e.target.value = "";
					}}
				/>
				<button
					type="button"
					onClick={() => fileRef.current?.click()}
					className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
				>
					Import measurement
				</button>
				<span className="text-xs text-muted">
					CSV / TXT frequency-response files stay on this device.
				</span>
			</div>

			{preview ? (
				<div
					className="rounded-xl border border-line bg-surface p-3"
					role="region"
					aria-label="Import preview"
				>
					<h3 className="mb-1 text-sm font-semibold">
						Preview: {preview.fileName}
					</h3>
					{preview.error ? (
						<p role="alert" className="text-sm text-red-300">
							{preview.error}
						</p>
					) : (
						<>
							{preview.curves.map((c) => (
								<div key={c.channel} className="mb-2">
									<p className="text-xs text-muted">
										Channel {c.channel} · {c.points} points ·{" "}
										{Math.round(c.minF)}–{Math.round(c.maxF)} Hz
									</p>
									<CurveGraph
										series={[
											{
												id: c.channel,
												label: `${preview.fileName} (${c.channel})`,
												color: "accent",
												curve: c.curve,
											},
										]}
									/>
								</div>
							))}
							{preview.warnings.map((w) => (
								<p key={w} className="text-xs text-muted">
									Note: {w}
								</p>
							))}
							<div className="mt-2 flex flex-wrap items-center gap-2">
								<label className="sr-only" htmlFor="measurement-name">
									Measurement name
								</label>
								<input
									id="measurement-name"
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Measurement name"
									className="min-w-40 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm"
								/>
								<label className="sr-only" htmlFor="measurement-source">
									Source note
								</label>
								<input
									id="measurement-source"
									type="text"
									value={source}
									onChange={(e) => setSource(e.target.value)}
									placeholder="Source (e.g. my 711 rig)"
									className="min-w-40 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm"
								/>
								<button
									type="button"
									onClick={() => void save()}
									disabled={name.trim() === ""}
									className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
								>
									Save
									{preview.curves.length > 1
										? ` ${preview.curves.length} channels`
										: ""}
								</button>
							</div>
						</>
					)}
				</div>
			) : null}

			{list.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted">
					No measurements yet.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{list.map((m) => (
						<li
							key={m.id}
							className="flex items-center gap-2 rounded-xl border border-line bg-surface p-3"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">
									{m.name}
								</span>
								<span className="block text-xs text-muted">
									{m.channel} · {m.metadata.pointCount} points ·{" "}
									{Math.round(m.metadata.minFrequency)}–
									{Math.round(m.metadata.maxFrequency)} Hz
									{m.source ? ` · ${m.source}` : ""}
								</span>
							</span>
							<button
								type="button"
								onClick={() => void libraryService.deleteMeasurement(m.id)}
								aria-label={`Delete measurement ${m.name}`}
								className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
							>
								Delete
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
