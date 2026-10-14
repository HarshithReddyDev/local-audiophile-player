import { describe, expect, it } from "vitest";
import type { ExternalPlaylist, ExternalTrack } from "./model";
import {
	acceptHighConfidence,
	buildSessionFor,
	diffSessions,
	findExistingSession,
	itemKey,
	resolveItem,
	sessionLocalIds,
} from "./session";

function track(over: Partial<ExternalTrack> = {}): ExternalTrack {
	return {
		provider: "file",
		externalId: "e",
		title: "Blue Sky",
		artists: ["Green Field"],
		album: "Wide Open",
		durationSec: 200,
		isrc: null,
		trackNumber: null,
		sourceUrl: null,
		position: 0,
		...over,
	};
}

function playlist(tracks: ExternalTrack[]): ExternalPlaylist {
	return {
		provider: "file",
		externalId: "file:mix:abc123",
		name: "Mix",
		description: null,
		owner: null,
		sourceUrl: null,
		importedAt: 0,
		tracks,
	};
}

const LIB = [
	{
		id: "l1",
		title: "Blue Sky",
		artist: "Green Field",
		album: "Wide Open",
		durationSec: 201,
		isrc: null,
	},
	{
		id: "l2",
		title: "Red Sky",
		artist: "Someone Else",
		album: "Elsewhere",
		durationSec: 180,
		isrc: null,
	},
];

describe("sessions", () => {
	it("builds stable keys and preserves order", () => {
		const s = buildSessionFor(
			playlist([
				track(),
				track({ title: "Red Sky", artists: ["Someone Else"] }),
			]),
			LIB,
			5,
		);
		expect(s.importedAt).toBe(5);
		// Track 2 lacks album/duration corroboration → MEDIUM → review.
		expect(s.items.map((i) => i.match.state)).toEqual(["matched", "ambiguous"]);
		expect(itemKey(track())).toBe(itemKey(track()));
		// Auto-links flow immediately; review only gates the ambiguous one.
		expect(sessionLocalIds(s)).toEqual(["l1"]);
		// Accept HIGH links marks them user-resolved (preserved on update).
		const accepted = acceptHighConfidence(s);
		expect(sessionLocalIds(accepted)).toEqual(["l1"]);
		expect(accepted.items[0]?.userResolved).toBe(true);
	});

	it("resolves manually, skips, and keeps unresolved metadata", () => {
		let s = buildSessionFor(
			playlist([track({ title: "zzz", artists: ["yyy"] })]),
			LIB,
			0,
		);
		expect(s.items[0]?.match.state).toBe("unmatched");
		s = resolveItem(s, s.items[0]?.key ?? "", "l2", false);
		expect(s.items[0]?.match).toMatchObject({
			state: "manual",
			localTrackId: "l2",
		});
		expect(s.items[0]?.userResolved).toBe(true);
		expect(sessionLocalIds(s)).toEqual(["l2"]);
		s = resolveItem(s, s.items[0]?.key ?? "", null, true);
		expect(s.items[0]?.skipped).toBe(true);
		expect(sessionLocalIds(s)).toEqual([]);
		// External metadata survives skipping (never deleted silently).
		expect(s.items[0]?.external.title).toBe("zzz");
	});

	it("never invents ids for unmatched tracks", () => {
		const s = acceptHighConfidence(
			buildSessionFor(
				playlist([track({ title: "zzz", artists: ["yyy"] })]),
				LIB,
				0,
			),
		);
		expect(sessionLocalIds(s)).toEqual([]);
	});
});

describe("re-import", () => {
	it("finds existing sessions by provider + external id", () => {
		const s = buildSessionFor(playlist([track()]), LIB, 0);
		expect(findExistingSession([s], "file", "file:mix:abc123")?.id).toBe(s.id);
		expect(findExistingSession([s], "file", "other")).toBeNull();
		expect(findExistingSession([], "file", "file:mix:abc123")).toBeNull();
	});

	it("diffs added/removed/reordered and preserves manual resolutions", () => {
		const prev = acceptHighConfidence(
			buildSessionFor(
				playlist([
					track({ externalId: "a", title: "A" }),
					track({ externalId: "b", title: "B" }),
					track({ externalId: "c", title: "C" }),
				]),
				[],
				0,
			),
		);
		// Manually resolve "b" to a local track.
		const keyB = prev.items[1]?.key ?? "";
		const resolved: typeof prev = {
			...prev,
			items: prev.items.map((i) =>
				i.key === keyB
					? {
							...i,
							userResolved: true,
							match: {
								state: "manual",
								localTrackId: "l9",
								candidates: [],
								confidence: "high",
							},
						}
					: i,
			),
		};
		const fresh = buildSessionFor(
			playlist([
				track({ externalId: "b", title: "B" }),
				track({ externalId: "d", title: "D" }),
				track({ externalId: "a", title: "A" }),
			]),
			[],
			1,
		);
		const { merged, diff } = diffSessions(resolved, fresh);
		expect(diff.added.map((i) => i.external.title)).toEqual(["D"]);
		expect(diff.removed.map((i) => i.external.title)).toEqual(["C"]);
		expect(diff.reordered.length).toBeGreaterThan(0);
		// Manual resolution of B survives the update.
		const kept = merged.items.find((i) => i.key === keyB);
		expect(kept?.match).toMatchObject({ state: "manual", localTrackId: "l9" });
		expect(merged.localPlaylistId).toBe(resolved.localPlaylistId);
	});
});
