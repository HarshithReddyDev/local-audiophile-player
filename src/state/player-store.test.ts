import { describe, expect, it } from "vitest";
import { seededRng, setShuffleRng, usePlayerStore } from "./player-store";

function reset() {
	usePlayerStore.getState().clearQueue();
	usePlayerStore.setState({
		volume: 1,
		muted: false,
		rate: 1,
		repeat: "off",
		shuffle: false,
		shuffleOrder: [],
		crossfadeEnabled: false,
		crossfadeDuration: 3,
		status: "idle",
		seeking: false,
		error: null,
	});
	setShuffleRng(seededRng(42));
}

describe("queue manipulation", () => {
	it("setQueue/enqueue/enqueueNext/remove/move", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 1);
		expect(usePlayerStore.getState().currentTrackId()).toBe("b");

		s.enqueue(["d"]);
		expect(usePlayerStore.getState().queue.map((q) => q.trackId)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);

		s.enqueueNext(["x"]);
		expect(usePlayerStore.getState().queue.map((q) => q.trackId)).toEqual([
			"a",
			"b",
			"x",
			"c",
			"d",
		]);

		const state = usePlayerStore.getState();
		const xId = state.queue[2]?.queueId ?? "";
		s.moveInQueue(xId, 0);
		expect(usePlayerStore.getState().queue.map((q) => q.trackId)[0]).toBe("x");
		// Playing item was "b" (now at index 2); currentTrackId must follow it.
		expect(usePlayerStore.getState().currentTrackId()).toBe("b");

		const bId = usePlayerStore.getState().queue[2]?.queueId ?? "";
		s.removeFromQueue(bId);
		// Removing the playing item keeps position: next item slides in.
		expect(usePlayerStore.getState().currentTrackId()).toBe("c");
	});

	it("restoreQueue sets ready without loading", () => {
		reset();
		usePlayerStore.getState().restoreQueue(["a", "b"], 1);
		const s = usePlayerStore.getState();
		expect(s.currentTrackId()).toBe("b");
		expect(s.status).toBe("ready");
	});
});

describe("next/previous semantics", () => {
	it("repeat off stops at end; previous at start returns null", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b"], 1);
		expect(s.next(false)).toBeNull();
		expect(usePlayerStore.getState().status).toBe("ended");
		// At index 0 with repeat off, previous() yields null (controller restarts).
		s.setQueue(["a", "b"], 0);
		expect(usePlayerStore.getState().previous()).toBeNull();
		expect(usePlayerStore.getState().currentTrackId()).toBe("a");
	});

	it("repeat all wraps both directions", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b"], 1);
		s.cycleRepeat(); // off -> all
		expect(s.next(false)).toBe("a");
		expect(usePlayerStore.getState().currentTrackId()).toBe("a");
		expect(usePlayerStore.getState().previous()).toBe("b");
	});

	it("repeat one replays on natural end only", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b"], 0);
		s.cycleRepeat();
		s.cycleRepeat(); // off -> all -> one
		expect(s.next(true)).toBe("a");
		expect(s.next(false)).toBe("b");
	});

	it("manual previous steps back mid-queue", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 2);
		expect(usePlayerStore.getState().previous()).toBe("b");
		expect(usePlayerStore.getState().previous()).toBe("a");
	});

	it("peekNext previews without mutating", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b"], 0);
		expect(s.peekNext(false)).toBe("b");
		expect(usePlayerStore.getState().currentTrackId()).toBe("a");
		s.setQueue(["a"], 0);
		expect(usePlayerStore.getState().peekNext(false)).toBeNull();
	});
});

