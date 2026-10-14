import { create } from "zustand";
import type { TrackSortKey } from "../library/grouping";
import type {
	LibrarySource,
	Playlist,
	PlayStats,
	SourceStatus,
	Track,
} from "../types/library";
import { newId } from "../types/library";

export interface NewTrackInput {
	track: Track;
	file: File;
}

function fileKey(file: File): string {
	return `${file.name}|${file.size}|${file.lastModified}`;
}

export interface LibraryHydration {
	tracks: Track[];
	playlists: Playlist[];
	favoriteIds: string[];
	ratings: Record<string, number>;
	stats: Record<string, PlayStats>;
	sources: LibrarySource[];
}

interface LibraryState {
	tracks: Record<string, Track>;
	/** Insertion order of track ids. */
	order: string[];
	/** Local file bytes by track id. In-memory only, never persisted. */
	files: Map<string, File>;
	loading: boolean;
	loadingLabel: string | null;
	searchQuery: string;
	sortKey: TrackSortKey;
	sortDirection: 1 | -1;
	selectedTrackId: string | null;
	playlists: Record<string, Playlist>;
	/** Favorite track ids, newest first. */
	favorites: string[];
	ratings: Record<string, number>;
	stats: Record<string, PlayStats>;
	sources: Record<string, LibrarySource>;
	sourceStatuses: Record<string, SourceStatus>;
	/** True while the startup restore is running. Player stays usable. */
	restoring: boolean;

	/** Adds tracks, skipping files already imported. Returns ids actually added. */
	addTracks: (inputs: NewTrackInput[]) => string[];
	removeTrack: (id: string) => void;
	clearLibrary: () => void;
	getFile: (id: string) => File | undefined;
	registerFile: (id: string, file: File) => void;
	setLoading: (loading: boolean, label?: string | null) => void;
	setSearchQuery: (query: string) => void;
	setSort: (key: TrackSortKey, direction: 1 | -1) => void;
	selectTrack: (id: string | null) => void;
	createPlaylist: (name: string, trackIds: string[]) => string;
	addToPlaylist: (playlistId: string, trackIds: string[]) => void;
	removeFromPlaylist: (playlistId: string, trackId: string) => void;
	renamePlaylist: (playlistId: string, name: string) => void;
	deletePlaylist: (playlistId: string) => void;
	/** Star/unstar a playlist (additive flag, persisted with the record). */
	togglePlaylistFavorite: (playlistId: string) => void;
	/** Attach import provenance to an existing playlist (additive). */
	stampPlaylistImport: (
		playlistId: string,
		importedFrom: NonNullable<Playlist["importedFrom"]>,
	) => void;
	/** Replace a playlist's track list wholesale (import update). */
	replacePlaylistTracks: (playlistId: string, trackIds: string[]) => void;
	/** Bulk replace from the persistence layer (restore path). */
	hydrate: (data: LibraryHydration) => void;
	/** Merge records by id; appends unknown ids to the order. */
	upsertTracks: (tracks: Track[]) => void;
	patchTrack: (id: string, patch: Partial<Track>) => void;
	setFavorites: (ids: string[]) => void;
	setRatings: (ratings: Record<string, number>) => void;
	setStats: (stats: Record<string, PlayStats>) => void;
	setSources: (sources: LibrarySource[]) => void;
	setSourceStatus: (id: string, status: SourceStatus) => void;
	setRestoring: (restoring: boolean) => void;
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
	tracks: {},
	order: [],
	files: new Map(),
	loading: false,
	loadingLabel: null,
	searchQuery: "",
	sortKey: "title",
	sortDirection: 1,
	selectedTrackId: null,
	playlists: {},
	favorites: [],
	ratings: {},
	stats: {},
	sources: {},
	sourceStatuses: {},
	restoring: false,

