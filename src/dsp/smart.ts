/**
 * Smart playlists: deterministic query rules over existing library
 * metadata. Nothing is stored — a smart list is derived on demand, so it
 * can never go stale. Rules only use fields the library actually keeps;
 * anything requiring unavailable data (e.g. measured bit depth) is not
 * a rule.
 */

import type { PlayStats, Track } from "../types/library";

export type SmartRuleId =
	| "recently-played"
	| "most-played"
	| "never-played"
	| "favorites"
	| "five-star"
	| "recently-added"
	| "long-tracks"
	| "flac"
	| "lossless";

export interface SmartRule {
	id: SmartRuleId;
	label: string;
	description: string;
}

export const SMART_RULES: SmartRule[] = [
	{
		id: "recently-played",
		label: "Recently played",
		description: "Tracks played most recently first.",
	},
	{
		id: "most-played",
		label: "Most played",
		description: "Highest play count first.",
	},
	{
		id: "never-played",
		label: "Never played",
		description: "In library order, never started.",
	},
	{ id: "favorites", label: "Favorites", description: "Favorited tracks." },
	{
		id: "five-star",
		label: "5-star",
		description: "Tracks rated 5 stars.",
	},
	{
		id: "recently-added",
		label: "Recently added",
		description: "Newest imports first.",
	},
	{
		id: "long-tracks",
		label: "Long tracks",
		description: "Over 8 minutes, longest first.",
	},
	{ id: "flac", label: "FLAC", description: "FLAC files, A→Z." },
	{
		id: "lossless",
		label: "Lossless",
		description: "FLAC, WAV, AIFF, or ALAC (M4A), A→Z.",
	},
];

export interface SmartLibrary {
	tracks: Record<string, Track>;
	order: string[];
	favorites: string[];
	ratings: Record<string, number>;
	stats: Record<string, PlayStats>;
}

function isFlac(track: Track): boolean {
	return (
		track.fileName.toLowerCase().endsWith(".flac") ||
		track.fileType.toLowerCase().includes("flac")
	);
}

function isLossless(track: Track): boolean {
	const name = track.fileName.toLowerCase();
	const type = track.fileType.toLowerCase();
	if (isFlac(track)) return true;
	if (name.endsWith(".wav") || name.endsWith(".aiff") || name.endsWith(".aif"))
		return true;
	// M4A/MP4 is a container: only ALAC content counts (best-effort tag).
	if (name.endsWith(".m4a") || name.endsWith(".mp4")) {
		return type.includes("alac") || type.includes("x-m4a");
	}
	return false;
}

/** Track ids for a rule, in display order. Pure and deterministic. */
export function smartTrackIds(
	rule: SmartRuleId,
	library: SmartLibrary,
): string[] {
	const live = library.order.filter((id) => library.tracks[id] !== undefined);
	const byId = (id: string): Track | undefined => library.tracks[id];
	switch (rule) {
		case "recently-played":
			return live
				.filter((id) => (library.stats[id]?.playCount ?? 0) > 0)
				.sort(
					(a, b) =>
						(library.stats[b]?.lastPlayedAt ?? 0) -
						(library.stats[a]?.lastPlayedAt ?? 0),
				);
		case "most-played":
			return live
				.filter((id) => (library.stats[id]?.playCount ?? 0) > 0)
				.sort(
					(a, b) =>
						(library.stats[b]?.playCount ?? 0) -
							(library.stats[a]?.playCount ?? 0) ||
						(library.stats[b]?.lastPlayedAt ?? 0) -
							(library.stats[a]?.lastPlayedAt ?? 0),
				);
		case "never-played":
			return live.filter((id) => (library.stats[id]?.playCount ?? 0) === 0);
		case "favorites":
			return library.favorites.filter((id) => byId(id) !== undefined);
		case "five-star":
			return live.filter((id) => library.ratings[id] === 5);
		case "recently-added":
			return [...live].sort(
				(a, b) => (byId(b)?.addedAt ?? 0) - (byId(a)?.addedAt ?? 0),
			);
		case "long-tracks":
			return live
				.filter((id) => (byId(id)?.duration ?? 0) > 8 * 60)
				.sort((a, b) => (byId(b)?.duration ?? 0) - (byId(a)?.duration ?? 0));
		case "flac":
			return live
				.filter((id) => {
					const track = byId(id);
					return track !== undefined && isFlac(track);
				})
				.sort((a, b) =>
					`${byId(a)?.artist ?? ""} ${byId(a)?.title ?? ""}`.localeCompare(
						`${byId(b)?.artist ?? ""} ${byId(b)?.title ?? ""}`,
					),
				);
		case "lossless":
			return live
				.filter((id) => {
					const track = byId(id);
					return track !== undefined && isLossless(track);
				})
				.sort((a, b) =>
					`${byId(a)?.artist ?? ""} ${byId(a)?.title ?? ""}`.localeCompare(
						`${byId(b)?.artist ?? ""} ${byId(b)?.title ?? ""}`,
					),
				);
	}
}
