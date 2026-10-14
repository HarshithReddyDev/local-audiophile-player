import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { PlaybackStatus, QueueItem, RepeatMode } from "../types/library";
import { newId } from "../types/library";
import { clamp } from "../utils/time";

/**
 * Shuffle model: an explicit permutation of queue ids with the current item
 * first (`shuffleOrder`), consumed front-to-back. No repeats until exhausted;
 * previous() walks the pointer back. Reshuffled on toggle-on, setQueue, and
 * exhaustion-with-repeat-all. Enqueued items join the unplayed tail.
 * Documented in docs/playback-engine.md.
 */

export type RandomFn = () => number;

let rng: RandomFn = Math.random;

/** Test hook: inject a seeded RNG for deterministic shuffle assertions. */
export function setShuffleRng(fn: RandomFn): void {
	rng = fn;
}

/** Deterministic LCG for tests and reproducible sessions. */
export function seededRng(seed: number): RandomFn {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function shuffled<T>(items: T[], random: RandomFn): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const a = out[i];
		const b = out[j];
		if (a !== undefined && b !== undefined) {
			out[i] = b;
			out[j] = a;
		}
	}
	return out;
}

export interface PlayerState {
	queue: QueueItem[];
	/** Index into queue, -1 when nothing is loaded. */
	currentIndex: number;
	status: PlaybackStatus;
	/** True while a seek is in flight; orthogonal to playing/paused. */
	seeking: boolean;
	currentTime: number;
	duration: number | null;
	volume: number;
	muted: boolean;
	rate: number;
	repeat: RepeatMode;
	shuffle: boolean;
	/** Permutation of queue ids, current first. Empty unless shuffling. */
	shuffleOrder: string[];
	crossfadeEnabled: boolean;
	/** Seconds, clamped 0.5–12. */
	crossfadeDuration: number;
	error: string | null;

	currentTrackId: () => string | null;
	setQueue: (trackIds: string[], startIndex?: number) => void;
	/** Restore persisted queue without implying a loaded element. */
	restoreQueue: (trackIds: string[], startIndex: number) => void;
	/** Restore persisted transport modes (repeat/shuffle/crossfade). */
	restoreTransport: (prefs: {
		repeat: RepeatMode;
		shuffle: boolean;
		crossfadeEnabled: boolean;
		crossfadeDuration: number;
	}) => void;
	enqueue: (trackIds: string[]) => void;
	enqueueNext: (trackIds: string[]) => void;
	removeFromQueue: (queueId: string) => void;
	moveInQueue: (queueId: string, toIndex: number) => void;
	clearQueue: () => void;
	/**
	 * Advance. auto=true is natural track end (honors repeat-one); manual
	 * next always moves. Returns null at exhaustion (controller ends) —
	 * never throws, never wraps silently.
	 */
	next: (auto: boolean) => string | null;
	/**
	 * Step back. Returns null at the start (controller restarts the track)
	 * or when empty — never throws.
	 */
	previous: () => string | null;
	/** Next id without mutating state (for preload lookahead). */
	peekNext: (auto: boolean) => string | null;
	setStatus: (status: PlaybackStatus) => void;
	setSeeking: (seeking: boolean) => void;
	setTime: (seconds: number) => void;
	setDuration: (seconds: number | null) => void;
	setVolume: (volume: number) => void;
	toggleMute: () => void;
	setRate: (rate: number) => void;
	cycleRepeat: () => void;
	toggleShuffle: () => void;
	setCrossfade: (enabled: boolean, duration?: number) => void;
	setError: (message: string | null) => void;
	/** Clear a stale message after a later success; keeps status. */
	clearError: () => void;
}

function toItems(trackIds: string[]): QueueItem[] {
	return trackIds.map((trackId) => ({ queueId: newId("q"), trackId }));
}

function buildOrder(queue: QueueItem[], currentIndex: number): string[] {
	const current = queue[currentIndex];
	if (!current) return [];
	const rest = shuffled(
		queue.filter((_, i) => i !== currentIndex).map((q) => q.queueId),
		rng,
	);
	return [current.queueId, ...rest];
}

