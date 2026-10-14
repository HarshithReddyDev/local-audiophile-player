/**
 * Devices section: browsable audio-device catalog + user preset library.
 *
 * Catalog entries are canonical and read-only (metadata + outbound links;
 * no bundled third-party measurements). Everything actionable creates an
 * INDEPENDENT user-owned copy: local IEM profiles via libraryService, EQ
 * presets via eq-store importPreset. Canonical data is never mutated.
 */

import { useEffect, useMemo, useState } from "react";
import {
	buildDevicePresetCounts,
	catalogManufacturers,
	catalogSources,
	type DeviceSortKey,
	devicePresets,
	getDevice,
	searchDevices,
	sortDevices,
} from "../../catalog/catalog";
import { useCatalogFavorites } from "../../catalog/favorites";
import { loadFullCatalog } from "../../catalog/loader";
import {
	exportPresetFile,
	importPresetFile,
	PresetFileError,
} from "../../catalog/preset-file";
import { CATALOG_DATA_VERSION } from "../../catalog/seed";
import type { DeviceCatalog } from "../../catalog/types";
import {
	DEVICE_TYPES,
	type DeviceType,
	type PresetOrigin,
} from "../../catalog/types";
import type { SerializedPEQ } from "../../dsp/types";
import { libraryService } from "../../library/library-service";
import { useEQStore } from "../../state/eq-store";
import { allTargets, useIEMStore } from "../../state/iem-store";

