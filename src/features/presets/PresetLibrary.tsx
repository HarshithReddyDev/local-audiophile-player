import { useMemo, useRef, useState } from "react";
import {
	BUILTIN_PRESETS,
	type BuiltinPreset,
	builtinPeakBoost,
} from "../../dsp/builtin-presets";
import { type ChainResponseInput, chainResponseGrid } from "../../dsp/response";
import type { DeviceDspSnapshot } from "../../dsp/snapshot";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { CHAIN_SAMPLE_RATE } from "../eq/use-chain";
import { applyBuiltinPreset } from "./apply-preset";
import { useBuiltinFavorites } from "./use-builtin-favorites";

type Filter = "all" | "eq" | "dsp" | "combined" | "favorites";

const FILTERS: { id: Filter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "eq", label: "EQ" },
	{ id: "dsp", label: "DSP" },
	{ id: "combined", label: "Combined" },
	{ id: "favorites", label: "Favorites" },
];

function originLabel(preset: BuiltinPreset): string {
	if (preset.kind === "eq") return "Built-in EQ";
	if (preset.kind === "dsp") return "Built-in DSP";
	return "Built-in combined";
}

function activeModules(preset: BuiltinPreset): string[] {
	const out: string[] = [];
	if (preset.bands.length > 0) out.push(`EQ · ${preset.bands.length} bands`);
	const d = preset.dsp;
	if (!d) return out;
	if (d.bass?.enabled) out.push("Bass");
	if (d.treble?.enabled) out.push("Treble");
	if (d.tuner?.enabled) out.push("Bass tuner");
	if (d.compressor?.enabled) out.push("Compressor");
	if (d.limiter?.enabled) out.push("Limiter");
	if (d.spatial?.enabled) out.push("Spatial");
	if (d.reverb?.enabled) out.push("Reverb");
	if (d.loudness?.enabled) out.push("Loudness");
	return out;
}

/** Tiny static response preview from the shared response engine. */
function PresetPreview({ preset }: { preset: BuiltinPreset }) {
	const points = useMemo(() => {
		if (preset.bands.length === 0) return [];
		const input: ChainResponseInput = {
			preampDb: 0,
			enabled: true,
			stages: preset.bands.map((b) => ({ ...b })),
		};
		try {
			return chainResponseGrid(input, CHAIN_SAMPLE_RATE, 64);
		} catch {
			return [];
		}
	}, [preset]);
	if (points.length === 0) {
		return (
			<p className="text-xs text-muted">
				Flat response — no EQ bands. The graph shows tonal shape only, never the
				exact audible outcome.
			</p>
		);
	}
	const W = 280;
	const H = 72;
	const max = Math.max(3, ...points.map((p) => Math.abs(p.db)));
	const xs = (i: number) => (i / (points.length - 1)) * W;
	const ys = (db: number) => H / 2 - (db / max) * (H / 2 - 4);
	const path = points
		.map(
			(p, i) =>
				`${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(p.db).toFixed(1)}`,
		)
		.join(" ");
	return (
		<figure>
			<svg
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={`Expected tonal response preview for ${preset.name}`}
				className="w-full rounded-lg border border-line bg-abyss text-accent"
			>
				<line
					x1={0}
					x2={W}
					y1={H / 2}
					y2={H / 2}
					stroke="currentColor"
					strokeOpacity={0.3}
				/>
				<path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
			</svg>
			<figcaption className="mt-1 text-[11px] text-muted">
				Preview of the tonal shape. Listening conditions dominate what you hear
				— compare by ear with A/B.
			</figcaption>
		</figure>
	);
}