type NextResult =
	| { kind: "advance"; index: number }
	| { kind: "replay" }
	| { kind: "end" };

function computeNext(
	queue: QueueItem[],
	currentIndex: number,
	repeat: RepeatMode,
	shuffle: boolean,
	shuffleOrder: string[],
	auto: boolean,
): NextResult {
	if (queue.length === 0 || currentIndex === -1) return { kind: "end" };
	if (auto && repeat === "one") return { kind: "replay" };
	if (shuffle && queue.length > 1) {
		const currentId = queue[currentIndex]?.queueId;
		const pos = currentId ? shuffleOrder.indexOf(currentId) : -1;
		if (pos !== -1 && pos + 1 < shuffleOrder.length) {
			const nextId = shuffleOrder[pos + 1];
			const index = queue.findIndex((q) => q.queueId === nextId);
			if (index !== -1) return { kind: "advance", index };
		}
		// Order exhausted (or desynced): repeat-all reshuffles, else end.
		if (repeat === "all") {
			const fresh = buildOrder(queue, currentIndex);
			const nextId = fresh[1] ?? fresh[0];
			const index = nextId ? queue.findIndex((q) => q.queueId === nextId) : -1;
			if (index !== -1) return { kind: "advance", index };
		}
		return { kind: "end" };
	}
	if (currentIndex >= queue.length - 1) {
		if (repeat === "all") return { kind: "advance", index: 0 };
		return { kind: "end" };
	}
	return { kind: "advance", index: currentIndex + 1 };
}