function downloadFile(name: string, text: string): void {
	const blob = new Blob([text], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

export function DevicesView({
	onOpenGuide,
}: {
	onOpenGuide?: ((guideId: string) => void) | undefined;
}) {
	const [tab, setTab] = useState<"catalog" | "presets" | "sources">("catalog");
	// The generated bulk layer loads lazily (see loader.ts) so listeners
	// who never open Devices never download or parse those megabytes.
	const [catalog, setCatalog] = useState<DeviceCatalog | null>(null);
	const [catalogFailed, setCatalogFailed] = useState(false);
	const [catalogOffline, setCatalogOffline] = useState(false);
	useEffect(() => {
		let live = true;
		void loadFullCatalog().then(
			({ catalog: full, offline }) => {
				if (!live) return;
				setCatalog(full);
				setCatalogOffline(offline);
			},
			() => {
				if (live) setCatalogFailed(true);
			},
		);
		return () => {
			live = false;
		};
	}, []);
	if (catalogFailed) {
		return (
			<div className="flex max-w-3xl flex-col gap-3">
				<h2 className="text-2xl font-bold tracking-tight">Devices</h2>
				<p role="alert" className="text-sm text-red-300">
					The device catalog could not be loaded. Music playback is unaffected —
					try reopening Devices.
				</p>
			</div>
		);
	}
	if (!catalog) {
		return (
			<div className="flex max-w-3xl flex-col gap-3" aria-busy="true">
				<h2 className="text-2xl font-bold tracking-tight">Devices</h2>
				<p role="status" className="text-sm text-muted">
					Loading device catalog…
				</p>
				<ul aria-hidden="true" className="flex flex-col gap-2">
					{[0, 1, 2, 3, 4, 5].map((i) => (
						<li key={i} className="h-14 animate-pulse rounded-2xl bg-surface" />
					))}
				</ul>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-baseline gap-2">
				<h2 className="text-2xl font-bold tracking-tight">Devices</h2>
				<p className="text-sm text-muted">
					Find your headphones or IEMs and tune them.
				</p>
				<span className="flex-1" />
				{onOpenGuide ? (
					<button
						type="button"
						onClick={() => onOpenGuide("devices")}
						className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-accent"
					>
						Learn →
					</button>
				) : null}
			</div>
			{catalogOffline ? (
				<p role="status" className="text-[13px] text-muted">
					Offline catalog: showing the bundled seed only. Reconnect and reopen
					Devices for the full catalog.
				</p>
			) : null}
			<div
				role="tablist"
				aria-label="Devices"
				className="flex gap-1 self-start rounded-full border border-line p-1"
			>
				{(
					[
						["catalog", "Catalog"],
						["presets", "My presets"],
						["sources", "Sources & licenses"],
					] as const
				).map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={`rounded-full px-3 py-1 text-sm ${tab === id ? "bg-elevated font-semibold" : "text-muted hover:text-ink"}`}
					>
						{label}
					</button>
				))}
			</div>
			{tab === "catalog" ? <CatalogTab catalog={catalog} /> : null}
			{tab === "presets" ? <PresetsTab /> : null}
			{tab === "sources" ? <SourcesTab catalog={catalog} /> : null}
		</div>
	);
}

type SortKey = DeviceSortKey;

const SORT_LABEL: Record<SortKey, string> = {
	name: "Name",
	manufacturer: "Manufacturer",
	category: "Category",
	eq: "EQ available",
};

function CatalogTab({ catalog }: { catalog: DeviceCatalog }) {
	const [query, setQuery] = useState("");
	const [deviceType, setDeviceType] = useState<DeviceType | "all">("all");
	const [manufacturer, setManufacturer] = useState<string | "all">("all");
	const [source, setSource] = useState<string | "all">("all");
	const [hasEq, setHasEq] = useState(false);
	const [hasMeasurements, setHasMeasurements] = useState(false);
	const [favoritesOnly, setFavoritesOnly] = useState(false);
	const [sort, setSort] = useState<SortKey>("name");
	const [openId, setOpenId] = useState<string | null>(null);
	const favoriteDevices = useCatalogFavorites((s) => s.devices);

	const makers = useMemo(() => catalogManufacturers(catalog), []);
	const sources = useMemo(() => catalogSources(catalog), []);
	const presetCounts = useMemo(() => buildDevicePresetCounts(catalog), []);
	const results = useMemo(() => {
		const found = searchDevices(catalog, {
			query,
			deviceType,
			manufacturer,
			hasEq,
			hasMeasurements,
			source,
		});
		const filtered = favoritesOnly
			? found.filter((d) => favoriteDevices.includes(d.id))
			: found;
		return sortDevices(filtered, sort, presetCounts);
	}, [
		query,
		deviceType,
		manufacturer,
		source,
		hasEq,
		hasMeasurements,
		favoritesOnly,
		sort,
		favoriteDevices,
		presetCounts,
	]);
	const open = openId ? getDevice(catalog, openId) : null;

	return (
		<div className="flex flex-col gap-3">
			<details className="rounded-xl bg-surface px-3 py-2 text-[13px] text-muted">
				<summary className="cursor-pointer font-medium hover:text-ink">
					About this catalog
				</summary>
				<p className="pt-1">
					Known devices and where their data legitimately lives. No measurement
					database is bundled — entries link outward and your imports stay on
					this device. Measurements come from specific sources and rigs, so
					different sources can disagree.
				</p>
			</details>
			<div className="flex flex-wrap items-center gap-2">
				<label className="sr-only" htmlFor="device-search">
					Search devices
				</label>
				<input
					id="device-search"
					type="search"
					value={query}
					placeholder="Search headphones, IEMs, earbuds…"
					onChange={(e) => setQuery(e.target.value)}
					className="min-w-40 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-muted"
				/>
				<label className="flex items-center gap-1 text-xs text-muted">
					Type
					<select
						value={deviceType}
						aria-label="Filter by device type"
						onChange={(e) =>
							setDeviceType(e.target.value as DeviceType | "all")
						}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="all">All types</option>
						{DEVICE_TYPES.map((t) => (
							<option key={t.id} value={t.id}>
								{t.label}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					Maker
					<select
						value={manufacturer}
						aria-label="Filter by manufacturer"
						onChange={(e) => setManufacturer(e.target.value)}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="all">All makers</option>
						{makers.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					Source
					<select
						value={source}
						aria-label="Filter by source"
						onChange={(e) => setSource(e.target.value)}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="all">All sources</option>
						{sources.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					Sort
					<select
						value={sort}
						aria-label="Sort devices"
						onChange={(e) => setSort(e.target.value as SortKey)}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						{(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
							<option key={k} value={k}>
								{SORT_LABEL[k]}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					<input
						type="checkbox"
						checked={hasEq}
						onChange={(e) => setHasEq(e.target.checked)}
					/>
					Has EQ preset
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					<input
						type="checkbox"
						checked={hasMeasurements}
						onChange={(e) => setHasMeasurements(e.target.checked)}
					/>
					Has measurements
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					<input
						type="checkbox"
						checked={favoritesOnly}
						aria-label="Show favorite devices only"
						onChange={(e) => setFavoritesOnly(e.target.checked)}
					/>
					Favorites
				</label>
			</div>
			<p className="text-xs text-muted" role="status">
				{results.length} device{results.length === 1 ? "" : "s"} · catalog data
				v{CATALOG_DATA_VERSION}
			</p>
			<StandalonePresets catalog={catalog} />
			{results.length === 0 ? (
				<p className="px-2 py-8 text-center text-sm text-muted">
					No devices match.
				</p>
			) : (
				<ul className="flex flex-col gap-1">
					{results.map((d) => (
						<li key={d.id}>
							<span className="flex w-full items-center gap-1">
								<button
									type="button"
									onClick={() => setOpenId(openId === d.id ? null : d.id)}
									aria-expanded={openId === d.id}
									aria-label={`${d.manufacturer} ${d.model}`}
									className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left transition-colors hover:bg-elevated"
								>
									<span
										aria-hidden="true"
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-sm font-bold text-accent"
									>
										{d.manufacturer.slice(0, 1).toUpperCase()}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[14px] font-medium">
											{d.manufacturer} {d.model}
										</span>
										<span className="block truncate text-[13px] text-muted">
											{DEVICE_TYPES.find((t) => t.id === d.deviceType)?.label ??
												d.deviceType}
											{(presetCounts.get(d.id) ?? d.presetIds.length) > 0
												? ` · ${presetCounts.get(d.id) ?? d.presetIds.length} EQ preset${(presetCounts.get(d.id) ?? d.presetIds.length) > 1 ? "s" : ""}`
												: ""}
											{d.measurementRefs.length > 0
												? ` · ${d.measurementRefs.length} ext. measurement${d.measurementRefs.length > 1 ? "s" : ""}`
												: ""}
										</span>
									</span>
								</button>
								<button
									type="button"
									aria-label={`Favorite device ${d.manufacturer} ${d.model}`}
									aria-pressed={favoriteDevices.includes(d.id)}
									onClick={() =>
										useCatalogFavorites.getState().toggleDevice(d.id)
									}
									className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
								>
									{favoriteDevices.includes(d.id) ? "★" : "☆"}
								</button>
							</span>
							{openId === d.id && open ? (
								<DeviceDetail catalog={catalog} id={open.id} />
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function StandalonePresets({ catalog }: { catalog: DeviceCatalog }) {
	const [status, setStatus] = useState<string | null>(null);
	const presets = catalog.presets.filter((p) => p.deviceId === null);
	if (presets.length === 0) return null;
	return (
		<div className="flex flex-col gap-1 rounded-lg border border-line p-3">
			<h3 className="text-xs font-semibold">Standalone presets</h3>
			<p className="text-[11px] text-muted">
				Editing starting points with no device attached. Importing copies them
				into your presets — the catalog entry never changes.
			</p>
			{presets.map((p) => (
				<div
					key={p.id}
					className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs"
				>
					<span className="min-w-0 flex-1">
						<span className="block truncate font-medium">{p.name}</span>
						<span className="block truncate text-muted">
							Origin: {p.origin} · {p.peq.bands.length} bands ·{" "}
							{p.provenance.attribution}
						</span>
					</span>
					<button
						type="button"
						onClick={() => {
							const copyId = useEQStore.getState().importPreset(p.name, p.peq, {
								origin: p.origin,
								sourceAttribution: p.provenance.attribution,
								sourceLicense: p.provenance.license,
								sourceUrl: p.provenance.sourceUrl,
								sourcePresetId: p.id,
							});
							if (copyId) {
								useEQStore.getState().loadPreset(copyId);
								setStatus(
									`Imported "${p.name}" as your own preset and loaded it.`,
								);
							}
						}}
						className="rounded-full bg-accent px-3 py-1 font-semibold text-accent-ink"
					>
						Import EQ
					</button>
				</div>
			))}
			{status ? (
				<p role="status" className="text-xs text-accent">
					{status}
				</p>
			) : null}
		</div>
	);
}

function DeviceDetail({ catalog, id }: { catalog: DeviceCatalog; id: string }) {
	const device = getDevice(catalog, id);
	const measurements = useIEMStore((s) => s.measurements);
	const targets = useIEMStore((s) => s.targets);
	const [measurementId, setMeasurementId] = useState<string>("");
	const [targetId, setTargetId] = useState<string>("builtin-flat");
	const [status, setStatus] = useState<string | null>(null);
	const favoriteDevices = useCatalogFavorites((s) => s.devices);
	if (!device) return null;
	const presets = devicePresets(catalog, device.id);
	const typeLabel =
		DEVICE_TYPES.find((t) => t.id === device.deviceType)?.label ??
		device.deviceType;

	const createProfile = () => {
		void libraryService
			.createProfile({
				name: `${device.manufacturer} ${device.model}`,
				manufacturer: device.manufacturer,
				model: device.model,
				measurementId: measurementId || null,
				targetId: targetId || null,
			})
			.then(() => {
				setStatus(
					`Profile created for ${device.manufacturer} ${device.model}. Open it under IEM → Profiles to fit EQ.`,
				);
			});
	};

	const useDevice = () => {
		void libraryService
			.useDevice({
				manufacturer: device.manufacturer,
				model: device.model,
				measurementId: measurementId || null,
				targetId: targetId || null,
			})
			.then(({ created }) => {
				setStatus(
					created
						? `Using ${device.manufacturer} ${device.model}: profile created and applied. Save DSP into it from IEM → Profiles.`
						: `Using ${device.manufacturer} ${device.model}: profile DSP applied (one device at a time).`,
				);
			});
	};

	const importPreset = (presetId: string) => {
		const preset = presets.find((p) => p.id === presetId);
		if (!preset) return;
		const eq = useEQStore.getState();
		const copyId = eq.importPreset(
			`${device.model} — ${preset.name}`,
			preset.peq,
			{
				origin: preset.origin,
				deviceName: `${device.manufacturer} ${device.model}`,
				sourceAttribution: preset.provenance.attribution,
				sourceLicense: preset.provenance.license,
				sourceUrl: preset.provenance.sourceUrl,
				sourcePresetId: preset.id,
			},
		);
		if (copyId) {
			eq.loadPreset(copyId);
			setStatus(
				`Imported "${preset.name}" as your own preset and loaded it. The catalog entry is unchanged.`,
			);
		}
	};

	return (
		<div className="ml-2 flex flex-col gap-2 rounded-lg border border-line bg-abyss/40 p-3">
			<div className="flex items-center gap-2">
				<h4 className="text-sm font-semibold">
					{device.manufacturer} {device.model}
				</h4>
				<span className="flex-1" />
				<button
					type="button"
					aria-label={`Favorite device ${device.manufacturer} ${device.model}`}
					aria-pressed={favoriteDevices.includes(device.id)}
					onClick={() => useCatalogFavorites.getState().toggleDevice(device.id)}
					className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					{favoriteDevices.includes(device.id) ? "★ Favorited" : "☆ Favorite"}
				</button>
			</div>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
				<div>
					<dt className="text-muted">Type</dt>
					<dd>{typeLabel}</dd>
				</div>
				<div>
					<dt className="text-muted">Driver</dt>
					<dd>{device.driver.configuration ?? "Unknown"}</dd>
				</div>
				<div>
					<dt className="text-muted">Connectivity</dt>
					<dd>{device.driver.connectivity ?? "Unknown"}</dd>
				</div>
				{device.releaseYear ? (
					<div>
						<dt className="text-muted">Released</dt>
						<dd>{device.releaseYear}</dd>
					</div>
				) : null}
				{device.aliases.length > 0 ? (
					<div className="col-span-2">
						<dt className="text-muted">Also known as</dt>
						<dd>{device.aliases.join(", ")}</dd>
					</div>
				) : null}
			</dl>
			<p className="text-xs text-muted">
				Source: {device.provenance.source} · {device.provenance.attribution} ·
				License: {device.provenance.license}{" "}
				{device.provenance.sourceUrl ? (
					<a
						href={device.provenance.sourceUrl}
						target="_blank"
						rel="noreferrer"
						className="text-accent hover:underline"
					>
						Open source
					</a>
				) : null}
			</p>
			<div className="flex flex-col gap-1">
				<h4 className="text-xs font-semibold">Measurements</h4>
				{device.measurementRefs.length > 0 ? (
					<ul className="flex flex-col gap-1">
						{device.measurementRefs.map((ref, i) => (
							<li key={i} className="text-xs">
								<a
									href={ref.sourceUrl}
									target="_blank"
									rel="noreferrer"
									className="text-accent hover:underline"
								>
									{ref.label}
								</a>
								{ref.channel ? (
									<span className="text-muted"> · {ref.channel}</span>
								) : null}
								{ref.note ? (
									<span className="block text-muted">{ref.note}</span>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="text-xs text-muted">
						No verified external measurement link for this device. Sources
						disagree by rig and method — nothing here implies one is "correct".
						Import your own copy under IEM → Measurements if you may use it.
					</p>
				)}
			</div>
			{presets.length > 0 ? (
				<div className="flex flex-col gap-1">
					<h4 className="text-xs font-semibold">EQ presets</h4>
					{presets.map((p) => (
						<div
							key={p.id}
							className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{p.name}</span>
								<span className="block truncate text-muted">
									Origin: {p.origin} · {p.peq.bands.length} bands · preamp{" "}
									{p.peq.preamp} dB
									{p.targetRef ? ` · target: ${p.targetRef}` : ""}
									{p.measurementRef ? ` · ${p.measurementRef}` : ""}
								</span>
								<span className="block truncate text-muted">
									{p.provenance.attribution}
									{p.provenance.shareAlike ? " · CC BY-SA 4.0" : ""}
								</span>
							</span>
							<button
								type="button"
								onClick={() => importPreset(p.id)}
								className="rounded-full bg-accent px-3 py-1 font-semibold text-accent-ink"
							>
								Import EQ
							</button>
						</div>
					))}
				</div>
			) : (
				<p className="text-xs text-muted">
					No bundled EQ for this device — import a measurement, then fit your
					own correction under IEM.
				</p>
			)}
			<div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
				<label className="flex flex-col gap-1 text-xs text-muted">
					Measurement
					<select
						value={measurementId}
						onChange={(e) => setMeasurementId(e.target.value)}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="">Choose later in IEM</option>
						{Object.values(measurements).map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Target
					<select
						value={targetId}
						onChange={(e) => setTargetId(e.target.value)}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						{allTargets(targets).map((t) => (
							<option
								key={t.kind === "builtin-flat" ? "builtin-flat" : t.id}
								value={t.kind === "builtin-flat" ? "builtin-flat" : t.id}
							>
								{t.name}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					onClick={useDevice}
					className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink"
				>
					Use device
				</button>
				<button
					type="button"
					onClick={createProfile}
					className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-elevated"
				>
					Create profile
				</button>
			</div>
			{status ? (
				<p role="status" className="text-xs text-accent">
					{status}
				</p>
			) : null}
		</div>
	);
}

function SourcesTab({ catalog }: { catalog: DeviceCatalog }) {
	const shareAlikeSources = useMemo(() => {
		const names = new Set<string>();
		for (const p of catalog.presets) {
			if (p.provenance.shareAlike) names.add(p.provenance.source);
		}
		for (const d of catalog.devices) {
			if (d.provenance.shareAlike) names.add(d.provenance.source);
		}
		return [...names].sort();
	}, []);
	const sources = useMemo(() => {
		const rows = new Map<
			string,
			{
				license: string;
				attribution: string;
				redistribution: string;
				url: string;
				shareAlike: boolean;
			}
		>();
		const put = (
			key: string,
			info: {
				license: string;
				attribution: string;
				redistribution: string;
				url: string;
				shareAlike: boolean | undefined;
			},
		) => {
			const prev = rows.get(key);
			rows.set(key, {
				license: prev?.license ?? info.license,
				attribution: prev?.attribution ?? info.attribution,
				redistribution: prev?.redistribution ?? info.redistribution,
				url: prev?.url || info.url,
				shareAlike: (prev?.shareAlike ?? false) || info.shareAlike === true,
			});
		};
		for (const d of catalog.devices) {
			put(d.provenance.source, {
				license: d.provenance.license,
				attribution: d.provenance.attribution,
				redistribution: d.provenance.redistribution,
				url: d.provenance.sourceUrl,
				shareAlike: d.provenance.shareAlike,
			});
		}
		for (const p of catalog.presets) {
			put(`Preset: ${p.provenance.source}`, {
				license: p.provenance.license,
				attribution: p.provenance.attribution,
				redistribution: p.provenance.redistribution,
				url: p.provenance.sourceUrl,
				shareAlike: p.provenance.shareAlike,
			});
		}
		return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, []);
	return (
		<div className="flex flex-col gap-3">
			<p className="text-xs text-muted">
				Everything bundled here, and what it costs. Catalog data version{" "}
				{CATALOG_DATA_VERSION}. Bundled metadata works offline; outbound links
				need a network.{" "}
				{shareAlikeSources.length > 0 ? (
					<>
						Adapted catalog data from {shareAlikeSources.join(", ")} is shared
						under Creative Commons Attribution-ShareAlike 4.0 International —
						share adaptations under the same license with attribution. The app
						code itself stays MIT.
					</>
				) : (
					"No ShareAlike-licensed data is currently bundled."
				)}
			</p>
			<ul className="flex flex-col gap-2">
				{sources.map(([source, info]) => (
					<li
						key={source}
						className="rounded-lg border border-line bg-surface p-3 text-xs"
					>
						<p className="font-semibold">{source}</p>
						<p className="text-muted">{info.attribution}</p>
						<p className="text-muted">
							License: {info.license} · Redistribution: {info.redistribution}
						</p>
						{info.url ? (
							<a
								href={info.url}
								target="_blank"
								rel="noreferrer"
								className="text-accent hover:underline"
							>
								Open source
							</a>
						) : (
							<p className="text-muted">No outbound link (unverified).</p>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

function PresetsTab() {
	const presets = useEQStore((s) => s.presets);
	const [query, setQuery] = useState("");
	const [origin, setOrigin] = useState<string>("all");
	const [favoritesOnly, setFavoritesOnly] = useState(false);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [error, setError] = useState<string | null>(null);

	const origins = [...new Set(presets.map((p) => p.origin ?? "user"))].sort();
	const visible = presets.filter((p) => {
		if (origin !== "all" && (p.origin ?? "user") !== origin) return false;
		if (favoritesOnly && !p.favorite) return false;
		const q = query.trim().toLowerCase();
		if (q === "") return true;
		return (
			p.name.toLowerCase().includes(q) ||
			(p.deviceName ?? "").toLowerCase().includes(q)
		);
	});

	const onImportFile = (file: File | undefined) => {
		if (!file) return;
		setError(null);
		void file
			.text()
			.then((text) => {
				const parsed = importPresetFile(text);
				const meta: {
					origin: PresetOrigin | "user";
					deviceName?: string;
				} = { origin: parsed.origin };
				if (parsed.deviceName !== null) meta.deviceName = parsed.deviceName;
				const id = useEQStore
					.getState()
					.importPreset(parsed.name, parsed.peq, meta);
				if (!id) setError("That preset could not be imported.");
			})
			.catch((e: unknown) => {
				setError(
					e instanceof PresetFileError
						? e.message
						: "That preset could not be imported.",
				);
			});
	};

	return (
		<div className="flex flex-col gap-3">
			<p className="text-xs text-muted">
				Your presets — saved, imported, or fitted. Renaming or deleting here
				never touches catalog data.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<label className="sr-only" htmlFor="preset-search">
					Search presets
				</label>
				<input
					id="preset-search"
					type="search"
					value={query}
					placeholder="Search presets…"
					onChange={(e) => setQuery(e.target.value)}
					className="min-w-40 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-muted"
				/>
				<label className="flex items-center gap-1 text-xs text-muted">
					Origin
					<select
						value={origin}
						aria-label="Filter by preset origin"
						onChange={(e) => setOrigin(e.target.value)}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="all">All origins</option>
						{origins.map((o) => (
							<option key={o} value={o}>
								{o}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-xs text-muted">
					<input
						type="checkbox"
						checked={favoritesOnly}
						onChange={(e) => setFavoritesOnly(e.target.checked)}
					/>
					Favorites
				</label>
				<label className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated">
					Import file
					<input
						type="file"
						accept="application/json,.json"
						className="sr-only"
						aria-label="Import preset file"
						onChange={(e) => {
							onImportFile(e.target.files?.[0]);
							e.target.value = "";
						}}
					/>
				</label>
			</div>
			{error ? (
				<p role="alert" className="text-sm text-red-300">
					{error}
				</p>
			) : null}
			{visible.length === 0 ? (
				<p className="px-2 py-8 text-center text-sm text-muted">
					{presets.length === 0
						? "No presets yet — save one from EQ or import from a device."
						: "No presets match."}
				</p>
			) : (
				<ul className="flex flex-col gap-1">
					{visible.map((p) => (
						<li
							key={p.id}
							className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated/60"
						>
							<span className="min-w-0 flex-1">
								{renaming === p.id ? (
									<form
										className="flex w-full items-center gap-1"
										onSubmit={(e) => {
											e.preventDefault();
											useEQStore.getState().renamePreset(p.id, renameValue);
											setRenaming(null);
										}}
									>
										<label className="sr-only" htmlFor={`rename-${p.id}`}>
											Rename preset
										</label>
										<input
											id={`rename-${p.id}`}
											value={renameValue}
											onChange={(e) => setRenameValue(e.target.value)}
											className="w-36 rounded-md border border-line bg-abyss px-2 py-1 text-sm"
										/>
										<button
											type="submit"
											className="rounded-md px-2 py-1 text-xs hover:bg-elevated"
										>
											Save
										</button>
									</form>
								) : (
									<>
										<span className="block truncate text-sm font-medium">
											{p.favorite ? "★ " : ""}
											{p.name}
										</span>
										<span className="block truncate text-xs text-muted">
											{p.deviceName ? `${p.deviceName} · ` : ""}Origin:{" "}
											{p.origin ?? "user"} · {p.data.bands.length} bands ·
											preamp {p.data.preamp} dB
										</span>
										{p.sourceAttribution ? (
											<span className="block truncate text-xs text-muted">
												{p.sourceAttribution}
												{p.sourceLicense ? ` · ${p.sourceLicense}` : ""}
											</span>
										) : null}
									</>
								)}
							</span>
							{renaming === p.id ? null : (
								<span className="flex shrink-0 gap-1">
									<button
										type="button"
										aria-label={`Load preset ${p.name}`}
										onClick={() => useEQStore.getState().loadPreset(p.id)}
										className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
									>
										Load
									</button>
									<button
										type="button"
										aria-label={`Favorite preset ${p.name}`}
										aria-pressed={p.favorite ?? false}
										onClick={() =>
											useEQStore.getState().togglePresetFavorite(p.id)
										}
										className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
									>
										{p.favorite ? "★" : "☆"}
									</button>
									<button
										type="button"
										aria-label={`Rename preset ${p.name}`}
										onClick={() => {
											setRenaming(p.id);
											setRenameValue(p.name);
										}}
										className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
									>
										Rename
									</button>
									<button
										type="button"
										aria-label={`Export preset ${p.name}`}
										onClick={() => {
											const args: {
												name: string;
												deviceName?: string;
												origin: PresetOrigin | "user";
												attribution?: string;
												peq: SerializedPEQ;
											} = {
												name: p.name,
												origin: p.origin ?? "user",
												peq: p.data,
											};
											if (p.deviceName !== undefined)
												args.deviceName = p.deviceName;
											if (p.sourceAttribution !== undefined)
												args.attribution = p.sourceAttribution;
											downloadFile(
												`${p.name.replaceAll(/[^\w\- ]+/g, "").trim() || "preset"}.preset.json`,
												exportPresetFile(args),
											);
										}}
										className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
									>
										Export
									</button>
									<button
										type="button"
										aria-label={`Delete preset ${p.name}`}
										onClick={() => useEQStore.getState().deletePreset(p.id)}
										className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
									>
										Delete
									</button>
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
