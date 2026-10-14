import { useMemo, useRef, useState } from "react";
import { Slider } from "../../components/ui/Slider";
import { parseCurveText } from "../../dsp/curve-io";
import type { TargetBuilderParams } from "../../dsp/curves";
import { buildParametricTarget } from "../../dsp/curves";
import { libraryService } from "../../library/library-service";
import { useIEMStore } from "../../state/iem-store";
import { CurveGraph } from "./CurveGraph";

const DEFAULT_PARAMS: TargetBuilderParams = {
	bassGainDb: 0,
	bassFreq: 105,
	tiltDbPerOctave: 0,
	tiltPivotFreq: 1000,
	offsetDb: 0,
};

export function TargetsTab() {
	const targets = useIEMStore((s) => s.targets);
	const fileRef = useRef<HTMLInputElement>(null);
	const [tabName, setTabName] = useState<"build" | "import">("build");
	const [name, setName] = useState("");
	const [params, setParams] = useState<TargetBuilderParams>(DEFAULT_PARAMS);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [importPreview, setImportPreview] = useState<{
		file: File;
		fileName: string;
		points: number;
		minF: number;
		maxF: number;
		warnings: string[];
		error: string | null;
	} | null>(null);

	const preview = useMemo(() => buildParametricTarget(params), [params]);
	const list = useMemo(
		() => Object.values(targets).sort((a, b) => b.updatedAt - a.updatedAt),
		[targets],
	);

	const patch = (p: Partial<TargetBuilderParams>) =>
		setParams((s) => ({ ...s, ...p }));

	const save = async () => {
		if (name.trim() === "") return;
		const id = await libraryService.saveParametricTarget(
			name,
			params,
			editingId ?? undefined,
		);
		setEditingId(id);
	};

	const edit = (id: string) => {
		const target = targets[id];
		if (!target || target.kind !== "parametric" || !target.metadata.params)
			return;
		setParams({ ...target.metadata.params });
		setName(target.name);
		setEditingId(id);
		setTabName("build");
	};

	const onImportFile = async (file: File) => {
		try {
			const parsed = parseCurveText(await file.text(), file.name);
			const first = parsed.curves[0];
			if (!first) throw new Error("no usable curve found");
			setImportPreview({
				file,
				fileName: file.name,
				points: first.curve.frequencies.length,
				minF: first.curve.frequencies[0] ?? 0,
				maxF: first.curve.frequencies[first.curve.frequencies.length - 1] ?? 0,
				warnings: parsed.warnings,
				error: null,
			});
			setName(file.name.replace(/\.[^.]+$/, ""));
		} catch (e) {
			setImportPreview({
				file,
				fileName: file.name,
				points: 0,
				minF: 0,
				maxF: 0,
				warnings: [],
				error: e instanceof Error ? e.message : "Could not parse this file.",
			});
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<section
				aria-label="Built-in targets"
				className="rounded-xl border border-line bg-surface p-3"
			>
				<h3 className="mb-1 text-sm font-semibold">Built-in</h3>
				<p className="text-xs text-muted">
					<strong>Flat (0 dB)</strong> — constant zero reference, owned by this
					project. Third-party targets (Harman, JM-1, diffuse-field, …) are
					deliberately not bundled; import them as CSV below. See the licensing
					notes in the docs.
				</p>
			</section>

			<div
				role="tablist"
				aria-label="Target source"
				className="flex gap-1 rounded-full border border-line p-1 self-start"
			>
				{(["build", "import"] as const).map((t) => (
					<button
						key={t}
						type="button"
						role="tab"
						aria-selected={tabName === t}
						onClick={() => setTabName(t)}
						className={`rounded-full px-3 py-1 text-sm capitalize ${tabName === t ? "bg-elevated font-semibold" : "text-muted hover:text-ink"}`}
					>
						{t === "build" ? "Build parametric" : "Import file"}
					</button>
				))}
			</div>

			{tabName === "build" ? (
				<section
					aria-label="Parametric target builder"
					className="rounded-xl border border-line bg-surface p-3"
				>
					<CurveGraph
						series={[
							{
								id: "preview",
								label: name.trim() || "Preview",
								color: "accent",
								curve: preview,
							},
						]}
					/>
					<div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
						<div>
							<Slider
								label="Bass shelf gain"
								value={params.bassGainDb}
								min={-12}
								max={12}
								step={0.5}
								textValue={`${params.bassGainDb.toFixed(1)} dB`}
								onChange={(v) => patch({ bassGainDb: v })}
							/>
						</div>
						<div>
							<Slider
								label="Bass shelf midpoint"
								value={Math.log10(params.bassFreq)}
								min={Math.log10(20)}
								max={Math.log10(500)}
								step={0.01}
								textValue={`${Math.round(params.bassFreq)} Hz`}
								onChange={(v) => patch({ bassFreq: Math.round(10 ** v) })}
							/>
						</div>
						<div>
							<Slider
								label="Treble tilt"
								value={params.tiltDbPerOctave}
								min={-3}
								max={3}
								step={0.1}
								textValue={`${params.tiltDbPerOctave.toFixed(1)} dB/oct`}
								onChange={(v) => patch({ tiltDbPerOctave: v })}
							/>
						</div>
						<div>
							<Slider
								label="Tilt pivot"
								value={Math.log10(params.tiltPivotFreq)}
								min={Math.log10(200)}
								max={Math.log10(4000)}
								step={0.01}
								textValue={`${Math.round(params.tiltPivotFreq)} Hz`}
								onChange={(v) => patch({ tiltPivotFreq: Math.round(10 ** v) })}
							/>
						</div>
						<div>
							<Slider
								label="Global offset"
								value={params.offsetDb}
								min={-12}
								max={12}
								step={0.5}
								textValue={`${params.offsetDb.toFixed(1)} dB`}
								onChange={(v) => patch({ offsetDb: v })}
							/>
						</div>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<label className="sr-only" htmlFor="target-name">
							Target name
						</label>
						<input
							id="target-name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Target name"
							className="min-w-40 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm"
						/>
						<button
							type="button"
							disabled={name.trim() === ""}
							onClick={() => void save()}
							className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
						>
							{editingId ? "Update target" : "Save target"}
						</button>
						{editingId ? (
							<button
								type="button"
								onClick={() => {
									setEditingId(null);
									setName("");
									setParams(DEFAULT_PARAMS);
								}}
								className="text-xs text-muted hover:text-ink"
							>
								New
							</button>
						) : null}
					</div>
				</section>
			) : (
				<section
					aria-label="Import target file"
					className="rounded-xl border border-line bg-surface p-3"
				>
					<input
						ref={fileRef}
						type="file"
						accept=".csv,.txt,.tsv,.dat,.frd"
						className="sr-only"
						aria-hidden="true"
						tabIndex={-1}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) void onImportFile(file);
							e.target.value = "";
						}}
					/>
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
					>
						Choose target file
					</button>
					{importPreview ? (
						importPreview.error ? (
							<p role="alert" className="mt-2 text-sm text-red-300">
								{importPreview.error}
							</p>
						) : (
							<div className="mt-2 flex flex-col gap-2">
								<p className="text-xs text-muted">
									{importPreview.points} points ·{" "}
									{Math.round(importPreview.minF)}–
									{Math.round(importPreview.maxF)} Hz
								</p>
								{importPreview.warnings.map((w) => (
									<p key={w} className="text-xs text-muted">
										Note: {w}
									</p>
								))}
								<div className="flex flex-wrap items-center gap-2">
									<label className="sr-only" htmlFor="imported-target-name">
										Target name
									</label>
									<input
										id="imported-target-name"
										type="text"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="Target name"
										className="min-w-40 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm"
									/>
									<button
										type="button"
										disabled={name.trim() === ""}
										onClick={() => {
											const file = importPreview.file;
											const label = name;
											void file
												.text()
												.then((text) =>
													libraryService.importTargetFile(
														text,
														file.name,
														label,
													),
												)
												.then(() => {
													setImportPreview(null);
													setName("");
												});
										}}
										className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
									>
										Save target
									</button>
								</div>
							</div>
						)
					) : null}
				</section>
			)}

			{list.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted">
					No custom targets yet.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{list.map((t) => (
						<li
							key={t.id}
							className="flex items-center gap-2 rounded-xl border border-line bg-surface p-3"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">
									{t.name}
								</span>
								<span className="block text-xs text-muted">
									{t.kind} · {t.metadata.pointCount} points
									{t.metadata.source ? ` · ${t.metadata.source}` : ""}
								</span>
							</span>
							{t.kind === "parametric" ? (
								<button
									type="button"
									onClick={() => edit(t.id)}
									aria-label={`Edit target ${t.name}`}
									className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
								>
									Edit
								</button>
							) : null}
							<button
								type="button"
								onClick={() => void libraryService.deleteTarget(t.id)}
								aria-label={`Delete target ${t.name}`}
								className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
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
