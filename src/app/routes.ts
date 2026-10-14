/** Top-level views. State-driven (no router library) so every view works
 * identically under "/" and GitHub Pages subpaths — there are no URLs to
 * rewrite, only view state. */
export type Route =
	| "tracks"
	| "albums"
	| "artists"
	| "genres"
	| "recent"
	| "favorites"
	| "playlists"
	| "eq"
	| "dsp"
	| "iem"
	| "devices"
	| "guides"
	| "settings";

export const ROUTES: { id: Route; label: string }[] = [
	{ id: "tracks", label: "All Music" },
	{ id: "albums", label: "Albums" },
	{ id: "artists", label: "Artists" },
	{ id: "genres", label: "Genres" },
	{ id: "recent", label: "Recent" },
	{ id: "favorites", label: "Favorites" },
	{ id: "playlists", label: "Playlists" },
	{ id: "eq", label: "EQ" },
	{ id: "dsp", label: "DSP" },
	{ id: "iem", label: "IEM" },
	{ id: "devices", label: "Devices" },
	{ id: "guides", label: "Guides" },
	{ id: "settings", label: "Settings" },
];

/**
 * New information architecture: the sidebar shows only major destinations.
 * Music subsections (All/Albums/Artists/Genres/Recently played/Favorites)
 * live as tabs inside the unified Music workspace; EQ and DSP live as tabs
 * inside the combined "EQ & DSP" destination. Route ids are unchanged so
 * playback, queue, DSP, persistence, and deep behavior are untouched.
 */
export interface NavItem {
	/** Route navigated to when the destination is opened. */
	id: Route;
	/** Consumer-facing label (may differ from the legacy ROUTES label). */
	label: string;
	/** Routes that keep this destination highlighted while active. */
	activeRoutes: Route[];
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

/** Every legacy music-library route renders inside the Music workspace. */
export const MUSIC_ROUTES: Route[] = [
	"tracks",
	"albums",
	"artists",
	"genres",
	"recent",
	"favorites",
];

function item(id: Route, label: string, activeRoutes?: Route[]): NavItem {
	return { id, label, activeRoutes: activeRoutes ?? [id] };
}

export const NAV_GROUPS: NavGroup[] = [
	group("Main", [
		item("tracks", "Music", MUSIC_ROUTES),
		item("playlists", "Playlists"),
	]),
	group("Audio", [
		item("devices", "Devices"),
		item("eq", "EQ & DSP", ["eq", "dsp"]),
		item("iem", "My Devices"),
	]),
	group("System", [item("guides", "Guides"), item("settings", "Settings")]),
];

function group(label: string, items: NavItem[]): NavGroup {
	return { label, items };
}

/**
 * Mobile bottom navigation: five compact destinations. Guides and My Devices
 * link onward from Settings and contextual "Learn" links.
 */
export const MOBILE_NAV: NavItem[] = [
	item("tracks", "Music", MUSIC_ROUTES),
	item("playlists", "Playlists"),
	item("devices", "Devices"),
	item("eq", "EQ", ["eq", "dsp"]),
	item("settings", "Settings", ["settings", "iem", "guides"]),
];
