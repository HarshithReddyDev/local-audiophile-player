import { describe, expect, it } from "vitest";
import type { FitResult } from "../dsp/autoeq";
import type { AutoEQInput } from "../iem/types";
import { AutoEQCancelled, runAutoEQFit } from "./autoeq-client";

/** Scriptable stand-in for a Web Worker. */
class FakeWorker {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	terminated = false;
	posted: unknown[] = [];
	postMessage(message: unknown): void {
		this.posted.push(message);
	}
	terminate(): void {
		this.terminated = true;
	}
	emit(data: unknown): void {
		this.onmessage?.({ data });
	}
}

const INPUT: AutoEQInput = {
	measurement: { frequencies: [20, 1000, 20000], gains: [0, 0, 0] },
	target: { frequencies: [20, 1000, 20000], gains: [0, 0, 0] },
	frequencyRange: { min: 20, max: 20000 },
	fittingOptions: { maxBands: 4, maxGainDb: 12, preferParametric: true },
};

function fakeResult(): FitResult {
	return {
		profile: { version: 1, preamp: 0, enabled: true, bands: [] },
		metrics: {
			rmsBeforeDb: 1,
			rmsAfterDb: 0.1,
			maxAbsAfterDb: 0.2,
			p95AfterDb: 0.15,
			bands: 0,
			maxBoostDb: 0,
			maxCutDb: 0,
			preampDb: 0,
			gridPoints: 160,
			rangeHz: [20, 20000],
			sweeps: 1,
			optimizerVersion: 1,
			elapsedMs: 5,
			cancelled: false,
			hfTreatment: "average",
		},
	};
}

describe("autoeq worker client", () => {
	it("forwards progress and resolves results", async () => {
		let worker!: FakeWorker;
		const seen: string[] = [];
		const handle = runAutoEQFit(
			INPUT,
			{},
			(p) => seen.push(`${p.stage}:${p.done}/${p.total}`),
			{
				createWorker: () => {
					worker = new FakeWorker();
					return Promise.resolve(worker as unknown as Worker);
				},
			},
		);
		await Promise.resolve();
		expect(worker.posted).toHaveLength(1);
		worker.emit({
			id: "wrong-id",
			type: "progress",
			stage: "placing",
			done: 1,
			total: 2,
		});
		expect(seen).toEqual([]);
		worker.emit({
			id: (worker.posted[0] as { id: string }).id,
			type: "progress",
			stage: "placing",
			done: 1,
			total: 2,
		});
		expect(seen).toEqual(["placing:1/2"]);
		worker.emit({
			id: (worker.posted[0] as { id: string }).id,
			type: "result",
			result: fakeResult(),
		});
		const result = await handle.promise;
		expect(result.metrics.rmsAfterDb).toBe(0.1);
		expect(worker.terminated).toBe(true);
	});

	it("cancels in-flight fits and terminates the worker", async () => {
		let worker!: FakeWorker;
		const handle = runAutoEQFit(INPUT, {}, undefined, {
			createWorker: () => {
				worker = new FakeWorker();
				return Promise.resolve(worker as unknown as Worker);
			},
		});
		await Promise.resolve();
		handle.cancel();
		await expect(handle.promise).rejects.toBeInstanceOf(AutoEQCancelled);
		expect(worker.terminated).toBe(true);
		// Late messages after cancel are dropped (promise already settled).
		worker.emit({
			id: (worker.posted[0] as { id: string }).id,
			type: "result",
			result: fakeResult(),
		});
	});

	it("maps worker errors to Error with the message", async () => {
		let worker!: FakeWorker;
		const handle = runAutoEQFit(INPUT, {}, undefined, {
			createWorker: () => {
				worker = new FakeWorker();
				return Promise.resolve(worker as unknown as Worker);
			},
		});
		await Promise.resolve();
		worker.emit({
			id: (worker.posted[0] as { id: string }).id,
			type: "error",
			message: "Need ≥1 octave.",
		});
		await expect(handle.promise).rejects.toThrow("Need ≥1 octave.");
	});

	it("reports worker construction failure explicitly", async () => {
		const handle = runAutoEQFit(INPUT, {}, undefined, {
			createWorker: () => Promise.reject(new Error("no workers here")),
		});
		await expect(handle.promise).rejects.toThrow(
			/Web Workers may be unavailable/,
		);
	});
});
