import { beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "../../state/player-store";
import {
	effectivePreampDb,
	reconcileRemovedTracks,
	removeQueueItem,
	stopPlayback,
} from "./use-playback";

/**
 * Controller-level queue/audio coherence. The engine is absent in node
 * (engineRef null-safe), so these tests assert store transitions; real
 * audio behavior is covered by Playwright.
 */

function reset() {
	usePlayerStore.getState().clearQueue();
	usePlayerStore.setState({
		repeat: "off",
		shuffle: false,
		shuffleOrder: [],
		status: "idle",
		error: null,
	});
}

function queueIds(): string[] {
	return usePlayerStore.getState().queue.map((q) => q.queueId);
}

beforeEach(reset);

describe("stopPlayback", () => {
	it("empties the queue and returns to idle", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 0);
		usePlayerStore.setState({ status: "playing" });
		stopPlayback();
		const after = usePlayerStore.getState();
		expect(after.queue).toEqual([]);
		expect(after.currentIndex).toBe(-1);
		expect(after.status).toBe("idle");
	});
});

describe("removeQueueItem", () => {
	it("removing a non-current item leaves playback position alone", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 0);
		usePlayerStore.setState({ status: "playing" });
		removeQueueItem(queueIds()[2] ?? "");
		const after = usePlayerStore.getState();
		expect(after.queue.map((q) => q.trackId)).toEqual(["a", "b"]);
		expect(after.currentTrackId()).toBe("a");
		expect(after.status).toBe("playing");
	});

	it("removing the current item slides the next one into place", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 1);
		usePlayerStore.setState({ status: "playing" });
		removeQueueItem(queueIds()[1] ?? "");
		const after = usePlayerStore.getState();
		expect(after.queue.map((q) => q.trackId)).toEqual(["a", "c"]);
		expect(after.currentTrackId()).toBe("c");
	});

	it("removing the last item returns to idle", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a"], 0);
		usePlayerStore.setState({ status: "playing" });
		removeQueueItem(queueIds()[0] ?? "");
		const after = usePlayerStore.getState();
		expect(after.queue).toEqual([]);
		expect(after.status).toBe("idle");
	});
});

describe("reconcileRemovedTracks", () => {
	it("prunes deleted ids and keeps a live current item", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c", "d"], 1);
		usePlayerStore.setState({ status: "playing" });
		reconcileRemovedTracks(["a", "d"]);
		const after = usePlayerStore.getState();
		expect(after.queue.map((q) => q.trackId)).toEqual(["b", "c"]);
		expect(after.currentTrackId()).toBe("b");
		expect(after.status).toBe("playing");
	});

	it("advances when the removed track was current", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 1);
		usePlayerStore.setState({ status: "paused" });
		reconcileRemovedTracks(["b"]);
		const after = usePlayerStore.getState();
		expect(after.queue.map((q) => q.trackId)).toEqual(["a", "c"]);
		expect(after.currentTrackId()).toBe("c");
	});

	it("clears everything when the library is reset mid-play", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b"], 0);
		usePlayerStore.setState({ status: "playing" });
		reconcileRemovedTracks(["a", "b"]);
		const after = usePlayerStore.getState();
		expect(after.queue).toEqual([]);
		expect(after.status).toBe("idle");
	});

	it("ignores unknown ids", () => {
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b"], 0);
		reconcileRemovedTracks(["zzz"]);
		expect(usePlayerStore.getState().queue.map((q) => q.trackId)).toEqual([
			"a",
			"b",
		]);
	});
});

describe("effectivePreampDb", () => {
	it("adds ReplayGain exactly once and clamps to preamp limits", () => {
		// No tags: manual preamp passes through.
		expect(effectivePreampDb(-3, "track", undefined)).toMatchObject({
			preampDb: -3,
			rgDb: 0,
			rgSource: "none",
		});
		// Track mode with tags: single addition point.
		const track = {
			replayGain: {
				trackGainDb: -6,
				trackPeak: null,
				albumGainDb: -8,
				albumPeak: null,
			},
		} as Parameters<typeof effectivePreampDb>[2];
		expect(effectivePreampDb(0, "track", track)).toMatchObject({
			preampDb: -6,
			rgDb: -6,
			rgSource: "track",
		});
		expect(effectivePreampDb(2, "track", track)).toMatchObject({
			preampDb: -4,
			rgDb: -6,
		});
		// Off ignores tags entirely (no double-apply risk).
		expect(effectivePreampDb(2, "off", track)).toMatchObject({
			preampDb: 2,
			rgDb: 0,
		});
		// Clamped at the preamp rails, never beyond.
		const hot = {
			replayGain: {
				trackGainDb: 20,
				trackPeak: null,
				albumGainDb: null,
				albumPeak: null,
			},
		} as Parameters<typeof effectivePreampDb>[2];
		expect(effectivePreampDb(10, "track", hot)?.preampDb).toBe(24);
	});
});
