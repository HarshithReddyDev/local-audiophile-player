import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckGain, MediaElement } from "./playback-engine";
import {
	equalPowerCurves,
	equalPowerGains,
	PlaybackEngine,
} from "./playback-engine";

/** Deterministic stand-in for HTMLAudioElement; no jsdom required. */
class FakeAudioElement implements MediaElement {
	src = "";
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	readyState = 0;
	volume = 1;
	muted = false;
	playbackRate = 1;
	preload = "none";
	error: { message: string } | null = null;
	playBehavior: "ok" | "reject" = "ok";
	private handlers = new Map<string, Set<() => void>>();

	async play(): Promise<void> {
		if (this.playBehavior === "reject")
			throw new DOMException("NotAllowed", "NotAllowedError");
		this.paused = false;
		this.fire("play");
	}

	pause(): void {
		this.paused = true;
		this.fire("pause");
	}

	load(): void {
		this.readyState = 4;
		this.fire("loadedmetadata");
	}

	addEventListener(type: string, listener: () => void): void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(listener);
	}

	removeEventListener(type: string, listener: () => void): void {
		this.handlers.get(type)?.delete(listener);
	}

	fire(type: string): void {
		for (const h of this.handlers.get(type) ?? []) h();
	}
}

class FakeGain implements DeckGain {
	value = 0;
	curves: { length: number; duration: number }[] = [];
	cancelled = 0;
	nowTime = 100;
	setImmediate(value: number): void {
		this.value = value;
	}
	curveTo(values: Float32Array, _start: number, duration: number): void {
		this.curves.push({ length: values.length, duration });
		this.value = values[values.length - 1] ?? this.value;
	}
	cancelScheduled(): void {
		this.cancelled += 1;
	}
	now(): number {
		return this.nowTime;
	}
}

function testGraph(gains: FakeGain[]) {
	return () => ({
		context: {
			state: "running",
			currentTime: 100,
			resume: async () => undefined,
			close: async () => undefined,
		},
		mix: {},
		master: {},
		masterVolume: (_v: number) => undefined,
		attachDeck: (_element: MediaElement) => {
			const gain = new FakeGain();
			gains.push(gain);
			return gain;
		},
	});
}

let elements: FakeAudioElement[];
let gains: FakeGain[];
let engine: PlaybackEngine;

beforeEach(() => {
	vi.useRealTimers();
	elements = [new FakeAudioElement(), new FakeAudioElement()];
	gains = [];
	let n = 0;
	engine = new PlaybackEngine(() => {
		const el = elements[n % elements.length];
		n += 1;
		if (!el) throw new Error("out of fake elements");
		return el;
	}, testGraph(gains));
	return () => engine.destroy();
});

function audioFile(name = "song.mp3"): File {
	return new File([new Uint8Array([1, 2, 3])], name, { type: "audio/mpeg" });
}

describe("equal-power curves", () => {
	it("starts/ends exact and conserves power", () => {
		const [out0, in0] = equalPowerGains(0);
		const [out1, in1] = equalPowerGains(1);
		expect(out0).toBeCloseTo(1, 12);
		expect(in0).toBeCloseTo(0, 12);
		expect(out1).toBeCloseTo(0, 12);
		expect(in1).toBeCloseTo(1, 12);
		for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
			const [o, n] = equalPowerGains(t);
			expect(o * o + n * n).toBeCloseTo(1, 12);
		}
		const { out, inn } = equalPowerCurves();
		expect(out.length).toBe(64);
		expect(out[0]).toBeCloseTo(1, 6);
		expect(out[63]).toBeCloseTo(0, 6);
		expect(inn[0]).toBeCloseTo(0, 6);
		expect(inn[63]).toBeCloseTo(1, 6);
	});

	it("clamps out-of-range input", () => {
		expect(equalPowerGains(-2)[0]).toBeCloseTo(1, 12);
		expect(equalPowerGains(99)[1]).toBeCloseTo(1, 12);
	});
});

describe("basic deck operation", () => {
	it("loads, plays, and snapshots the active deck", async () => {
		engine.load(audioFile());
		expect(elements[0]?.src.startsWith("blob:")).toBe(true);
		await engine.play();
		expect(elements[0]?.paused).toBe(false);
		elements[0]?.fire("loadedmetadata");
		const first = elements[0];
		if (first) first.duration = 120;
		expect(engine.snapshot()).toMatchObject({ duration: 120, paused: false });
	});

	it("rapid loads leave the last file authoritative", () => {
		for (const name of ["a.mp3", "b.mp3", "c.mp3", "d.mp3"]) {
			engine.load(audioFile(name));
		}
		// One active URL at a time; standby cleared on manual load.
		expect(engine.getDebugState().decks.filter((d) => d.hasUrl)).toHaveLength(
			1,
		);
	});
});

