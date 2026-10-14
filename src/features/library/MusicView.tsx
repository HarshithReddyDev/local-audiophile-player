import { useMemo, useState } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import type { TrackSortKey } from "../../library/grouping";
import {
	buildAlbums,
	buildArtists,
	filterTracks,
	sortTracks,
} from "../../library/grouping";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import type { Track } from "../../types/library";
import { formatTime } from "../../utils/time";
import { playTrack } from "../player/use-playback";
import { FavoritesView, RecentView } from "./CollectionsView";
import { ImportControls } from "./ImportControls";
import { TrackArtwork } from "./TrackArtwork";
import { TrackList } from "./TrackList";

export type MusicTab =
	| "all"
	| "albums"
	| "artists"
	| "genres"
	| "recent"
	| "favorites";

/** Legacy route id → workspace tab (routes stay stable, UI is unified). */
export function musicTabForRoute(route: string): MusicTab {
	switch (route) {
		case "albums":
			return "albums";
		case "artists":
			return "artists";
		case "genres":
			return "genres";
		case "recent":
			return "recent";
		case "favorites":
			return "favorites";
		default:
			return "all";
	}
}

const TABS: { id: MusicTab; label: string; ariaLabel?: string }[] = [
	{ id: "all", label: "All", ariaLabel: "All Music" },
	{ id: "albums", label: "Albums" },
	{ id: "artists", label: "Artists" },
	{ id: "genres", label: "Genres" },
	{ id: "recent", label: "Recently Played" },
	{ id: "favorites", label: "Favorites" },
];

const SORT_OPTIONS: { value: TrackSortKey; label: string }[] = [
	{ value: "title", label: "Title" },
	{ value: "artist", label: "Artist" },
	{ value: "album", label: "Album" },
	{ value: "year", label: "Year" },
	{ value: "duration", label: "Duration" },
	{ value: "added", label: "Date added" },
	{ value: "source", label: "Source" },
	{ value: "format", label: "Format" },
];

/**
 * Unified Music workspace: overview dashboard, collection tabs, grouped
 * search, and album/artist/genre detail — one destination instead of six
 * sidebar entries. Data flow reuses the existing library store/grouping.
 */