	addTracks: (inputs) => {
		const { tracks, order, files } = get();
		const known = new Set([...files.values()].map(fileKey));
		const added: string[] = [];
		const nextTracks = { ...tracks };
		const nextOrder = [...order];
		const nextFiles = new Map(files);
		for (const { track, file } of inputs) {
			if (known.has(fileKey(file))) continue;
			known.add(fileKey(file));
			nextTracks[track.id] = track;
			nextOrder.push(track.id);
			nextFiles.set(track.id, file);
			added.push(track.id);
		}
		set({ tracks: nextTracks, order: nextOrder, files: nextFiles });
		return added;
	},

	removeTrack: (id) => {
		const { tracks, order, files, playlists, favorites, ratings, stats } =
			get();
		if (!tracks[id]) return;
		const nextTracks = { ...tracks };
		delete nextTracks[id];
		const nextFiles = new Map(files);
		nextFiles.delete(id);
		const nextPlaylists: Record<string, Playlist> = {};
		for (const [pid, playlist] of Object.entries(playlists)) {
			nextPlaylists[pid] = {
				...playlist,
				trackIds: playlist.trackIds.filter((t) => t !== id),
			};
		}
		const nextRatings = { ...ratings };
		delete nextRatings[id];
		const nextStats = { ...stats };
		delete nextStats[id];
		set({
			tracks: nextTracks,
			order: order.filter((t) => t !== id),
			files: nextFiles,
			playlists: nextPlaylists,
			favorites: favorites.filter((t) => t !== id),
			ratings: nextRatings,
			stats: nextStats,
			selectedTrackId:
				get().selectedTrackId === id ? null : get().selectedTrackId,
		});
	},

	clearLibrary: () => {
		set({
			tracks: {},
			order: [],
			files: new Map(),
			selectedTrackId: null,
			playlists: {},
			favorites: [],
			ratings: {},
			stats: {},
		});
	},

	getFile: (id) => get().files.get(id),
	registerFile: (id, file) =>
		set((s) => ({ files: new Map(s.files).set(id, file) })),
	setLoading: (loading, label = null) => set({ loading, loadingLabel: label }),
	setSearchQuery: (query) => set({ searchQuery: query }),
	setSort: (key, direction) => set({ sortKey: key, sortDirection: direction }),
	selectTrack: (id) => set({ selectedTrackId: id }),

	createPlaylist: (name, trackIds) => {
		const id = newId("playlist");
		const now = Date.now();
		set((s) => ({
			playlists: {
				...s.playlists,
				[id]: {
					id,
					name: name.trim() || "Untitled playlist",
					trackIds: [...trackIds],
					createdAt: now,
					updatedAt: now,
				},
			},
		}));
		return id;
	},

	addToPlaylist: (playlistId, trackIds) =>
		set((s) => {
			const playlist = s.playlists[playlistId];
			if (!playlist || trackIds.length === 0) return s;
			const known = new Set(playlist.trackIds);
			const merged = [...playlist.trackIds];
			for (const id of trackIds) {
				if (!known.has(id) && s.tracks[id]) {
					known.add(id);
					merged.push(id);
				}
			}
			if (merged.length === playlist.trackIds.length) return s;
			return {
				playlists: {
					...s.playlists,
					[playlistId]: {
						...playlist,
						trackIds: merged,
						updatedAt: Date.now(),
					},
				},
			};
		}),

	removeFromPlaylist: (playlistId, trackId) =>
		set((s) => {
			const playlist = s.playlists[playlistId];
			if (!playlist) return s;
			const trackIds = playlist.trackIds.filter((t) => t !== trackId);
			if (trackIds.length === playlist.trackIds.length) return s;
			return {
				playlists: {
					...s.playlists,
					[playlistId]: { ...playlist, trackIds, updatedAt: Date.now() },
				},
			};
		}),

	renamePlaylist: (playlistId, name) =>
		set((s) => {
			const playlist = s.playlists[playlistId];
			if (!playlist) return s;
			const trimmed = name.trim();
			if (trimmed === "" || trimmed === playlist.name) return s;
			return {
				playlists: {
					...s.playlists,
					[playlistId]: { ...playlist, name: trimmed, updatedAt: Date.now() },
				},
			};
		}),