export const usePlayerStore = create<PlayerState>()(
	subscribeWithSelector((set, get) => ({
		queue: [],
		currentIndex: -1,
		status: "idle",
		seeking: false,
		currentTime: 0,
		duration: null,
		volume: 1,
		muted: false,
		rate: 1,
		repeat: "off",
		shuffle: false,
		shuffleOrder: [],
		crossfadeEnabled: false,
		crossfadeDuration: 3,
		error: null,

		currentTrackId: () => {
			const { queue, currentIndex } = get();
			return queue[currentIndex]?.trackId ?? null;
		},

		setQueue: (trackIds, startIndex = 0) => {
			const queue = toItems(trackIds);
			const currentIndex =
				trackIds.length > 0 ? clamp(startIndex, 0, trackIds.length - 1) : -1;
			set({
				queue,
				currentIndex,
				currentTime: 0,
				duration: null,
				status: trackIds.length > 0 ? "loading" : "idle",
				seeking: false,
				shuffleOrder:
					get().shuffle && currentIndex !== -1
						? buildOrder(queue, currentIndex)
						: [],
				error: null,
			});
		},

		restoreQueue: (trackIds, startIndex) => {
			const queue = toItems(trackIds);
			const currentIndex =
				trackIds.length > 0 ? clamp(startIndex, 0, trackIds.length - 1) : -1;
			set({
				queue,
				currentIndex,
				currentTime: 0,
				duration: null,
				status: trackIds.length > 0 ? "ready" : "idle",
				seeking: false,
				shuffleOrder: [],
				error: null,
			});
		},

		restoreTransport: (prefs) =>
			set((s) => ({
				repeat: prefs.repeat,
				shuffle: prefs.shuffle,
				shuffleOrder:
					prefs.shuffle && s.currentIndex !== -1
						? buildOrder(s.queue, s.currentIndex)
						: [],
				crossfadeEnabled: prefs.crossfadeEnabled,
				crossfadeDuration: clamp(prefs.crossfadeDuration, 0.5, 12),
			})),

		enqueue: (trackIds) => {
			if (trackIds.length === 0) return;
			set((s) => {
				const items = toItems(trackIds);
				const queue = [...s.queue, ...items];
				let { shuffleOrder } = s;
				if (s.shuffle && s.currentIndex !== -1) {
					// New items join the unplayed tail in random positions.
					const currentId = s.queue[s.currentIndex]?.queueId;
					const pos = currentId ? shuffleOrder.indexOf(currentId) : -1;
					const tail = shuffled(
						items.map((q) => q.queueId),
						rng,
					);
					const head =
						pos === -1 ? [...shuffleOrder] : shuffleOrder.slice(0, pos + 1);
					const rest = pos === -1 ? [] : shuffleOrder.slice(pos + 1);
					shuffleOrder = [...head, ...tail, ...rest];
				}
				return {
					queue,
					shuffleOrder,
					currentIndex: s.currentIndex === -1 ? 0 : s.currentIndex,
					status: s.currentIndex === -1 ? "loading" : s.status,
				};
			});
		},

		enqueueNext: (trackIds) => {
			if (trackIds.length === 0) return;
			set((s) => {
				const items = toItems(trackIds);
				const at = s.currentIndex === -1 ? 0 : s.currentIndex + 1;
				const queue = [...s.queue.slice(0, at), ...items, ...s.queue.slice(at)];
				let { shuffleOrder } = s;
				if (s.shuffle && s.currentIndex !== -1) {
					// "Next" promises position: splice right after current.
					const currentId = s.queue[s.currentIndex]?.queueId;
					const pos = currentId ? shuffleOrder.indexOf(currentId) : -1;
					if (pos !== -1) {
						shuffleOrder = [
							...shuffleOrder.slice(0, pos + 1),
							...items.map((q) => q.queueId),
							...shuffleOrder.slice(pos + 1),
						];
					}
				}
				return {
					queue,
					shuffleOrder,
					currentIndex: s.currentIndex === -1 ? 0 : s.currentIndex,
					status: s.currentIndex === -1 ? "loading" : s.status,
				};
			});
		},

		removeFromQueue: (queueId) =>
			set((s) => {
				const idx = s.queue.findIndex((q) => q.queueId === queueId);
				if (idx === -1) return s;
				const queue = s.queue.filter((q) => q.queueId !== queueId);
				let { currentIndex } = s;
				if (idx < currentIndex) currentIndex -= 1;
				else if (idx === currentIndex) {
					// Removing the playing item keeps position: the next item slides in.
					if (currentIndex >= queue.length) currentIndex = queue.length - 1;
				}
				return {
					queue,
					currentIndex,
					status: queue.length === 0 ? "idle" : s.status,
					shuffleOrder: s.shuffleOrder.filter((id) => id !== queueId),
				};
			}),

		moveInQueue: (queueId, toIndex) =>
			set((s) => {
				// shuffleOrder holds stable queueIds: moves need no remapping.
				const from = s.queue.findIndex((q) => q.queueId === queueId);
				if (from === -1) return s;
				const clamped = clamp(toIndex, 0, s.queue.length - 1);
				if (clamped === from) return s;
				const queue = [...s.queue];
				const [item] = queue.splice(from, 1);
				if (!item) return s;
				queue.splice(clamped, 0, item);
				let { currentIndex } = s;
				if (from === currentIndex) currentIndex = clamped;
				else if (from < currentIndex && clamped >= currentIndex)
					currentIndex -= 1;
				else if (from > currentIndex && clamped <= currentIndex)
					currentIndex += 1;
				return { queue, currentIndex };
			}),

		clearQueue: () =>
			set({
				queue: [],
				currentIndex: -1,
				status: "idle",
				currentTime: 0,
				duration: null,
				seeking: false,
				shuffleOrder: [],
				error: null,
			}),

		next: (auto) => {
			const s = get();
			const result = computeNext(
				s.queue,
				s.currentIndex,
				s.repeat,
				s.shuffle,
				s.shuffleOrder,
				auto,
			);
			if (result.kind === "end") {
				if (s.queue.length > 0 && s.currentIndex !== -1)
					set({ status: "ended" });
				return null;
			}
			if (result.kind === "replay") {
				set({ currentTime: 0 });
				return s.queue[s.currentIndex]?.trackId ?? null;
			}
			// Shuffle exhaustion with repeat-all stores the fresh permutation.
			if (s.shuffle && s.repeat === "all") {
				const pos = s.shuffleOrder.indexOf(
					s.queue[s.currentIndex]?.queueId ?? "",
				);
				if (pos === -1 || pos + 1 >= s.shuffleOrder.length) {
					set({
						shuffleOrder: buildOrder(s.queue, s.currentIndex),
					});
					const fresh = get().shuffleOrder;
					const nextId = fresh[1] ?? fresh[0];
					const index = nextId
						? s.queue.findIndex((q) => q.queueId === nextId)
						: -1;
					if (index !== -1) {
						set({ currentIndex: index, currentTime: 0, duration: null });
						return s.queue[index]?.trackId ?? null;
					}
				}
			}
			set({ currentIndex: result.index, currentTime: 0, duration: null });
			return s.queue[result.index]?.trackId ?? null;
		},

		previous: () => {
			const s = get();
			if (s.queue.length === 0 || s.currentIndex === -1) return null;
			if (s.shuffle && s.queue.length > 1) {
				const currentId = s.queue[s.currentIndex]?.queueId;
				const pos = currentId ? s.shuffleOrder.indexOf(currentId) : -1;
				if (pos > 0) {
					const prevId = s.shuffleOrder[pos - 1];
					const index = prevId
						? s.queue.findIndex((q) => q.queueId === prevId)
						: -1;
					if (index !== -1) {
						set({ currentIndex: index, currentTime: 0, duration: null });
						return s.queue[index]?.trackId ?? null;
					}
				}
				if (pos === 0 && s.repeat === "all" && s.shuffleOrder.length > 0) {
					const lastId = s.shuffleOrder[s.shuffleOrder.length - 1];
					const index = lastId
						? s.queue.findIndex((q) => q.queueId === lastId)
						: -1;
					if (index !== -1) {
						set({ currentIndex: index, currentTime: 0, duration: null });
						return s.queue[index]?.trackId ?? null;
					}
				}
				// At the start (or desynced): controller restarts the track.
				return null;
			}
			if (s.currentIndex === 0) {
				if (s.repeat === "all") {
					const last = s.queue.length - 1;
					set({ currentIndex: last, currentTime: 0, duration: null });
					return s.queue[last]?.trackId ?? null;
				}
				return null;
			}
			const prevIndex = s.currentIndex - 1;
			set({ currentIndex: prevIndex, currentTime: 0, duration: null });
			return s.queue[prevIndex]?.trackId ?? null;
		},

		peekNext: (auto) => {
			const s = get();
			const result = computeNext(
				s.queue,
				s.currentIndex,
				s.repeat,
				s.shuffle,
				s.shuffleOrder,
				auto,
			);
			if (result.kind === "end") return null;
			if (result.kind === "replay")
				return s.queue[s.currentIndex]?.trackId ?? null;
			return s.queue[result.index]?.trackId ?? null;
		},

		setStatus: (status) => set({ status }),
		setSeeking: (seeking) => set({ seeking }),
		setTime: (seconds) =>
			set({ currentTime: Number.isFinite(seconds) ? Math.max(0, seconds) : 0 }),
		setDuration: (seconds) =>
			set({
				duration: seconds != null && Number.isFinite(seconds) ? seconds : null,
			}),
		setVolume: (volume) => set({ volume: clamp(volume, 0, 1), muted: false }),
		toggleMute: () => set((s) => ({ muted: !s.muted })),
		setRate: (rate) => set({ rate: clamp(rate, 0.25, 2) }),
		cycleRepeat: () =>
			set((s) => ({
				repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
			})),
		toggleShuffle: () =>
			set((s) => {
				const shuffle = !s.shuffle;
				return {
					shuffle,
					shuffleOrder:
						shuffle && s.currentIndex !== -1
							? buildOrder(s.queue, s.currentIndex)
							: [],
				};
			}),
		setCrossfade: (enabled, duration) =>
			set((s) => ({
				crossfadeEnabled: enabled,
				crossfadeDuration:
					duration === undefined
						? s.crossfadeDuration
						: clamp(duration, 0.5, 12),
			})),
		setError: (message) =>
			set({ error: message, status: message ? "error" : "idle" }),
		clearError: () => set({ error: null }),
	})),
);
