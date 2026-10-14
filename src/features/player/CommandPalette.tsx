import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "../../app/routes";
import { peekCachedCatalog } from "../../catalog/loader";
import { libraryService } from "../../library/library-service";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { useIEMStore } from "../../state/iem-store";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import {
	type PaletteCorpus,
	type PaletteEntry,
	searchPalette,
} from "./palette-search";
import {
	nextTrack,
	playTrack,
	previousTrack,
	togglePlayback,
} from "./use-playback";

const KIND_LABEL: Record<PaletteEntry["kind"], string> = {
	action: "Commands",
	route: "Go to",
	track: "Tracks",
	album: "Albums",
	artist: "Artists",
	playlist: "Playlists",
	device: "Devices",
	preset: "Presets",
};

interface CommandPaletteProps {
	open: boolean;
	onClose: () => void;
	onNavigate: (route: Route) => void;
	onOpenQueue: () => void;
	onOpenNowPlaying: () => void;
}

/**
 * Lightweight command palette (Ctrl/⌘+K): transport commands, route
 * jumps, and search over in-memory tracks, playlists, user presets,
 * and the device catalog — but only when the catalog is already
 * loaded (the palette never forces the bulk chunk to load).
 */
export function CommandPalette({
	open,
	onClose,
	onNavigate,
	onOpenQueue,
	onOpenNowPlaying,
}: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const tracks = useLibraryStore((s) => s.tracks);
	const playlists = useLibraryStore((s) => s.playlists);
	const eqPresets = useEQStore((s) => s.presets);
	const graphicPresets = useDspStore((s) => s.graphicPresets);
	const profiles = useIEMStore((s) => s.profiles);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setHighlight(0);
		inputRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			// Keep Tab cycling inside the dialog while it is open.
			if (e.key === "Tab") {
				const root = document.querySelector(
					'[role="dialog"][aria-label="Command palette"]',
				);
				if (!root) return;
				const focusable = [
					...root.querySelectorAll<HTMLElement>("input, button"),
				].filter((el) => !el.hasAttribute("disabled"));
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (!first || !last) return;
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const corpus: PaletteCorpus = useMemo(
		() => ({
			tracks: Object.values(tracks).map((t) => ({
				id: t.id,
				title: t.title,
				artist: t.artist,
				album: t.album,
			})),
			playlists: Object.values(playlists).map((p) => ({
				id: p.id,
				name: p.name,
				trackIds: p.trackIds,
			})),
			presets: [
				...eqPresets.map((p) => ({
					id: `eq:${p.id}`,
					name: p.name,
					detail: `EQ preset · ${p.data.bands.length} bands`,
				})),
				...graphicPresets.map((p) => ({
					id: `graphic:${p.id}`,
					name: p.name,
					detail: "Graphic preset",
				})),
				...Object.values(profiles).map((p) => ({
					id: `profile:${p.id}`,
					name: p.name,
					detail: "Device profile",
				})),
			],
			devices:
				peekCachedCatalog()?.devices.map((d) => ({
					id: d.id,
					title: `${d.manufacturer} ${d.model}`.trim(),
					subtitle: d.driver.configuration ?? d.deviceType,
				})) ?? [],
			routes: [
				{ id: "tracks", title: "Music", subtitle: "Tracks, albums, artists" },
				{ id: "playlists", title: "Playlists", subtitle: "Your lists" },
				{ id: "devices", title: "Devices", subtitle: "Catalog + presets" },
				{ id: "eq", title: "EQ & DSP", subtitle: "Equalizer" },
				{ id: "dsp", title: "EQ & DSP", subtitle: "DSP workspace" },
				{
					id: "iem",
					title: "My Devices",
					subtitle: "Profiles, measurements, AutoEQ",
				},
				{ id: "guides", title: "Guides", subtitle: "Help and audio guides" },
				{ id: "settings", title: "Settings", subtitle: "App preferences" },
			],
			actions: [
				{ id: "play-pause", title: "Play / pause", subtitle: "Transport" },
				{ id: "next", title: "Next track", subtitle: "Transport" },
				{ id: "previous", title: "Previous track", subtitle: "Transport" },
				{ id: "toggle-dsp", title: "Toggle DSP bypass", subtitle: "Audio" },
				{ id: "compare", title: "Toggle A/B compare", subtitle: "Audio" },
				{ id: "open-queue", title: "Open queue", subtitle: "Playback" },
				{
					id: "open-now-playing",
					title: "Open Now Playing",
					subtitle: "Playback",
				},
			],
		}),
		[tracks, playlists, eqPresets, graphicPresets, profiles, open],
	);

	const results = useMemo(
		() => searchPalette(query, corpus, 30),
		[query, corpus],
	);

	useEffect(() => {
		setHighlight(0);
	}, [query]);

	if (!open) return null;

	const run = (entry: PaletteEntry): void => {
		const player = usePlayerStore.getState();
		switch (entry.kind) {
			case "track": {
				player.setQueue([entry.id], 0);
				void playTrack(entry.id, true);
				break;
			}
			case "album":
			case "artist": {
				const ids = Object.values(tracks)
					.filter((t) =>
						entry.kind === "album"
							? t.album === entry.id
							: t.artist === entry.id,
					)
					.map((t) => t.id);
				if (ids.length > 0) {
					player.setQueue(ids, 0);
					void playTrack(ids[0] ?? null, true);
				}
				break;
			}
			case "playlist": {
				const playlist = playlists[entry.id];
				if (playlist && playlist.trackIds.length > 0) {
					player.setQueue(playlist.trackIds, 0);
					void playTrack(playlist.trackIds[0] ?? null, true);
				}
				break;
			}
			case "device": {
				onNavigate("devices");
				break;
			}
			case "preset": {
				if (entry.id.startsWith("eq:")) {
					useEQStore.getState().loadPreset(entry.id.slice(3));
					onNavigate("eq");
				} else if (entry.id.startsWith("graphic:")) {
					useDspStore.getState().loadGraphicPreset(entry.id.slice(8));
					onNavigate("eq");
				} else if (entry.id.startsWith("profile:")) {
					libraryService.selectProfile(entry.id.slice(8));
					onNavigate("dsp");
				}
				break;
			}
			case "route":
				onNavigate(entry.id as Route);
				break;
			case "action":
				runAction(entry.id, onOpenQueue, onOpenNowPlaying);
				break;
		}
		onClose();
	};

	const grouped = new Map<string, PaletteEntry[]>();
	for (const entry of results) {
		const list = grouped.get(entry.kind) ?? [];
		list.push(entry);
		grouped.set(entry.kind, list);
	}
	let flatIndex = -1;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			className="fixed inset-0 z-50 flex items-start justify-center bg-abyss/70 p-4 pt-[12vh]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
				<label className="sr-only" htmlFor="command-palette-input">
					Search tracks, playlists, devices, presets, and commands
				</label>
				<input
					id="command-palette-input"
					ref={inputRef}
					type="search"
					value={query}
					placeholder="Type a command or search…"
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setHighlight((h) => Math.min(h + 1, results.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setHighlight((h) => Math.max(h - 1, 0));
						} else if (e.key === "Enter") {
							const entry = results[highlight];
							if (entry) run(entry);
						}
					}}
					className="border-b border-line bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
				/>
				<div
					className="overflow-y-auto p-2"
					role="listbox"
					aria-label="Results"
				>
					{results.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-muted">
							No matches. Devices appear here once the catalog has loaded.
						</p>
					) : (
						[...grouped.entries()].map(([kind, entries]) => (
							<div key={kind}>
								<p
									aria-hidden="true"
									className="px-2 pt-2 text-[10px] font-semibold tracking-widest text-muted uppercase"
								>
									{KIND_LABEL[kind as PaletteEntry["kind"]]}
								</p>
								{entries.map((entry) => {
									flatIndex += 1;
									const index = flatIndex;
									return (
										<button
											key={`${entry.kind}:${entry.id}`}
											type="button"
											role="option"
											aria-selected={index === highlight}
											onClick={() => run(entry)}
											onMouseEnter={() => setHighlight(index)}
											className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${index === highlight ? "bg-elevated" : ""}`}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium">
													{entry.title}
												</span>
												<span className="block truncate text-xs text-muted">
													{entry.subtitle}
												</span>
											</span>
										</button>
									);
								})}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}

function runAction(
	id: string,
	onOpenQueue: () => void,
	onOpenNowPlaying: () => void,
): void {
	switch (id) {
		case "play-pause":
			togglePlayback();
			break;
		case "next":
			nextTrack();
			break;
		case "previous":
			previousTrack();
			break;
		case "toggle-dsp": {
			const dsp = useDspStore.getState();
			dsp.setMasterBypass(!dsp.masterBypass);
			break;
		}
		case "compare": {
			const dsp = useDspStore.getState();
			dsp.setComparing(!dsp.comparing);
			break;
		}
		case "open-queue":
			onOpenQueue();
			break;
		case "open-now-playing":
			onOpenNowPlaying();
			break;
		default:
			break;
	}
}
