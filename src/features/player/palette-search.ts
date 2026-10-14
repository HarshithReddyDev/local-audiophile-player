/**
 * Lightweight global search over data the app already holds in memory.
 * No new indexing, no binary search, no uploads: tracks, derived
 * album/artist names, playlists, user presets, catalog entries (only
 * when already loaded — the palette never forces the bulk catalog to
 * load), static routes, and static actions.
 */

export type PaletteKind =
	| "track"
	| "album"
	| "artist"
	| "playlist"
	| "device"
	| "preset"
	| "route"
	| "action";

export interface PaletteEntry {
	kind: PaletteKind;
	/** Stable id within its kind (track id, route id, action id…). */
	id: string;
	title: string;
	subtitle: string;
}

export interface PaletteCorpus {
	tracks: { id: string; title: string; artist: string; album: string }[];
	playlists: { id: string; name: string; trackIds: string[] }[];
	presets: { id: string; name: string; detail: string }[];
	devices: { id: string; title: string; subtitle: string }[];
	routes: { id: string; title: string; subtitle: string }[];
	actions: { id: string; title: string; subtitle: string }[];
}

const KIND_ORDER: PaletteKind[] = [
	"action",
	"route",
	"track",
	"album",
	"artist",
	"playlist",
	"device",
	"preset",
];

function score(haystack: string, needle: string): number {
	if (needle === "") return 0;
	const hay = haystack.toLowerCase();
	const query = needle.toLowerCase();
	if (hay === query) return 100;
	if (hay.startsWith(query)) return 75;
	const words = hay.split(/[^a-z0-9]+/);
	if (words.some((w) => w.startsWith(query))) return 50;
	if (hay.includes(query)) return 25;
	// Ordered-subsequence fallback for abbreviations ("hp" → "headphones").
	let scoreValue = 0;
	let pos = -1;
	for (const ch of query) {
		const next = hay.indexOf(ch, pos + 1);
		if (next === -1) return 0;
		if (next === pos + 1) scoreValue += 2;
		else scoreValue += 1;
		pos = next;
	}
	return Math.min(20, scoreValue);
}

interface Scored extends PaletteEntry {
	rank: number;
	kindRank: number;
}

/**
 * Search the corpus. Empty query returns top routes/actions (a useful
 * command launcher); otherwise the best matches grouped by kind.
 * Deterministic: ties break by kind order, then title.
 */
export function searchPalette(
	query: string,
	corpus: PaletteCorpus,
	limit = 30,
): PaletteEntry[] {
	const q = query.trim().toLowerCase();
	const scored: Scored[] = [];
	const push = (
		kind: PaletteKind,
		id: string,
		title: string,
		subtitle: string,
	) => {
		const rank =
			q === "" ? 0 : Math.max(score(title, q), score(subtitle, q) - 1);
		if (q !== "" && rank <= 0) return;
		scored.push({
			kind,
			id,
			title,
			subtitle,
			rank,
			kindRank: KIND_ORDER.indexOf(kind),
		});
	};

	for (const a of corpus.actions) push("action", a.id, a.title, a.subtitle);
	for (const r of corpus.routes) push("route", r.id, r.title, r.subtitle);
	if (q !== "") {
		for (const t of corpus.tracks) {
			push("track", t.id, t.title, `${t.artist} • ${t.album}`);
		}
		const albums = new Map<string, string>();
		const artists = new Map<string, string>();
		for (const t of corpus.tracks) {
			if (t.album && !albums.has(t.album)) albums.set(t.album, t.artist);
			if (t.artist && !artists.has(t.artist)) artists.set(t.artist, "Artist");
		}
		for (const [name, artist] of albums) push("album", name, name, artist);
		for (const [name] of artists) push("artist", name, name, "Artist");
		for (const p of corpus.playlists) {
			push("playlist", p.id, p.name, `${p.trackIds.length} tracks`);
		}
		for (const d of corpus.devices) push("device", d.id, d.title, d.subtitle);
		for (const p of corpus.presets) push("preset", p.id, p.name, p.detail);
	}

	scored.sort(
		(a, b) =>
			b.rank - a.rank ||
			a.kindRank - b.kindRank ||
			a.title.localeCompare(b.title),
	);
	return scored
		.slice(0, Math.max(1, limit))
		.map(({ rank: _rank, kindRank: _kindRank, ...entry }) => entry);
}