export function PresetLibrary() {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [openId, setOpenId] = useState<string | null>(null);
	const [abState, setAbState] = useState<"current" | "preset">("preset");
	const restoreRef = useRef<DeviceDspSnapshot | null>(null);
	const restoreEqRef = useRef<{
		bands: BuiltinPreset["bands"];
		preampDb: number;
		eqEnabled: boolean;
	} | null>(null);
	const { isFavorite, toggle } = useBuiltinFavorites();
	const [, force] = useState(0);

	const results = useMemo(() => {
		const q = query.trim().toLowerCase();
		return BUILTIN_PRESETS.filter((p) => {
			if (filter === "favorites" && !isFavorite(p.id)) return false;
			if (filter === "eq" && p.kind !== "eq") return false;
			if (filter === "dsp" && p.kind !== "dsp") return false;
			if (filter === "combined" && p.kind !== "combined") return false;
			if (!q) return true;
			return `${p.name} ${p.description} ${p.category}`
				.toLowerCase()
				.includes(q);
		});
		// isFavorite identity changes per render; favorites list drives updates via force.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, filter, force]);

	const open = openId
		? (BUILTIN_PRESETS.find((p) => p.id === openId) ?? null)
		: null;

	const [previewing, setPreviewing] = useState(false);

	const startPreview = (preset: BuiltinPreset) => {
		// Snapshot live state once so A/B + restore never lose the user's sound.
		// Stored presets are never mutated — built-ins are read-only.
		if (!previewing) {
			const dsp = useDspStore.getState();
			const eq = useEQStore.getState();
			restoreRef.current = dsp.snapshot();
			restoreEqRef.current = {
				bands: eq.profile.bands.map((b) => ({
					type: b.type,
					frequency: b.frequency,
					gain: b.gain,
					q: b.q,
					enabled: b.enabled,
				})),
				preampDb: eq.profile.preamp,
				eqEnabled: eq.profile.enabled,
			};
		}
		applyBuiltinPreset(preset);
		setPreviewing(true);
		setAbState("preset");
	};

	const restoreLive = () => {
		const snap = restoreRef.current;
		const eqPrev = restoreEqRef.current;
		const deviceId = useDspStore.getState().activeDeviceId;
		const deviceName = useDspStore.getState().activeDeviceName;
		if (snap) {
			useDspStore
				.getState()
				.applySnapshot(
					snap,
					deviceId ? { id: deviceId, name: deviceName ?? "Device" } : null,
				);
			if (!deviceId) useDspStore.getState().clearDevice();
		}
		if (eqPrev) {
			useEQStore
				.getState()
				.loadBands(eqPrev.bands, eqPrev.preampDb, eqPrev.eqEnabled);
		}
		restoreRef.current = null;
		restoreEqRef.current = null;
		setPreviewing(false);
		setAbState("preset");
	};

	const toggleAB = (preset: BuiltinPreset) => {
		if (!previewing) {
			startPreview(preset);
			return;
		}
		if (abState === "preset") {
			// Hear the user's previous sound; the snapshot is kept so one tap returns.
			const snap = restoreRef.current;
			const eqPrev = restoreEqRef.current;
			const deviceId = useDspStore.getState().activeDeviceId;
			const deviceName = useDspStore.getState().activeDeviceName;
			if (snap) {
				useDspStore
					.getState()
					.applySnapshot(
						snap,
						deviceId ? { id: deviceId, name: deviceName ?? "Device" } : null,
					);
				if (!deviceId) useDspStore.getState().clearDevice();
			}
			if (eqPrev) {
				useEQStore
					.getState()
					.loadBands(eqPrev.bands, eqPrev.preampDb, eqPrev.eqEnabled);
			}
			setAbState("current");
		} else {
			applyBuiltinPreset(preset);
			setAbState("preset");
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<div>
				<h3 className="text-sm font-semibold">Preset library</h3>
				<p className="text-xs text-muted">
					{BUILTIN_PRESETS.length} built-in starting points. Read-only — using
					one copies its settings into your live sound, never the reverse.
					Generic tonal shapes, not device corrections.
				</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<label className="sr-only" htmlFor="preset-search">
					Search presets
				</label>
				<input
					id="preset-search"
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search presets…"
					className="min-w-0 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm outline-none placeholder:text-muted"
				/>
				<div
					role="tablist"
					aria-label="Preset categories"
					className="flex flex-wrap gap-1"
				>
					{FILTERS.map((f) => (
						<button
							key={f.id}
							type="button"
							role="tab"
							aria-selected={filter === f.id}
							onClick={() => setFilter(f.id)}
							className={`rounded-full px-3 py-1 text-xs ${filter === f.id ? "bg-elevated font-semibold" : "text-muted hover:text-ink"}`}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>
			<p className="text-xs text-muted" role="status">
				{results.length} of {BUILTIN_PRESETS.length} presets
			</p>
			<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
				{results.map((preset) => (
					<li
						key={preset.id}
						className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3"
					>
						<div className="flex items-start gap-2">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-semibold">{preset.name}</p>
								<p className="line-clamp-2 text-xs text-muted">
									{preset.description}
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									toggle(preset.id);
									force((n) => n + 1);
								}}
								aria-pressed={isFavorite(preset.id)}
								aria-label={`Favorite preset ${preset.name}`}
								className="shrink-0 rounded-full px-2 py-0.5 text-sm text-muted hover:bg-elevated hover:text-ink"
							>
								{isFavorite(preset.id) ? "★" : "☆"}
							</button>
						</div>
						<p className="text-[11px] text-muted">
							{originLabel(preset)} · {preset.category}
						</p>
						<div className="mt-auto flex gap-2 pt-1">
							<button
								type="button"
								onClick={() => {
									applyBuiltinPreset(preset);
									restoreRef.current = null;
									restoreEqRef.current = null;
									setPreviewing(false);
									setAbState("preset");
								}}
								className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
							>
								Use
							</button>
							<button
								type="button"
								onClick={() =>
									setOpenId(openId === preset.id ? null : preset.id)
								}
								aria-expanded={openId === preset.id}
								className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
							>
								{openId === preset.id ? "Hide" : "Details"}
							</button>
						</div>
						{openId === preset.id ? (
							<div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-abyss p-2.5">
								<PresetPreview preset={preset} />
								<dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
									<div>
										<dt className="text-muted">Bands</dt>
										<dd>{preset.bands.length}</dd>
									</div>
									<div>
										<dt className="text-muted">Preamp</dt>
										<dd className="tabular-nums">
											{preset.preampDb.toFixed(1)} dB
										</dd>
									</div>
									<div>
										<dt className="text-muted">Peak boost</dt>
										<dd className="tabular-nums">
											+{builtinPeakBoost(preset).toFixed(1)} dB
										</dd>
									</div>
									<div>
										<dt className="text-muted">Source</dt>
										<dd>Created for this player</dd>
									</div>
								</dl>
								{activeModules(preset).length > 0 ? (
									<p className="text-[11px] text-muted">
										Active modules: {activeModules(preset).join(" · ")}
									</p>
								) : null}
								<div className="flex flex-wrap gap-2">
									<button
										type="button"
										onClick={() => startPreview(preset)}
										className="rounded-full border border-line px-3 py-1 text-[11px] hover:bg-elevated"
									>
										Preview (applies, restorable)
									</button>
									<button
										type="button"
										onClick={() => toggleAB(preset)}
										className="rounded-full border border-line px-3 py-1 text-[11px] hover:bg-elevated"
									>
										A/B:{" "}
										{abState === "preset"
											? "hear my previous sound"
											: "hear preset"}
									</button>
									{previewing ? (
										<button
											type="button"
											onClick={restoreLive}
											className="rounded-full border border-accent/50 px-3 py-1 text-[11px] text-accent hover:bg-elevated"
										>
											Restore my sound
										</button>
									) : null}
								</div>
								<p className="text-[11px] text-muted">
									A/B never edits the stored preset — built-ins are read-only.
									Preview touches only live listening and can be restored above.
								</p>
							</div>
						) : null}
					</li>
				))}
			</ul>
			{results.length === 0 ? (
				<p className="rounded-xl border border-line bg-surface p-4 text-center text-sm text-muted">
					No presets match. Try a different search or category.
				</p>
			) : null}
			{open ? (
				<span className="sr-only">Details open for {open.name}</span>
			) : null}
		</div>
	);
}
