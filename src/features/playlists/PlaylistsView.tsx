import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { SMART_RULES, type SmartRuleId, smartTrackIds } from "../../dsp/smart";
import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { TrackArtwork } from "../library/TrackArtwork";
import { TrackList } from "../library/TrackList";
import { playTrack } from "../player/use-playback";
import { PlaylistImportView } from "./PlaylistImportView";

/** Import a .cue sheet: virtual segment tracks sharing one file's bytes. */
function CueImportButton({ onOpen }: { onOpen: (id: string) => void }) {
	const [status, setStatus] = useState<string | null>(null);
	const importCue = async (file: File): Promise<void> => {
		setStatus(null);
		if (file.size > 1024 * 1024) {
			setStatus("That .cue file is suspiciously large — skipped.");
			return;
		}
		try {
			const result = await libraryService.importCueSheet(await file.text());
			if (!result) {
				setStatus(
					"No usable cue tracks, or the referenced audio file is not in the library yet — import its folder first.",
				);
				return;
			}
			setStatus(
				`Added ${result.trackIds.length} cue tracks${result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ""}.`,
			);
			onOpen(result.playlistId);
		} catch {
			setStatus("That .cue file could not be read.");
		}
	};
	return (
		<span className="inline-flex items-center gap-2">
			<label className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-sm hover:bg-elevated">
				Import CUE sheet
				<input
					type="file"
					accept=".cue,.txt"
					className="sr-only"
					aria-label="Import CUE sheet"
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = "";
						if (file) void importCue(file);
					}}
				/>
			</label>
			{status ? (
				<span role="status" className="text-xs text-muted">
					{status}
				</span>
			) : null}
		</span>
	);
}

/** Smart playlists: deterministic rules over library metadata. Derived, never stored. */
function SmartPlaylists() {
	const [rule, setRule] = useState<SmartRuleId | null>(null);
	const tracks = useLibraryStore((s) => s.tracks);
	const order = useLibraryStore((s) => s.order);
	const favorites = useLibraryStore((s) => s.favorites);
	const ratings = useLibraryStore((s) => s.ratings);
	const stats = useLibraryStore((s) => s.stats);
	const ids = useMemo(
		() =>
			rule
				? smartTrackIds(rule, { tracks, order, favorites, ratings, stats })
				: [],
		[rule, tracks, order, favorites, ratings, stats],
	);
	const items = useMemo(
		() => ids.map((id) => tracks[id]).filter((t) => t != null),
		[ids, tracks],
	);
	const playIds = () => {
		if (ids.length === 0) return;
		usePlayerStore.getState().setQueue(ids, 0);
		void playTrack(ids[0] ?? null, true);
	};
	return (
		<section aria-labelledby="smart-heading" className="flex flex-col gap-2">
			<h2 id="smart-heading" className="text-sm font-semibold">
				Smart playlists
			</h2>
			<div
				className="flex flex-wrap gap-1"
				role="group"
				aria-label="Smart playlist rules"
			>
				{SMART_RULES.map((r) => (
					<button
						key={r.id}
						type="button"
						title={r.description}
						aria-pressed={rule === r.id}
						onClick={() =>
							setRule((current) => (current === r.id ? null : r.id))
						}
						className={`rounded-full border border-line px-3 py-1 text-xs ${rule === r.id ? "bg-elevated font-semibold" : "hover:bg-elevated"}`}
					>
						{r.label}
					</button>
				))}
			</div>
			{rule ? (
				items.length === 0 ? (
					<p className="text-xs text-muted">Nothing matches this rule yet.</p>
				) : (
					<div className="flex flex-col gap-1">
						<button
							type="button"
							onClick={playIds}
							className="self-start rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
						>
							Play all ({items.length})
						</button>
						<TrackList tracks={items} />
					</div>
				)
			) : null}
		</section>
	);
}

