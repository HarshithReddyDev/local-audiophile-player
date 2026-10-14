/**
 * Import sessions: match results with user resolutions, re-import
 * detection, and update diffing. Pure logic — persistence lives in the
 * repository, rendering in the import UI.
 */

import { newId } from "../types/library";
import type { LocalCandidate } from "./match";
import { matchPlaylist } from "./match";
import type {
	ExternalPlaylist,
	ExternalTrack,
	ImportItem,
	ImportSession,
	TrackMatch,
} from "./model";

/** Stable per-item key within one import (survives reorder). */
export function itemKey(track: ExternalTrack): string {
	let h = 2166136261;
	const text = `${track.provider}|${track.externalId}|${track.title}|${track.artists.join(",")}`;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

export function buildSession(
	external: ExternalPlaylist,
	matches: TrackMatch[],
	now = Date.now(),
): ImportSession {
	return {
		id: newId("import"),
		provider: external.provider,
		externalId: external.externalId,
		name: external.name,
		description: external.description,
		sourceUrl: external.sourceUrl,
		importedAt: now,
		updatedAt: now,
		localPlaylistId: null,
		items: external.tracks.map((track, i) => ({
			key: itemKey(track),
			external: track,
			match: matches[i] ?? {
				state: "unmatched",
				localTrackId: null,
				candidates: [],
				confidence: "none",
			},
			userResolved: false,
			skipped: false,
		})),
	};
}

/** Convenience: parse → match → session in one deterministic step. */
export function buildSessionFor(
	external: ExternalPlaylist,
	library: LocalCandidate[],
	now = Date.now(),
): ImportSession {
	return buildSession(external, matchPlaylist(external.tracks, library), now);
}

/** Bulk-accept every HIGH auto-link (matched items only). No-op otherwise. */
export function acceptHighConfidence(session: ImportSession): ImportSession {
	return {
		...session,
		updatedAt: Date.now(),
		items: session.items.map((item) =>
			item.match.state === "matched" ? { ...item, userResolved: true } : item,
		),
	};
}

export function resolveItem(
	session: ImportSession,
	key: string,
	localTrackId: string | null,
	skipped: boolean,
): ImportSession {
	return {
		...session,
		updatedAt: Date.now(),
		items: session.items.map((item) => {
			if (item.key !== key) return item;
			if (skipped) {
				return {
					...item,
					skipped: true,
					userResolved: true,
					match: { ...item.match, state: "unmatched", localTrackId: null },
				};
			}
			if (localTrackId === null) {
				// Keep unresolved: metadata stays, nothing links.
				return {
					...item,
					skipped: false,
					userResolved: false,
					match: { ...item.match, state: "unmatched", localTrackId: null },
				};
			}
			return {
				...item,
				skipped: false,
				userResolved: true,
				match: {
					state: "manual",
					localTrackId,
					candidates: item.match.candidates,
					confidence: item.match.confidence,
				},
			};
		}),
	};
}

/**
 * Ordered local track ids for the final playlist: matched + manually
 * resolved, non-skipped, in source order. Unmatched/skipped tracks are
 * never converted into fake ids — they stay in the session only.
 */
export function sessionLocalIds(session: ImportSession): string[] {
	const out: string[] = [];
	for (const item of session.items) {
		if (item.skipped) continue;
		const id = item.match.localTrackId;
		if (
			(item.match.state === "matched" || item.match.state === "manual") &&
			id !== null
		) {
			if (!out.includes(id)) out.push(id);
		}
	}
	return out;
}

export interface SessionDiff {
	added: ImportItem[];
	removed: ImportItem[];
	/** Keys present in both but at different positions. */
	reordered: string[];
	/** Same key, changed external metadata (title/artists/album). */
	changed: string[];
}

/** Find a previous import of the same external playlist, if any. */
export function findExistingSession(
	sessions: ImportSession[],
	provider: ExternalPlaylist["provider"],
	externalId: string,
): ImportSession | null {
	return (
		sessions.find(
			(s) => s.provider === provider && s.externalId === externalId,
		) ?? null
	);
}

function sameMetadata(a: ExternalTrack, b: ExternalTrack): boolean {
	return (
		a.title === b.title &&
		a.album === b.album &&
		a.artists.join("\n") === b.artists.join("\n") &&
		(a.durationSec ?? -1) === (b.durationSec ?? -1)
	);
}

/**
 * Diff a re-import against the stored session. Manual resolutions carry
 * over by item key; added/removed/reordered/changed tracks are reported
 * so the UI can ask before touching the user's playlist.
 */
export function diffSessions(
	previous: ImportSession,
	fresh: ImportSession,
): { merged: ImportSession; diff: SessionDiff } {
	const prevByKey = new Map(previous.items.map((i) => [i.key, i]));
	const freshByKey = new Map(fresh.items.map((i) => [i.key, i]));
	const added = fresh.items.filter((i) => !prevByKey.has(i.key));
	const removed = previous.items.filter((i) => !freshByKey.has(i.key));
	const prevOrder = previous.items.map((i) => i.key);
	const freshOrder = fresh.items.map((i) => i.key);
	const reordered = freshOrder.filter(
		(k) =>
			prevByKey.has(k) &&
			prevOrder.indexOf(k) !==
				freshOrder.filter((x) => prevByKey.has(x)).indexOf(k),
	);
	const changed = fresh.items
		.filter((i) => {
			const p = prevByKey.get(i.key);
			return p !== undefined && !sameMetadata(p.external, i.external);
		})
		.map((i) => i.key);
	// Merge: keep the user's resolutions; take fresh metadata + matches for
	// untouched items, fresh matches for new ones.
	const merged: ImportSession = {
		...fresh,
		id: previous.id,
		localPlaylistId: previous.localPlaylistId,
		importedAt: previous.importedAt,
		updatedAt: Date.now(),
		items: fresh.items.map((item) => {
			const prev = prevByKey.get(item.key);
			if (prev?.userResolved) {
				return {
					...item,
					userResolved: true,
					skipped: prev.skipped,
					match:
						prev.match.state === "manual" || prev.skipped
							? prev.match
							: item.match,
				};
			}
			return item;
		}),
	};
	return { merged, diff: { added, removed, reordered, changed } };
}
