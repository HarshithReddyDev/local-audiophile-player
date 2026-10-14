import type { Album, Artist, Track } from "../types/library";

export type TrackSortKey =
	| "title"
	| "artist"
	| "album"
	| "year"
	| "duration"
	| "added"
	| "source"
	| "format";

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function compareText(a: string, b: string): number {
	return collator.compare(a, b);
}

function albumKey(t: Track): string {
	return `${t.albumArtist}\u001f${t.album}`.toLowerCase();
}

/** Group tracks into albums, sorted by year then name. Pure and memoized by callers. */
export function buildAlbums(tracks: Track[]): Album[] {
	const byKey = new Map<string, Track[]>();
	for (const t of tracks) {
		const key = albumKey(t);
		const list = byKey.get(key);
		if (list) list.push(t);
		else byKey.set(key, [t]);
	}
	const albums: Album[] = [];
	for (const list of byKey.values()) {
		const first = list[0];
		if (!first) continue;
		const sorted = [...list].sort(
			(a, b) =>
				(a.discNumber ?? 0) - (b.discNumber ?? 0) ||
				(a.trackNumber ?? Number.MAX_SAFE_INTEGER) -
					(b.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
				compareText(a.title, b.title),
		);
		const years = sorted
			.map((t) => t.year)
			.filter((y): y is number => y != null);
		albums.push({
			id: `album-${first.albumArtist}\u001f${first.album}`,
			name: first.album,
			albumArtist: first.albumArtist,
			year: years.length > 0 ? Math.min(...years) : null,
			trackIds: sorted.map((t) => t.id),
			artworkId: sorted.find((t) => t.artworkId)?.artworkId ?? null,
		});
	}
	return albums.sort(
		(a, b) =>
			(a.year ?? Number.MAX_SAFE_INTEGER) -
				(b.year ?? Number.MAX_SAFE_INTEGER) || compareText(a.name, b.name),
	);
}

/** Group tracks into artists, sorted by name. */
export function buildArtists(tracks: Track[], albums: Album[]): Artist[] {
	const trackIds = new Map<string, Set<string>>();
	const albumIds = new Map<string, Set<string>>();
	const add = (map: Map<string, Set<string>>, key: string, value: string) => {
		const set = map.get(key);
		if (set) set.add(value);
		else map.set(key, new Set([value]));
	};
	for (const t of tracks) add(trackIds, t.artist, t.id);
	for (const a of albums) add(albumIds, a.albumArtist, a.id);
	const names = new Set([...trackIds.keys(), ...albumIds.keys()]);
	return [...names]
		.map((name) => ({
			id: `artist-${name}`,
			name,
			trackIds: [...(trackIds.get(name) ?? [])],
			albumIds: [...(albumIds.get(name) ?? [])],
		}))
		.sort((a, b) => compareText(a.name, b.name));
}

/** Case-insensitive substring match across title/artist/album/genre. */
export function filterTracks(tracks: Track[], query: string): Track[] {
	const q = query.trim().toLowerCase();
	if (q === "") return tracks;
	return tracks.filter((t) =>
		[t.title, t.artist, t.album, t.albumArtist, ...t.genre].some((field) =>
			field.toLowerCase().includes(q),
		),
	);
}

function formatKey(t: Track): string {
	const name = t.fileName.toLowerCase();
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? (name.slice(dot + 1) ?? "") : "";
}

function sortValue(t: Track, key: TrackSortKey): string | number {
	switch (key) {
		case "title":
			return t.title;
		case "artist":
			return t.artist;
		case "album":
			return t.album;
		case "year":
			return t.year ?? Number.MAX_SAFE_INTEGER;
		case "duration":
			return t.duration ?? Number.MAX_SAFE_INTEGER;
		case "added":
			return t.addedAt;
		case "source":
			return t.remote?.provider ?? (t.sourceId ? "local" : "loose");
		case "format":
			return formatKey(t);
	}
}

export function sortTracks(
	tracks: Track[],
	key: TrackSortKey,
	direction: 1 | -1 = 1,
): Track[] {
	return [...tracks].sort((a, b) => {
		const va = sortValue(a, key);
		const vb = sortValue(b, key);
		const cmp =
			typeof va === "number" && typeof vb === "number"
				? va - vb
				: compareText(String(va), String(vb));
		return cmp * direction || compareText(a.title, b.title);
	});
}