describe("shuffle order model", () => {
	it("builds an explicit permutation, current first", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c", "d"], 1);
		s.toggleShuffle();
		const order = usePlayerStore.getState().shuffleOrder;
		expect(order).toHaveLength(4);
		const currentId = usePlayerStore.getState().queue[1]?.queueId;
		expect(order[0]).toBe(currentId);
		expect([...order].sort()).toEqual(
			usePlayerStore
				.getState()
				.queue.map((q) => q.queueId)
				.sort(),
		);
	});

	it("walks without repeats then ends (repeat off)", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 0);
		s.toggleShuffle();
		const seen = new Set<string>();
		let id = usePlayerStore.getState().next(false);
		while (id) {
			seen.add(id);
			id = usePlayerStore.getState().next(false);
		}
		// Started on one track, then each other track exactly once.
		expect(seen.size).toBe(2);
		expect(usePlayerStore.getState().status).toBe("ended");
	});

	it("previous retraces the shuffled walk", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c", "d"], 0);
		s.toggleShuffle();
		const first = usePlayerStore.getState().currentTrackId();
		const second = usePlayerStore.getState().next(false);
		expect(second).not.toBeNull();
		expect(usePlayerStore.getState().previous()).toBe(first);
	});

	it("repeat-all reshuffles at exhaustion instead of repeating", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 0);
		s.toggleShuffle();
		s.cycleRepeat(); // all
		const played: (string | null)[] = [];
		for (let i = 0; i < 5; i++)
			played.push(usePlayerStore.getState().next(false));
		// 2 remaining + wrap into a fresh permutation (never null with repeat-all).
		expect(played.every((p) => p !== null)).toBe(true);
	});

	it("enqueue joins the unplayed tail; order survives moves", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setQueue(["a", "b", "c"], 0);
		s.toggleShuffle();
		const before = usePlayerStore.getState().shuffleOrder.length;
		s.enqueue(["d"]);
		expect(usePlayerStore.getState().shuffleOrder).toHaveLength(before + 1);
		const ids = usePlayerStore.getState().queue.map((q) => q.queueId);
		const xId = ids[0] ?? "";
		s.moveInQueue(xId, 3);
		// Stable queueIds: the permutation still references every item.
		expect([...usePlayerStore.getState().shuffleOrder].sort()).toEqual(
			[...ids].sort(),
		);
		s.removeFromQueue(ids[1] ?? "");
		expect(usePlayerStore.getState().shuffleOrder).toHaveLength(before);
	});

	it("seeded rng makes shuffles reproducible", () => {
		const orderOf = () => {
			const s = usePlayerStore.getState();
			const byId = new Map(s.queue.map((q) => [q.queueId, q.trackId] as const));
			return s.shuffleOrder.map((id) => byId.get(id)).join(",");
		};
		reset();
		setShuffleRng(seededRng(7));
		usePlayerStore.getState().setQueue(["a", "b", "c", "d", "e"], 0);
		usePlayerStore.getState().toggleShuffle();
		const first = orderOf();
		reset();
		setShuffleRng(seededRng(7));
		usePlayerStore.getState().setQueue(["a", "b", "c", "d", "e"], 0);
		usePlayerStore.getState().toggleShuffle();
		expect(orderOf()).toBe(first);
		// …and it starts on the selected track.
		expect(orderOf().split(",")[0]).toBe("a");
	});
});

describe("crossfade prefs and guards", () => {
	it("clamps duration and toggles", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setCrossfade(true, 99);
		expect(usePlayerStore.getState().crossfadeDuration).toBe(12);
		s.setCrossfade(true, 0.1);
		expect(usePlayerStore.getState().crossfadeDuration).toBe(0.5);
		s.setCrossfade(false);
		expect(usePlayerStore.getState().crossfadeEnabled).toBe(false);
	});

	it("clamps volume and rate", () => {
		reset();
		const s = usePlayerStore.getState();
		s.setVolume(2);
		expect(usePlayerStore.getState().volume).toBe(1);
		s.setVolume(-1);
		expect(usePlayerStore.getState().volume).toBe(0);
		s.setRate(10);
		expect(usePlayerStore.getState().rate).toBe(2);
	});
});
