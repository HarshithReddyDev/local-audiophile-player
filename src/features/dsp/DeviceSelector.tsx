import { useEffect, useMemo, useState } from "react";
import { useCatalogFavorites } from "../../catalog/favorites";
import { loadFullCatalog } from "../../catalog/loader";
import type { DeviceCatalog } from "../../catalog/types";
import { libraryService } from "../../library/library-service";
import { useIEMStore } from "../../state/iem-store";
import { useSettingsStore } from "../../state/settings-store";

interface DeviceRow {
	id: string;
	title: string;
	subtitle: string;
	kind: "catalog" | "profile";
	manufacturer: string;
	model: string;
}

/**
 * Quick device switcher: search across your profiles and the catalog,
 * with favorites and recently used first. Applying a device replaces
 * the previous device profile (one at a time) and reports what
 * happened — never a silent jump.
 */
export function DeviceSelector({
	onDone,
	onOpenCatalog,
}: {
	onDone?: () => void;
	onOpenCatalog?: () => void;
}) {
	const [query, setQuery] = useState("");
	const [catalog, setCatalog] = useState<DeviceCatalog | null>(null);
	const [catalogFailed, setCatalogFailed] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const profiles = useIEMStore((s) => s.profiles);
	const favoriteDevices = useCatalogFavorites((s) => s.devices);
	const recentIds = useSettingsStore((s) => s.recentDeviceIds);

	useEffect(() => {
		let live = true;
		void loadFullCatalog().then(
			({ catalog: full }) => {
				if (live) setCatalog(full);
			},
			() => {
				if (live) setCatalogFailed(true);
			},
		);
		return () => {
			live = false;
		};
	}, []);

	const profileRows: DeviceRow[] = useMemo(
		() =>
			Object.values(profiles).map((p) => ({
				id: `profile:${p.id}`,
				title: p.name,
				subtitle: "Your profile",
				kind: "profile" as const,
				manufacturer: p.manufacturer,
				model: p.model,
			})),
		[profiles],
	);

	const catalogRows: DeviceRow[] = useMemo(() => {
		if (!catalog) return [];
		return catalog.devices.map((d) => ({
			id: `catalog:${d.id}`,
			title: `${d.manufacturer} ${d.model}`.trim(),
			subtitle: d.driver.configuration ?? d.deviceType,
			kind: "catalog" as const,
			manufacturer: d.manufacturer,
			model: d.model,
		}));
	}, [catalog]);

	const q = query.trim().toLowerCase();
	const matches = (row: DeviceRow): boolean => {
		if (q === "") return true;
		return (
			row.title.toLowerCase().includes(q) ||
			row.subtitle.toLowerCase().includes(q)
		);
	};

	const searched =
		q === ""
			? []
			: [...profileRows, ...catalogRows].filter(matches).slice(0, 30);

	const favoriteRows = useMemo(
		() =>
			catalogRows.filter((r) =>
				favoriteDevices.includes(r.id.replace(/^catalog:/, "")),
			),
		[catalogRows, favoriteDevices],
	);

	const recentRows = useMemo(() => {
		const all = new Map(
			[...profileRows, ...catalogRows].map((r) => [
				r.id.replace(/^(catalog|profile):/, ""),
				r,
			]),
		);
		const rows: DeviceRow[] = [];
		for (const id of recentIds) {
			const direct =
				all.get(id) ??
				[...all.values()].find((r) => r.id === `catalog:${id}`) ??
				[...all.values()].find((r) => r.id === `profile:${id}`);
			if (direct && !rows.some((r) => r.id === direct.id)) rows.push(direct);
		}
		return rows;
	}, [profileRows, catalogRows, recentIds]);

	const apply = async (row: DeviceRow): Promise<void> => {
		setStatus(null);
		try {
			if (row.kind === "profile") {
				const profileId = row.id.replace(/^profile:/, "");
				libraryService.selectProfile(profileId);
				useSettingsStore.getState().touchRecentDevice(profileId);
				setStatus(`Device profile loaded: ${row.title}.`);
			} else {
				const deviceId = row.id.replace(/^catalog:/, "");
				await libraryService.useDevice({
					manufacturer: row.manufacturer,
					model: row.model,
					measurementId: null,
					targetId: null,
				});
				useSettingsStore.getState().touchRecentDevice(deviceId);
				setStatus(`Device profile loaded: ${row.title}.`);
			}
			onDone?.();
		} catch {
			setStatus("Could not apply that device. Nothing was changed.");
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<label className="sr-only" htmlFor="device-search">
				Search devices and profiles
			</label>
			<input
				id="device-search"
				type="search"
				value={query}
				placeholder="Search devices and profiles…"
				onChange={(e) => setQuery(e.target.value)}
				className="w-full rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-muted"
			/>
			{status ? (
				<p role="status" className="text-xs text-accent">
					{status}
				</p>
			) : null}
			{catalogFailed ? (
				<p role="alert" className="text-xs text-red-300">
					The device catalog could not be loaded. Your profiles below still
					work; playback is unaffected.
				</p>
			) : null}
			{q !== "" ? (
				<RowList
					heading={`Results (${searched.length})`}
					rows={searched}
					empty="No devices or profiles match."
					onApply={(row) => void apply(row)}
				/>
			) : (
				<>
					<RowList
						heading="Your profiles"
						rows={profileRows.slice(0, 10)}
						empty="No profiles yet — create one from a device."
						onApply={(row) => void apply(row)}
					/>
					{favoriteRows.length > 0 ? (
						<RowList
							heading="Favorite devices"
							rows={favoriteRows.slice(0, 10)}
							empty=""
							onApply={(row) => void apply(row)}
						/>
					) : null}
					{recentRows.length > 0 ? (
						<RowList
							heading="Recently used"
							rows={recentRows.slice(0, 8)}
							empty=""
							onApply={(row) => void apply(row)}
						/>
					) : null}
					{!catalog && !catalogFailed ? (
						<p role="status" className="text-xs text-muted">
							Loading device catalog…
						</p>
					) : null}
				</>
			)}
			{onOpenCatalog ? (
				<button
					type="button"
					onClick={onOpenCatalog}
					className="self-start rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Open full device catalog →
				</button>
			) : null}
		</div>
	);
}

function RowList({
	heading,
	rows,
	empty,
	onApply,
}: {
	heading: string;
	rows: DeviceRow[];
	empty: string;
	onApply: (row: DeviceRow) => void;
}) {
	if (rows.length === 0 && empty === "") return null;
	return (
		<div className="flex flex-col gap-1">
			<h4 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
				{heading}
			</h4>
			{rows.length === 0 ? (
				<p className="text-xs text-muted">{empty}</p>
			) : (
				<ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
					{rows.map((row) => (
						<li key={row.id}>
							<button
								type="button"
								onClick={() => onApply(row)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-elevated"
								aria-label={`Use ${row.title}`}
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{row.title}
									</span>
									<span className="block truncate text-xs text-muted">
										{row.subtitle}
									</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