/** Playlists: create from queue, open, play, rename, remove tracks, delete. */
export function PlaylistsView({
	externalOpenId = null,
	onExternalOpenConsumed,
}: {
	externalOpenId?: string | null;
	onExternalOpenConsumed?: (() => void) | undefined;
} = {}) {
	const playlists = useLibraryStore((s) => s.playlists);
	const tracksById = useLibraryStore((s) => s.tracks);
	const [openId, setOpenId] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");

	// Music search can deep-link into a playlist exactly once per request.
	useEffect(() => {
		if (externalOpenId != null) {
			setOpenId(externalOpenId);
			onExternalOpenConsumed?.();
		}
	}, [externalOpenId, onExternalOpenConsumed]);
	const list = Object.values(playlists).sort(
		(a, b) => b.createdAt - a.createdAt,
	);
	const open = openId ? (playlists[openId] ?? null) : null;
	const queueLength = usePlayerStore((s) => s.queue.length);

	const createFromQueue = () => {
		const queue = usePlayerStore.getState().queue;
		if (queue.length === 0) return;
		void libraryService
			.createPlaylist(
				name,
				queue.map((q) => q.trackId),
			)
			.then((id) => {
				setName("");
				setOpenId(id);
			});
	};

	if (open) {
		const tracksById = useLibraryStore.getState().tracks;
		const tracks = open.trackIds
			.map((id) => tracksById[id])
			.filter((t) => t != null);
		const exportM3U = () => {
			if (!open || open.trackIds.length === 0) return;
			const tracksById = useLibraryStore.getState().tracks;
			const lines = ["#EXTM3U"];
			for (const id of open.trackIds) {
				const track = tracksById[id];
				if (!track) continue;
				const duration =
					track.duration != null ? Math.round(track.duration) : -1;
				lines.push(`#EXTINF:${duration},${track.artist} - ${track.title}`);
				// Local paths re-import by filename; remote/cue entries keep
				// their display path as a best-effort reference.
				lines.push(track.path ?? track.fileName);
			}
			const blob = new Blob([lines.join("\n")], { type: "audio/x-mpegurl" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${open.name.replaceAll(/[^\w\- ]+/g, "").trim() || "playlist"}.m3u`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 5000);
		};
		const playIds = (shuffle: boolean) => {
			if (open.trackIds.length === 0) return;
			const player = usePlayerStore.getState();
			player.setQueue(open.trackIds, 0);
			if (shuffle && !player.shuffle) player.toggleShuffle();
			if (!shuffle && player.shuffle) player.toggleShuffle();
			void playTrack(open.trackIds[0] ?? null, true);
		};
		return (
			<div className="flex flex-col gap-4">
				<button
					type="button"
					onClick={() => setOpenId(null)}
					className="self-start rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					← Playlists
				</button>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
					<TrackArtwork
						artworkId={tracks.find((t) => t.artworkId)?.artworkId ?? null}
						title={open.name}
						size={160}
					/>
					<div className="min-w-0">
						<p className="text-[13px] font-medium tracking-wide text-muted uppercase">
							Playlist
						</p>
						{renaming ? (
							<form
								className="mt-1 flex items-center gap-2"
								onSubmit={(e) => {
									e.preventDefault();
									void libraryService
										.renamePlaylist(open.id, renameValue)
										.then(() => setRenaming(false));
								}}
							>
								<label className="sr-only" htmlFor="rename-playlist">
									Rename playlist
								</label>
								<input
									id="rename-playlist"
									type="text"
									value={renameValue}
									onChange={(e) => setRenameValue(e.target.value)}
									className="w-56 rounded-xl border border-line bg-surface px-3 py-1.5 text-lg font-semibold"
								/>
								<button
									type="submit"
									className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink"
								>
									Save
								</button>
							</form>
						) : (
							<h2 className="truncate text-2xl font-bold tracking-tight">
								{open.name}
							</h2>
						)}
						<p className="mt-1 text-sm text-muted">
							{tracks.length} {tracks.length === 1 ? "track" : "tracks"}
							{open.importedFrom
								? ` · Imported from ${open.importedFrom.provider}`
								: ""}
						</p>
						<div className="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => playIds(false)}
								disabled={open.trackIds.length === 0}
								className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:opacity-40"
							>
								Play
							</button>
							<button
								type="button"
								onClick={() => playIds(true)}
								disabled={open.trackIds.length === 0}
								aria-label={`Shuffle playlist ${open.name}`}
								className="rounded-full border border-line px-5 py-2 text-sm font-medium transition-colors hover:bg-elevated disabled:opacity-40"
							>
								Shuffle
							</button>
							<button
								type="button"
								onClick={() => usePlayerStore.getState().enqueue(open.trackIds)}
								disabled={open.trackIds.length === 0}
								aria-label={`Add playlist ${open.name} to queue`}
								className="rounded-full border border-line px-5 py-2 text-sm font-medium transition-colors hover:bg-elevated disabled:opacity-40"
							>
								Add to queue
							</button>
							<button
								type="button"
								onClick={exportM3U}
								aria-label={`Export playlist ${open.name} as M3U`}
								className="rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
							>
								Export
							</button>
							{!renaming ? (
								<button
									type="button"
									onClick={() => {
										setRenameValue(open.name);
										setRenaming(true);
									}}
									aria-label={`Rename playlist ${open.name}`}
									className="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
								>
									Rename
								</button>
							) : null}
						</div>
					</div>
				</div>
				{tracks.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted">
						This playlist is empty.
					</p>
				) : (
					<TrackList
						tracks={tracks}
						onRemove={(trackId) =>
							void libraryService.removeFromPlaylist(open.id, trackId)
						}
					/>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="text-2xl font-bold tracking-tight">Playlists</h2>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() => setImporting((v) => !v)}
					aria-expanded={importing}
					className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02]"
				>
					Import playlist
				</button>
				<CueImportButton onOpen={setOpenId} />
			</div>
			{importing ? (
				<PlaylistImportView onDone={() => setImporting(false)} />
			) : null}
			<form
				className="flex flex-wrap items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					createFromQueue();
				}}
			>
				<label className="sr-only" htmlFor="playlist-name">
					New playlist name
				</label>
				<input
					id="playlist-name"
					type="text"
					value={name}
					placeholder="New playlist from current queue…"
					onChange={(e) => setName(e.target.value)}
					className="min-w-52 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-muted"
				/>
				<button
					type="submit"
					disabled={queueLength === 0}
					className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
				>
					Save queue as playlist
				</button>
			</form>
			<SmartPlaylists />
			{list.length === 0 ? (
				<EmptyState
					title="No playlists yet"
					body="Play something, then save the queue as a playlist to find it here."
				/>
			) : (
				<section aria-label="My playlists">
					<h3 className="mb-2 text-base font-semibold tracking-tight">
						My playlists
					</h3>
					<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{list.map((p) => {
							const firstTrack = p.trackIds
								.map((id) => tracksById[id])
								.find((t) => t !== undefined);
							return (
								<li
									key={p.id}
									className="flex items-center gap-3 rounded-2xl bg-surface p-3 transition-colors hover:bg-elevated"
								>
									<TrackArtwork
										artworkId={firstTrack?.artworkId ?? null}
										title={p.name}
										size={52}
									/>
									<button
										type="button"
										onClick={() => setOpenId(p.id)}
										className="min-w-0 flex-1 text-left"
										aria-label={`Open playlist ${p.name}`}
									>
										<span className="block truncate text-[14px] font-medium">
											{p.favorite ? "★ " : ""}
											{p.name}
										</span>
										<span className="block text-[13px] text-muted">
											{p.trackIds.length}{" "}
											{p.trackIds.length === 1 ? "track" : "tracks"}
											{p.importedFrom
												? ` · Imported from ${p.importedFrom.provider}`
												: ""}
										</span>
									</button>
									<button
										type="button"
										onClick={() =>
											void libraryService.togglePlaylistFavorite(p.id)
										}
										aria-label={
											p.favorite
												? `Unfavorite playlist ${p.name}`
												: `Favorite playlist ${p.name}`
										}
										aria-pressed={p.favorite ?? false}
										className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors hover:bg-elevated ${p.favorite ? "text-accent" : "text-muted hover:text-ink"}`}
									>
										{p.favorite ? "★" : "☆"}
									</button>
									<button
										type="button"
										onClick={() => {
											// Playlists have no source to re-import from: deleting
											// is irreversible, so confirm first.
											if (
												window.confirm(
													`Delete playlist "${p.name}"? This cannot be undone.`,
												)
											) {
												void libraryService.deletePlaylist(p.id);
											}
										}}
										aria-label={`Delete playlist ${p.name}`}
										className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
									>
										Delete
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			)}
		</div>
	);
}