describe("preload and gapless activation", () => {
	it("preloads standby and swaps instantly", async () => {
		engine.load(audioFile("a.mp3"), "track-a");
		await engine.play();
		engine.preload(audioFile("b.mp3"), "track-b");
		expect(engine.preloadedKey).toBe("track-b");
		expect(engine.activatePreload()).toBe(true);
		const state = engine.getDebugState();
		expect(state.active).toBe(1);
		expect(elements[0]?.paused).toBe(true);
	});

	it("refuses activation without a ready standby", () => {
		engine.load(audioFile("a.mp3"));
		expect(engine.activatePreload()).toBe(false);
		engine.preload(audioFile("b.mp3"), "track-b");
		// readyState 0 in a fresh fake: not ready.
		const standby = elements[1];
		if (standby) standby.readyState = 0;
		expect(engine.activatePreload()).toBe(false);
	});

	it("ignores standby deck events, forwards active ones", () => {
		const seen: string[] = [];
		engine.on("ended", (e) => seen.push(e));
		engine.load(audioFile("a.mp3"));
		engine.preload(audioFile("b.mp3"), "track-b");
		elements[1]?.fire("ended");
		expect(seen).toEqual([]);
		elements[0]?.fire("ended");
		expect(seen).toEqual(["ended"]);
	});

	it("forwards standby failures as preloaderror", () => {
		const seen: string[] = [];
		engine.on("preloaderror", (e) => seen.push(e));
		engine.load(audioFile("a.mp3"));
		engine.preload(audioFile("b.mp3"), "track-b");
		elements[1]?.fire("error");
		expect(seen).toEqual(["preloaderror"]);
	});
});

describe("crossfade", () => {
	it("schedules equal-power curves on both decks and swaps", async () => {
		vi.useFakeTimers();
		engine.load(audioFile("a.mp3"), "track-a");
		await engine.play();
		engine.preload(audioFile("b.mp3"), "track-b");
		const standby = elements[1];
		if (standby) standby.readyState = 4;

		const started = engine.beginCrossfade(2);
		const done = expect(started).resolves.toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		await done;
		expect(engine.isFading).toBe(false);
		expect(engine.getDebugState().active).toBe(1);
		// Both decks got a 64-point curve over ~2s.
		expect(gains[0]?.curves).toHaveLength(1);
		expect(gains[1]?.curves).toHaveLength(1);
		expect(gains[0]?.curves[0]?.duration).toBeCloseTo(2, 6);
		vi.useRealTimers();
	});

	it("refuses without preload and clamps duration", async () => {
		engine.load(audioFile("a.mp3"));
		await expect(engine.beginCrossfade(3)).resolves.toBe(false);
		engine.preload(audioFile("b.mp3"), "track-b");
		const standby = elements[1];
		if (standby) standby.readyState = 4;
		vi.useFakeTimers();
		const pending = engine.beginCrossfade(99);
		// Let play() resolve and the fade schedule before cancelling.
		await vi.advanceTimersByTimeAsync(0);
		expect(engine.isFading).toBe(true);
		engine.cancelFade();
		expect(engine.isFading).toBe(false);
		// Cancelled fade settles false and never swaps decks.
		await expect(pending).resolves.toBe(false);
		expect(engine.getDebugState().active).toBe(0);
		vi.useRealTimers();
	});
});

describe("volume and rate", () => {
	it("drives both decks for rate, master for volume", () => {
		engine.load(audioFile());
		engine.setRate(1.5);
		expect(elements[0]?.playbackRate).toBe(1.5);
		expect(elements[1]?.playbackRate).toBe(1.5);
		engine.setVolume(0.5);
		engine.setMuted(true);
		engine.setMuted(false);
	});
});

describe("remote URL sources", () => {
	it("loads borrowed http(s) URLs without revoking them", () => {
		const revoked: string[] = [];
		const realRevoke = URL.revokeObjectURL.bind(URL);
		URL.revokeObjectURL = (url: string) => {
			revoked.push(url);
		};
		try {
			engine.loadSource(
				{ kind: "url", url: "https://cloud.example/a.mp3" },
				"remote-a",
			);
			expect(elements[0]?.src).toBe("https://cloud.example/a.mp3");
			// Replacing with a local file must not revoke the borrowed URL.
			engine.load(audioFile("b.mp3"), "local-b");
			expect(revoked).toEqual([]);
			// Owned blob: URLs still revoke on replacement.
			const owned = elements[0]?.src ?? "";
			expect(owned.startsWith("blob:")).toBe(true);
			engine.load(audioFile("c.mp3"), "local-c");
			expect(revoked).toEqual([owned]);
		} finally {
			URL.revokeObjectURL = realRevoke;
		}
	});

	it("preloads remote URLs and crossfades file → url → file", async () => {
		vi.useFakeTimers();
		engine.load(audioFile("a.mp3"), "track-a");
		await engine.play();
		engine.preloadSource(
			{ kind: "url", url: "https://cloud.example/b.mp3" },
			"track-b",
		);
		expect(engine.preloadedKey).toBe("track-b");
		const standby = elements[1];
		if (standby) standby.readyState = 4;
		const started = engine.beginCrossfade(2);
		const done = expect(started).resolves.toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		await done;
		expect(engine.getDebugState().active).toBe(1);
		expect(elements[1]?.src).toBe("https://cloud.example/b.mp3");
		vi.useRealTimers();
	});
});