	deletePlaylist: (playlistId) =>
		set((s) => {
			if (!s.playlists[playlistId]) return s;
			const playlists = { ...s.playlists };
			delete playlists[playlistId];
			return { playlists };
		}),

	togglePlaylistFavorite: (playlistId) =>
		set((s) => {
			const playlist = s.playlists[playlistId];
			if (!playlist) return s;
			return {
				playlists: {
					...s.playlists,
					[playlistId]: {
						...playlist,
						favorite: !(playlist.favorite ?? false),
						updatedAt: Date.now(),
					},
				},
			};
		}),

	stampPlaylistImport: (playlistId, importedFrom) =>
		set((s) => {
			const playlist = s.playlists[playlistId];
			if (!playlist) return s;
			return {
				playlists: {
					...s.playlists,
					[playlistId]: { ...playlist, importedFrom, updatedAt: Date.now() },
				},
			};
		}),

	replacePlaylistTracks: (playlistId, trackIds) =>
		set((s) => {
			const playlist = s.playlists[playlistId];
			if (!playlist) return s;
			const valid = trackIds.filter((id) => s.tracks[id]);
			return {
				playlists: {
					...s.playlists,
					[playlistId]: { ...playlist, trackIds: valid, updatedAt: Date.now() },
				},
			};
		}),

	hydrate: (data) => {
		const tracks: Record<string, Track> = {};
		for (const track of data.tracks) tracks[track.id] = track;
		// Heal dangling references on load: a playlist/favorite/rating/stat
		// pointing at a track that no longer exists is dropped instead of
		// carried as ghost state (DB cascade normally prevents this; this
		// covers corrupt or hand-edited stores).
		const playlists: Record<string, Playlist> = {};
		for (const playlist of data.playlists) {
			const trackIds = playlist.trackIds.filter((id) => tracks[id]);
			playlists[playlist.id] = { ...playlist, trackIds };
		}
		const sources: Record<string, LibrarySource> = {};
		for (const source of data.sources) sources[source.id] = source;
		const ratings: Record<string, number> = {};
		for (const [id, value] of Object.entries(data.ratings)) {
			if (tracks[id]) ratings[id] = value;
		}
		const stats: Record<string, PlayStats> = {};
		for (const [id, value] of Object.entries(data.stats)) {
			if (tracks[id]) stats[id] = value;
		}
		set({
			tracks,
			order: data.tracks.map((t) => t.id),
			playlists,
			favorites: data.favoriteIds.filter((id) => tracks[id]),
			ratings,
			stats,
			sources,
			selectedTrackId: null,
		});
	},

	upsertTracks: (tracks) =>
		set((s) => {
			const nextTracks = { ...s.tracks };
			const nextOrder = [...s.order];
			const known = new Set(nextOrder);
			for (const track of tracks) {
				nextTracks[track.id] = track;
				if (!known.has(track.id)) {
					known.add(track.id);
					nextOrder.push(track.id);
				}
			}
			return { tracks: nextTracks, order: nextOrder };
		}),

	patchTrack: (id, patch) =>
		set((s) => {
			const track = s.tracks[id];
			if (!track) return s;
			return { tracks: { ...s.tracks, [id]: { ...track, ...patch } } };
		}),

	setFavorites: (ids) => set({ favorites: [...ids] }),
	setRatings: (ratings) => set({ ratings: { ...ratings } }),
	setStats: (stats) => set({ stats: { ...stats } }),
	setSources: (sources) => {
		const next: Record<string, LibrarySource> = {};
		for (const source of sources) next[source.id] = source;
		set({ sources: next });
	},
	setSourceStatus: (id, status) =>
		set((s) => ({ sourceStatuses: { ...s.sourceStatuses, [id]: status } })),
	setRestoring: (restoring) => set({ restoring }),
}));