export function MusicView({
	initialTab = "all",
	onOpenPlaylist,
	onOpenCloudSources,
}: {
	initialTab?: MusicTab;
	onOpenPlaylist?: ((playlistId: string) => void) | undefined;
	onOpenCloudSources?: (() => void) | undefined;
}) {
	const [tab, setTab] = useState<MusicTab>(initialTab);
	const [adding, setAdding] = useState(false);
	const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const searchQuery = useLibraryStore((s) => s.searchQuery);

	const tracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);

	if (tracks.length === 0) {
		return (
			<div className="flex flex-col gap-2">
				<h2 className="text-2xl font-bold tracking-tight">Music</h2>
				<EmptyState
					title="Your library is empty"
					body="Add music from your device or a supported source to get started."
					actions={
						<>
							<ImportControls />
							{onOpenCloudSources ? (
								<button
									type="button"
									onClick={onOpenCloudSources}
									className="rounded-full border border-line px-4 py-2 text-sm font-medium transition-colors hover:bg-elevated"
								>
									Cloud accounts
								</button>
							) : null}
						</>
					}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="text-2xl font-bold tracking-tight">Music</h2>
				<span className="text-sm text-muted">
					{tracks.length} {tracks.length === 1 ? "track" : "tracks"}
				</span>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() => setAdding((v) => !v)}
					aria-expanded={adding}
					className="rounded-full border border-line px-4 py-1.5 text-sm font-medium transition-colors hover:bg-elevated"
				>
					Add music
				</button>
			</div>

			{adding ? (
				<div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-3">
					<ImportControls />
					{onOpenCloudSources ? (
						<button
							type="button"
							onClick={onOpenCloudSources}
							className="rounded-full border border-line px-4 py-2 text-sm transition-colors hover:bg-elevated"
						>
							Cloud accounts →
						</button>
					) : null}
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				<div
					role="tablist"
					aria-label="Music sections"
					className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-line p-1"
				>
					{TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={tab === t.id}
							{...(t.ariaLabel ? { "aria-label": t.ariaLabel } : {})}
							onClick={() => setTab(t.id)}
							className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
								tab === t.id
									? "bg-elevated font-semibold text-ink"
									: "text-muted hover:text-ink"
							}`}
						>
							{t.label}
						</button>
					))}
				</div>
				<label className="flex min-w-44 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2">
					<span className="sr-only">Search music</span>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden="true"
						className="shrink-0 text-muted"
					>
						<circle cx="11" cy="11" r="7" />
						<path d="m20 20-3.5-3.5" />
					</svg>
					<input
						type="search"
						value={searchQuery}
						placeholder="Search tracks, albums, artists, genres…"
						onChange={(e) =>
							useLibraryStore.getState().setSearchQuery(e.target.value)
						}
						className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted"
					/>
				</label>
			</div>

			{searchQuery.trim() ? (
				<SearchResults
					query={searchQuery}
					onOpenAlbum={(id) => {
						setOpenAlbumId(id);
						setTab("albums");
					}}
					{...(onOpenPlaylist ? { onOpenPlaylist } : {})}
					onSelectTab={setTab}
				/>
			) : null}

			{tab === "all" ? <Overview onOpenTab={setTab} /> : null}
			{tab === "albums" ? (
				<AlbumsTab openId={openAlbumId} onOpenChange={setOpenAlbumId} />
			) : null}
			{tab === "artists" ? <ArtistsTab /> : null}
			{tab === "genres" ? <GenresTab /> : null}
			{tab === "recent" ? <RecentView /> : null}
			{tab === "favorites" ? <FavoritesView /> : null}
		</div>
	);
}

/** Grouped search over data already in memory — no new indexing. */
function SearchResults({
	query,
	onOpenPlaylist,
	onSelectTab,
	onOpenAlbum,
}: {
	query: string;
	onOpenPlaylist?: ((playlistId: string) => void) | undefined;
	onSelectTab: (t: MusicTab) => void;
	onOpenAlbum: (id: string, tab: MusicTab) => void;
}) {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const playlists = useLibraryStore((s) => s.playlists);
	const tracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);
	const albums = useMemo(() => buildAlbums(tracks), [tracks]);
	const artists = useMemo(() => buildArtists(tracks, albums), [tracks, albums]);
	const q = query.trim().toLowerCase();

	const matchedAlbums = albums
		.filter(
			(a) =>
				a.name.toLowerCase().includes(q) ||
				a.albumArtist.toLowerCase().includes(q),
		)
		.slice(0, 4);
	const matchedArtists = artists
		.filter((a) => a.name.toLowerCase().includes(q))
		.slice(0, 4);
	const genreNames = useMemo(() => {
		const counts = new Map<string, number>();
		for (const t of tracks)
			for (const g of t.genre) counts.set(g, (counts.get(g) ?? 0) + 1);
		return [...counts.entries()]
			.filter(([name]) => name.toLowerCase().includes(q))
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 4);
	}, [tracks, q]);
	const matchedPlaylists = Object.values(playlists)
		.filter((p) => p.name.toLowerCase().includes(q))
		.slice(0, 4);
	const matchedTracks = filterTracks(tracks, query);

	if (
		matchedAlbums.length === 0 &&
		matchedArtists.length === 0 &&
		genreNames.length === 0 &&
		matchedPlaylists.length === 0 &&
		matchedTracks.length === 0
	) {
		return (
			<p className="rounded-2xl bg-surface px-4 py-6 text-center text-sm text-muted">
				No results for “{query.trim()}”.{" "}
				<button
					type="button"
					onClick={() => useLibraryStore.getState().setSearchQuery("")}
					className="font-medium text-accent hover:underline"
				>
					Clear search
				</button>
			</p>
		);
	}

	return (
		<section aria-label="Search results" className="flex flex-col gap-3">
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{matchedAlbums.length > 0 ? (
					<ResultGroup title="Albums">
						{matchedAlbums.map((a) => (
							<li key={a.id}>
								<button
									type="button"
									onClick={() => onOpenAlbum(a.id, "albums")}
									className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-elevated"
								>
									<TrackArtwork
										artworkId={a.artworkId}
										title={a.name}
										size={36}
									/>
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium">
											{a.name}
										</span>
										<span className="block truncate text-xs text-muted">
											{a.albumArtist}
										</span>
									</span>
								</button>
							</li>
						))}
					</ResultGroup>
				) : null}
				{matchedArtists.length > 0 ? (
					<ResultGroup title="Artists">
						{matchedArtists.map((a) => (
							<li key={a.name}>
								<button
									type="button"
									onClick={() => onSelectTab("artists")}
									className="block w-full truncate rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevated"
								>
									<span className="font-medium">{a.name}</span>{" "}
									<span className="text-xs text-muted">
										{a.trackIds.length} tracks
									</span>
								</button>
							</li>
						))}
					</ResultGroup>
				) : null}
				{genreNames.length > 0 ? (
					<ResultGroup title="Genres">
						{genreNames.map(([name, count]) => (
							<li key={name}>
								<button
									type="button"
									onClick={() => onSelectTab("genres")}
									className="block w-full truncate rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevated"
								>
									<span className="font-medium">{name}</span>{" "}
									<span className="text-xs text-muted">{count} tracks</span>
								</button>
							</li>
						))}
					</ResultGroup>
				) : null}
				{matchedPlaylists.length > 0 && onOpenPlaylist ? (
					<ResultGroup title="Playlists">
						{matchedPlaylists.map((p) => (
							<li key={p.id}>
								<button
									type="button"
									onClick={() => onOpenPlaylist(p.id)}
									className="block w-full truncate rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevated"
								>
									<span className="font-medium">{p.name}</span>{" "}
									<span className="text-xs text-muted">
										{p.trackIds.length} tracks
									</span>
								</button>
							</li>
						))}
					</ResultGroup>
				) : null}
			</div>
			<div className="flex items-center gap-3">
				<h3 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
					Tracks
				</h3>
				<span className="text-xs text-muted">{matchedTracks.length}</span>
				<span className="h-px flex-1 bg-line" aria-hidden="true" />
			</div>
			<TrackList tracks={matchedTracks} />
		</section>
	);
}

function ResultGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-2xl bg-surface p-2">
			<h3 className="px-2 pt-1 pb-1 text-[13px] font-semibold tracking-wide text-muted uppercase">
				{title}
			</h3>
			<ul className="flex flex-col">{children}</ul>
		</div>
	);
}

/** Overview dashboard: recent rows, favorites, albums, then all songs. */
function Overview({ onOpenTab }: { onOpenTab: (t: MusicTab) => void }) {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const stats = useLibraryStore((s) => s.stats);
	const favorites = useLibraryStore((s) => s.favorites);
	const sortKey = useLibraryStore((s) => s.sortKey);
	const sortDirection = useLibraryStore((s) => s.sortDirection);
	const tracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);
	const albums = useMemo(() => buildAlbums(tracks), [tracks]);
	const added = useMemo(
		() => [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 10),
		[tracks],
	);
	const played = useMemo(
		() =>
			Object.values(stats)
				.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
				.slice(0, 10)
				.map((s) => tracksById[s.trackId])
				.filter((t) => t != null),
		[stats, tracksById],
	);
	const favoriteTracks = useMemo(
		() =>
			favorites
				.map((id) => tracksById[id])
				.filter((t) => t != null)
				.slice(0, 10),
		[favorites, tracksById],
	);
	const allSongs = useMemo(
		() => sortTracks([...tracks], sortKey, sortDirection),
		[tracks, sortKey, sortDirection],
	);

	return (
		<div className="flex flex-col gap-6">
			{played.length > 0 ? (
				<RowSection
					title="Recently played"
					actionLabel="View all"
					onAction={() => onOpenTab("recent")}
				>
					<TrackRail tracks={played} />
				</RowSection>
			) : null}
			{added.length > 0 ? (
				<RowSection
					title="Recently added"
					actionLabel="View all"
					onAction={() => onOpenTab("recent")}
				>
					<TrackRail tracks={added} />
				</RowSection>
			) : null}
			{favoriteTracks.length > 0 ? (
				<RowSection
					title="Favorites"
					actionLabel="View all"
					onAction={() => onOpenTab("favorites")}
				>
					<TrackRail tracks={favoriteTracks} />
				</RowSection>
			) : null}
			{albums.length > 0 ? (
				<RowSection
					title="Albums"
					actionLabel="View all"
					onAction={() => onOpenTab("albums")}
				>
					<AlbumRail albums={albums.slice(0, 10)} />
				</RowSection>
			) : null}
			<section aria-labelledby="all-songs">
				<div className="mb-2 flex items-center gap-2">
					<h3 id="all-songs" className="text-base font-semibold tracking-tight">
						All songs
					</h3>
					<span className="flex-1" />
					<label className="flex items-center gap-1.5 text-[13px] text-muted">
						Sort
						<select
							value={sortKey}
							onChange={(e) =>
								useLibraryStore
									.getState()
									.setSort(e.target.value as TrackSortKey, sortDirection)
							}
							className="rounded-lg border border-line bg-surface px-2 py-1 text-[13px] text-ink"
						>
							{SORT_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
						<button
							type="button"
							aria-label={
								sortDirection === 1 ? "Sort descending" : "Sort ascending"
							}
							onClick={() =>
								useLibraryStore
									.getState()
									.setSort(sortKey, sortDirection === 1 ? -1 : 1)
							}
							className="rounded-lg border border-line px-2 py-1"
						>
							{sortDirection === 1 ? "↑" : "↓"}
						</button>
					</label>
				</div>
				<TrackList tracks={allSongs} />
			</section>
		</div>
	);
}

function RowSection({
	title,
	actionLabel,
	onAction,
	children,
}: {
	title: string;
	actionLabel: string;
	onAction: () => void;
	children: React.ReactNode;
}) {
	return (
		<section aria-label={title}>
			<div className="mb-2 flex items-baseline gap-2">
				<h3 className="text-base font-semibold tracking-tight">{title}</h3>
				<span className="flex-1" />
				<button
					type="button"
					onClick={onAction}
					className="text-[13px] font-medium text-muted transition-colors hover:text-ink"
				>
					{actionLabel} →
				</button>
			</div>
			{children}
		</section>
	);
}

/** Horizontal track rail: artwork + titles, plays on activate. */
function TrackRail({ tracks }: { tracks: Track[] }) {
	return (
		<ol className="flex gap-3 overflow-x-auto pb-1" aria-label="Tracks">
			{tracks.map((t) => (
				<li key={t.id} className="w-32 shrink-0">
					<button
						type="button"
						onClick={() => {
							const ids = tracks.map((x) => x.id);
							const index = ids.indexOf(t.id);
							usePlayerStore.getState().setQueue(ids, Math.max(0, index));
							void playTrack(t.id, true);
						}}
						aria-label={`Play ${t.title} by ${t.artist}`}
						className="group flex w-full flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors hover:bg-surface"
					>
						<TrackArtwork artworkId={t.artworkId} title={t.title} size={112} />
						<span className="min-w-0 px-0.5">
							<span className="block truncate text-[13px] font-medium">
								{t.title}
							</span>
							<span className="block truncate text-xs text-muted">
								{t.artist}
							</span>
						</span>
					</button>
				</li>
			))}
		</ol>
	);
}

function AlbumRail({ albums }: { albums: ReturnType<typeof buildAlbums> }) {
	return (
		<ol className="flex gap-3 overflow-x-auto pb-1" aria-label="Albums">
			{albums.map((a) => (
				<li key={a.id} className="w-32 shrink-0">
					<AlbumCard
						id={a.id}
						title={a.name}
						subtitle={a.albumArtist}
						art={a.artworkId}
						compact
					/>
				</li>
			))}
		</ol>
	);
}

/** Albums tab with polished cards + detail page. */
function AlbumsTab({
	openId,
	onOpenChange,
}: {
	openId: string | null;
	onOpenChange: (id: string | null) => void;
}) {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const tracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);
	const albums = useMemo(() => buildAlbums(tracks), [tracks]);

	if (openId) {
		const album = albums.find((a) => a.id === openId);
		if (album)
			return <AlbumDetail album={album} onBack={() => onOpenChange(null)} />;
	}

	if (albums.length === 0)
		return (
			<p className="px-2 py-8 text-center text-sm text-muted">
				Nothing here yet.
			</p>
		);
	return (
		<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
			{albums.map((a) => (
				<li key={a.id}>
					<AlbumCard
						id={a.id}
						title={a.name}
						subtitle={`${a.albumArtist}${a.year ? ` • ${a.year}` : ""} • ${a.trackIds.length} ${a.trackIds.length === 1 ? "track" : "tracks"}`}
						art={a.artworkId}
						onOpen={() => onOpenChange(a.id)}
					/>
				</li>
			))}
		</ul>
	);
}

function AlbumCard({
	id,
	title,
	subtitle,
	art,
	onOpen,
	compact = false,
}: {
	id: string;
	title: string;
	subtitle: string;
	art: string | null;
	onOpen?: () => void;
	compact?: boolean;
}) {
	return (
		<div className="group relative flex w-full flex-col gap-2 rounded-2xl p-2 text-left transition-colors hover:bg-surface">
			<button
				type="button"
				onClick={onOpen}
				aria-label={onOpen ? `Open album ${title}` : `Album ${title}`}
				className="flex w-full flex-col gap-2 text-left"
			>
				<span className="relative block">
					<TrackArtwork
						artworkId={art}
						title={title}
						size={compact ? 112 : 200}
					/>
					<span
						aria-hidden="true"
						className="absolute right-2 bottom-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink opacity-0 shadow-lg transition-all group-hover:opacity-100 group-focus-within:opacity-100"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z" />
						</svg>
					</span>
				</span>
				<span className="min-w-0 px-0.5">
					<span className="block truncate text-[14px] font-medium">
						{title}
					</span>
					<span className="block truncate text-xs text-muted">{subtitle}</span>
				</span>
			</button>
			<button
				type="button"
				onClick={() => playAlbum(id)}
				aria-label={`Play album ${title}`}
				className="absolute right-3 bottom-[4.5rem] flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink opacity-0 shadow-lg transition-all group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 md:bottom-auto md:top-[7.5rem]"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z" />
				</svg>
			</button>
		</div>
	);
}

function AlbumDetail({
	album,
	onBack,
}: {
	album: ReturnType<typeof buildAlbums>[number];
	onBack: () => void;
}) {
	const tracksById = useLibraryStore((s) => s.tracks);
	const tracks = album.trackIds
		.map((id) => tracksById[id])
		.filter((t) => t != null);
	const totalSecs = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
	return (
		<div className="flex flex-col gap-4">
			<button
				type="button"
				onClick={onBack}
				className="self-start rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
			>
				← Albums
			</button>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
				<TrackArtwork
					artworkId={album.artworkId}
					title={album.name}
					size={176}
				/>
				<div className="min-w-0">
					<p className="text-[13px] font-medium tracking-wide text-muted uppercase">
						Album
					</p>
					<h3 className="truncate text-2xl font-bold tracking-tight">
						{album.name}
					</h3>
					<p className="mt-1 text-[14px] text-muted">
						{album.albumArtist}
						{album.year ? ` • ${album.year}` : ""} • {tracks.length}{" "}
						{tracks.length === 1 ? "track" : "tracks"}
						{totalSecs > 0 ? ` • ${formatTime(totalSecs)}` : ""}
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => playAlbum(album.id)}
							className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02]"
						>
							Play
						</button>
						<button
							type="button"
							onClick={() => {
								if (album.trackIds.length === 0) return;
								const player = usePlayerStore.getState();
								player.setQueue(album.trackIds, 0);
								if (!player.shuffle) player.toggleShuffle();
								void playTrack(album.trackIds[0] ?? null, true);
							}}
							className="rounded-full border border-line px-5 py-2 text-sm font-medium transition-colors hover:bg-elevated"
						>
							Shuffle
						</button>
						<button
							type="button"
							onClick={() => usePlayerStore.getState().enqueue(album.trackIds)}
							aria-label={`Add album ${album.name} to queue`}
							className="rounded-full border border-line px-5 py-2 text-sm font-medium transition-colors hover:bg-elevated"
						>
							Add to queue
						</button>
					</div>
				</div>
			</div>
			<TrackList tracks={tracks} />
		</div>
	);
}

/** Artists tab with detail page (popular tracks, albums, recent). */
function ArtistsTab() {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const tracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);
	const albums = useMemo(() => buildAlbums(tracks), [tracks]);
	const artists = useMemo(() => buildArtists(tracks, albums), [tracks, albums]);
	const [openName, setOpenName] = useState<string | null>(null);

	if (openName) {
		const artist = artists.find((a) => a.name === openName);
		if (artist)
			return (
				<ArtistDetail
					name={artist.name}
					trackIds={artist.trackIds}
					albumIds={artist.albumIds}
					onBack={() => setOpenName(null)}
				/>
			);
	}

	if (artists.length === 0)
		return (
			<p className="px-2 py-8 text-center text-sm text-muted">
				Nothing here yet.
			</p>
		);
	return (
		<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
			{artists.map((a) => (
				<li key={a.name}>
					<button
						type="button"
						onClick={() => setOpenName(a.name)}
						aria-label={`Open artist ${a.name}`}
						className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-surface"
					>
						<span
							aria-hidden="true"
							className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-elevated text-lg font-bold text-accent"
						>
							{a.name.slice(0, 1).toUpperCase()}
						</span>
						<span className="min-w-0">
							<span className="block truncate text-[14px] font-medium">
								{a.name}
							</span>
							<span className="block truncate text-xs text-muted">
								{a.trackIds.length} tracks • {a.albumIds.length} albums
							</span>
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function ArtistDetail({
	name,
	trackIds,
	albumIds,
	onBack,
}: {
	name: string;
	trackIds: string[];
	albumIds: string[];
	onBack: () => void;
}) {
	const tracksById = useLibraryStore((s) => s.tracks);
	const stats = useLibraryStore((s) => s.stats);
	const order = useLibraryStore((s) => s.order);
	const tracks = useMemo(
		() => trackIds.map((id) => tracksById[id]).filter((t) => t != null),
		[trackIds, tracksById],
	);
	const popular = useMemo(
		() =>
			[...tracks]
				.sort(
					(a, b) =>
						(stats[b.id]?.playCount ?? 0) - (stats[a.id]?.playCount ?? 0),
				)
				.slice(0, 5),
		[tracks, stats],
	);
	const recentTracks = useMemo(
		() => [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5),
		[tracks],
	);
	const allTracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);
	const artistAlbums = useMemo(
		() => buildAlbums(allTracks).filter((a) => albumIds.includes(a.id)),
		[allTracks, albumIds],
	);

	return (
		<div className="flex flex-col gap-5">
			<button
				type="button"
				onClick={onBack}
				className="self-start rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
			>
				← Artists
			</button>
			<div className="flex items-center gap-4">
				<span
					aria-hidden="true"
					className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-elevated text-3xl font-bold text-accent"
				>
					{name.slice(0, 1).toUpperCase()}
				</span>
				<div>
					<p className="text-[13px] font-medium tracking-wide text-muted uppercase">
						Artist
					</p>
					<h3 className="text-2xl font-bold tracking-tight">{name}</h3>
					<p className="mt-0.5 text-sm text-muted">
						{tracks.length} {tracks.length === 1 ? "track" : "tracks"} •{" "}
						{artistAlbums.length}{" "}
						{artistAlbums.length === 1 ? "album" : "albums"}
					</p>
				</div>
			</div>
			{popular.length > 0 ? (
				<section aria-label="Popular tracks">
					<h4 className="mb-2 text-base font-semibold tracking-tight">
						Popular tracks
					</h4>
					<TrackList tracks={popular} />
				</section>
			) : null}
			{artistAlbums.length > 0 ? (
				<section aria-label="Albums">
					<h4 className="mb-2 text-base font-semibold tracking-tight">
						Albums
					</h4>
					<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
						{artistAlbums.map((a) => (
							<li key={a.id}>
								<AlbumCard
									id={a.id}
									title={a.name}
									subtitle={`${a.trackIds.length} ${a.trackIds.length === 1 ? "track" : "tracks"}${a.year ? ` • ${a.year}` : ""}`}
									art={a.artworkId}
									compact
								/>
							</li>
						))}
					</ul>
				</section>
			) : null}
			{recentTracks.length > 0 ? (
				<section aria-label="Recent tracks">
					<h4 className="mb-2 text-base font-semibold tracking-tight">
						Recent tracks
					</h4>
					<TrackList tracks={recentTracks} />
				</section>
			) : null}
		</div>
	);
}

/** Genres tab with genre detail (tracks, albums, artists). */
function GenresTab() {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const tracks = useMemo(
		() => order.map((id) => tracksById[id]).filter((t) => t != null),
		[order, tracksById],
	);
	const genres = useMemo(() => {
		const counts = new Map<string, number>();
		for (const t of tracks)
			for (const g of t.genre) counts.set(g, (counts.get(g) ?? 0) + 1);
		return [...counts.entries()]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	}, [tracks]);
	const [openGenre, setOpenGenre] = useState<string | null>(null);

	if (openGenre) {
		return <GenreDetail genre={openGenre} onBack={() => setOpenGenre(null)} />;
	}

	if (genres.length === 0) {
		return (
			<EmptyState
				title="No genres yet"
				body="Genres appear here once your tagged files are imported."
			/>
		);
	}
	return (
		<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
			{genres.map((genre) => (
				<li key={genre.name}>
					<button
						type="button"
						onClick={() => setOpenGenre(genre.name)}
						aria-label={`Open genre ${genre.name}`}
						className="w-full rounded-2xl bg-surface p-4 text-left transition-colors hover:bg-elevated"
					>
						<span className="block truncate text-[15px] font-semibold">
							{genre.name}
						</span>
						<span className="mt-0.5 block text-[13px] text-muted">
							{genre.count} tracks
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function GenreDetail({ genre, onBack }: { genre: string; onBack: () => void }) {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const tracks = useMemo(
		() =>
			order
				.map((id) => tracksById[id])
				.filter((t): t is Track => t != null && t.genre.includes(genre)),
		[order, tracksById, genre],
	);
	const albums = useMemo(() => buildAlbums(tracks), [tracks]);
	const artists = useMemo(() => {
		const names = new Map<string, number>();
		for (const t of tracks) names.set(t.artist, (names.get(t.artist) ?? 0) + 1);
		return [...names.entries()]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	}, [tracks]);

	return (
		<div className="flex flex-col gap-5">
			<button
				type="button"
				onClick={onBack}
				className="self-start rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
			>
				← Genres
			</button>
			<div>
				<p className="text-[13px] font-medium tracking-wide text-muted uppercase">
					Genre
				</p>
				<h3 className="text-2xl font-bold tracking-tight">{genre}</h3>
				<p className="mt-0.5 text-sm text-muted">
					{tracks.length} {tracks.length === 1 ? "track" : "tracks"} •{" "}
					{albums.length} {albums.length === 1 ? "album" : "albums"} •{" "}
					{artists.length} {artists.length === 1 ? "artist" : "artists"}
				</p>
			</div>
			<section aria-label="Tracks">
				<h4 className="mb-2 text-base font-semibold tracking-tight">Tracks</h4>
				<TrackList tracks={tracks} />
			</section>
			{albums.length > 0 ? (
				<section aria-label="Albums">
					<h4 className="mb-2 text-base font-semibold tracking-tight">
						Albums
					</h4>
					<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
						{albums.map((a) => (
							<li key={a.id}>
								<AlbumCard
									id={a.id}
									title={a.name}
									subtitle={a.albumArtist}
									art={a.artworkId}
									compact
								/>
							</li>
						))}
					</ul>
				</section>
			) : null}
			{artists.length > 0 ? (
				<section aria-label="Artists">
					<h4 className="mb-2 text-base font-semibold tracking-tight">
						Artists
					</h4>
					<ul className="flex flex-wrap gap-2">
						{artists.map((a) => (
							<li
								key={a.name}
								className="rounded-full bg-surface px-3.5 py-1.5 text-sm"
							>
								<span className="font-medium">{a.name}</span>{" "}
								<span className="text-xs text-muted">{a.count}</span>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}

export function playAlbum(albumId: string): void {
	const library = useLibraryStore.getState();
	const tracks = library.order
		.map((id) => library.tracks[id])
		.filter((t) => t != null);
	const album = buildAlbums(tracks).find((a) => a.id === albumId);
	if (!album || album.trackIds.length === 0) return;
	usePlayerStore.getState().setQueue(album.trackIds, 0);
	void playTrack(album.trackIds[0] ?? null, true);
}
