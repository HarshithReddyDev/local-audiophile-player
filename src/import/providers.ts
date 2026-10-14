/**
 * Provider architecture for playlist import.
 *
 * Only the file provider ships as a working integration: it is fully
 * local (no network, no accounts). Network providers are described here
 * as capability records so the UI can explain honestly what works, what
 * does not, and why — plus a technical interface future providers can
 * implement without touching the playlist domain model.
 *
 * Spotify/YouTube verdict (see docs/playlist-import.md §providers): no
 * live OAuth integration ships. Verifying current official authorization
 * requirements was not possible from this environment, and the brief
 * forbids inventing an insecure workaround: browser-only OAuth would need
 * either a shipped client secret (never acceptable) or per-user developer
 * app registration plus a token-handling story this local-first app does
 * not have. Tokens are therefore never requested, never persisted.
 */

import type { ExternalPlaylist, ImportProviderId } from "./model";

export type ProviderStatus = "available" | "unavailable";

export interface ProviderCapability {
	id: ImportProviderId;
	label: string;
	status: ProviderStatus;
	/** What the user gets, in plain words. */
	whatItImports: string;
	/** OAuth scopes or file access required. Empty when none. */
	permissions: string[];
	/** What explicitly does NOT leave the browser. */
	privacyNote: string;
	/** Why unavailable, when it is. Null when available. */
	limitation: string | null;
}

export const PROVIDERS: ProviderCapability[] = [
	{
		id: "file",
		label: "Import file",
		status: "available",
		whatItImports:
			"Playlist metadata from .m3u/.m3u8, .csv, or .json files on your device. Audio is never touched.",
		permissions: ["Read the file you pick (file picker only)"],
		privacyNote:
			"Nothing leaves the browser. Matching runs locally against your library.",
		limitation: null,
	},
	{
		id: "spotify",
		label: "Spotify",
		status: "unavailable",
		whatItImports:
			"Would import playlist names, track metadata, and links via the official Spotify Web API (playlist-read-private minimum).",
		permissions: ["Not requested — integration not shipped"],
		privacyNote:
			"Spotify audio would never be downloaded or played here; only metadata would be read, and only with your explicit login.",
		limitation:
			"Not connected: shipping browser-only Spotify OAuth would require a client secret in the frontend or per-user developer-app setup, neither of which this local-first app can do safely without a backend. Export the playlist from Spotify (e.g. via a playlist-export tool) and use Import file instead.",
	},
	{
		id: "youtube",
		label: "YouTube",
		status: "unavailable",
		whatItImports:
			"Would import public/authenticated playlist metadata via the official YouTube Data API.",
		permissions: ["Not requested — integration not shipped"],
		privacyNote:
			"YouTube audio/video would never be downloaded; only playlist metadata would be read.",
		limitation:
			"Not connected: needs Google OAuth client setup plus API quota, which a static local-first page cannot provision securely on its own. Export or copy the playlist into a file and use Import file instead.",
	},
	{
		id: "youtube-music",
		label: "YouTube Music",
		status: "unavailable",
		whatItImports:
			"Would import YouTube Music library/playlist metadata where officially supported.",
		permissions: ["Not requested — integration not shipped"],
		privacyNote: "Audio would never be downloaded.",
		limitation:
			"There is no dedicated public YouTube Music playlist API to integrate against, and undocumented endpoints or scraping are explicitly out of scope. Use Import file instead.",
	},
	{
		id: "apple-music",
		label: "Apple Music",
		status: "unavailable",
		whatItImports: "Playlist metadata via MusicKit where supported.",
		permissions: ["Not requested — integration not shipped"],
		privacyNote: "Audio would never be downloaded.",
		limitation: "Not implemented yet. Use Import file instead.",
	},
	{
		id: "deezer",
		label: "Deezer",
		status: "unavailable",
		whatItImports: "Playlist metadata via the Deezer API where supported.",
		permissions: ["Not requested — integration not shipped"],
		privacyNote: "Audio would never be downloaded.",
		limitation: "Not implemented yet. Use Import file instead.",
	},
	{
		id: "tidal",
		label: "Tidal",
		status: "unavailable",
		whatItImports: "Playlist metadata via the Tidal API where supported.",
		permissions: ["Not requested — integration not shipped"],
		privacyNote: "Audio would never be downloaded.",
		limitation: "Not implemented yet. Use Import file instead.",
	},
	{
		id: "soundcloud",
		label: "SoundCloud",
		status: "unavailable",
		whatItImports: "Playlist metadata via the SoundCloud API where supported.",
		permissions: ["Not requested — integration not shipped"],
		privacyNote: "Audio would never be downloaded.",
		limitation: "Not implemented yet. Use Import file instead.",
	},
];

/**
 * Technical contract for a future live provider. Transport is injected
 * (fetch-like) so implementations stay testable with fixtures and the
 * core never depends on network code. Nothing implements this yet.
 */
export interface PlaylistProvider {
	readonly id: ImportProviderId;
	listPlaylists(): Promise<{ id: string; name: string; trackCount: number }[]>;
	fetchPlaylist(id: string): Promise<ExternalPlaylist>;
}
