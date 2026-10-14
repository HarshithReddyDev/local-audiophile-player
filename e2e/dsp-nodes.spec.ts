import { expect, test } from "@playwright/test";

/**
 * Native-node equivalence: BiquadFilterNode.getFrequencyResponse() must agree
 * with the RBJ cookbook (transcribed independently in-spec from the W3C
 * NOTE-audio-eq-cookbook) within a tight tolerance. Together with the unit
 * tests (pure core vs the same cookbook), this transitively proves the pure
 * response engine predicts what the user hears — without shipping test hooks.
 */

interface Coeffs {
	b0: number;
	b1: number;
	b2: number;
	a0: number;
	a1: number;
	a2: number;
}

function rbj(
	type: string,
	frequency: number,
	gainDb: number,
	q: number,
	fs: number,
): Coeffs {
	const A = 10 ** (gainDb / 40);
	const w0 = (2 * Math.PI * frequency) / fs;
	const cosW = Math.cos(w0);
	const sinW = Math.sin(w0);
	const alpha = sinW / (2 * q);
	// Web Audio spec §1.13.5: LPF/HPF use dB-scaled Q (see docs/dsp-research.md).
	const alphaQdB = sinW / (2 * 10 ** (q / 20));
	const shelfAlpha = (sinW / 2) * Math.SQRT2;
	switch (type) {
		case "peaking":
			return {
				b0: 1 + alpha * A,
				b1: -2 * cosW,
				b2: 1 - alpha * A,
				a0: 1 + alpha / A,
				a1: -2 * cosW,
				a2: 1 - alpha / A,
			};
		case "lowshelf": {
			const sA = Math.sqrt(A);
			const t = 2 * sA * shelfAlpha;
			return {
				b0: A * (A + 1 - (A - 1) * cosW + t),
				b1: 2 * A * (A - 1 - (A + 1) * cosW),
				b2: A * (A + 1 - (A - 1) * cosW - t),
				a0: A + 1 + (A - 1) * cosW + t,
				a1: -2 * (A - 1 + (A + 1) * cosW),
				a2: A + 1 + (A - 1) * cosW - t,
			};
		}
		case "highpass": {
			const half = (1 + cosW) / 2;
			return {
				b0: half,
				b1: -(1 + cosW),
				b2: half,
				a0: 1 + alphaQdB,
				a1: -2 * cosW,
				a2: 1 - alphaQdB,
			};
		}
		case "lowpass": {
			const half = (1 - cosW) / 2;
			return {
				b0: half,
				b1: 1 - cosW,
				b2: half,
				a0: 1 + alphaQdB,
				a1: -2 * cosW,
				a2: 1 - alphaQdB,
			};
		}
		default:
			throw new Error(`unsupported ${type}`);
	}
}

function magnitudeDb(c: Coeffs, f: number, fs: number): number {
	const w = (2 * Math.PI * f) / fs;
	const numRe = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w);
	const numIm = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w));
	const denRe = c.a0 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w);
	const denIm = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
	return 10 * Math.log10((numRe ** 2 + numIm ** 2) / (denRe ** 2 + denIm ** 2));
}

async function nodeResponse(
	type: string,
	frequency: number,
	gainDb: number,
	q: number,
	freqs: number[],
): Promise<{ db: number[]; sampleRate: number }> {
	// Runs in Node via Playwright's bundled Chromium through evaluate on a
	// blank page: real BiquadFilterNode, no app code involved.
	const { chromium } = await import("@playwright/test");
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto("about:blank");
		return await page.evaluate(
			([t, f, g, qq, list]) => {
				const ctx = new OfflineAudioContext(1, 1, 48000);
				const node = ctx.createBiquadFilter();
				node.type = t as BiquadFilterType;
				node.frequency.value = f;
				node.gain.value = g;
				node.Q.value = qq;
				const freq = new Float32Array(list as number[]);
				const mag = new Float32Array(freq.length);
				const phase = new Float32Array(freq.length);
				node.getFrequencyResponse(freq, mag, phase);
				return {
					db: [...mag].map((m) => 20 * Math.log10(Math.max(1e-12, m))),
					sampleRate: ctx.sampleRate,
				};
			},
			[type, frequency, gainDb, q, freqs] as const,
		);
	} finally {
		await browser.close();
	}
}

test.describe("native node equivalence", () => {
	test("peaking node matches the cookbook", async () => {
		const freqs = [40, 100, 500, 1000, 2000, 5000, 10000, 18000];
		const { db, sampleRate } = await nodeResponse("peaking", 1000, 6, 1, freqs);
		const expected = rbj("peaking", 1000, 6, 1, sampleRate);
		freqs.forEach((f, i) => {
			expect(
				Math.abs((db[i] ?? 0) - magnitudeDb(expected, f, sampleRate)),
			).toBeLessThan(0.25);
		});
		expect(db[freqs.indexOf(1000)] ?? 0).toBeCloseTo(6, 0);
	});

	test("lowshelf node matches the cookbook", async () => {
		const freqs = [30, 100, 500, 2000, 10000, 20000];
		const { db, sampleRate } = await nodeResponse("lowshelf", 200, 6, 1, freqs);
		const expected = rbj("lowshelf", 200, 6, 1, sampleRate);
		freqs.forEach((f, i) => {
			expect(
				Math.abs((db[i] ?? 0) - magnitudeDb(expected, f, sampleRate)),
			).toBeLessThan(0.25);
		});
	});

	test("highpass node matches the spec convention", async () => {
		const freqs = [50, 200, 1000, 5000, 15000];
		const { db, sampleRate } = await nodeResponse(
			"highpass",
			1000,
			0,
			0.7071,
			freqs,
		);
		const expected = rbj("highpass", 1000, 0, 0.7071, sampleRate);
		freqs.forEach((f, i) => {
			expect(
				Math.abs((db[i] ?? 0) - magnitudeDb(expected, f, sampleRate)),
			).toBeLessThan(0.3);
		});
	});

	test("lowpass node matches the spec convention", async () => {
		const freqs = [50, 500, 1000, 5000, 15000];
		const { db, sampleRate } = await nodeResponse(
			"lowpass",
			1000,
			0,
			0.7071,
			freqs,
		);
		const expected = rbj("lowpass", 1000, 0, 0.7071, sampleRate);
		freqs.forEach((f, i) => {
			expect(
				Math.abs((db[i] ?? 0) - magnitudeDb(expected, f, sampleRate)),
			).toBeLessThan(0.3);
		});
	});

	test("flat peaking chain is a wire", async () => {
		const freqs = [100, 1000, 10000];
		const { db } = await nodeResponse("peaking", 1000, 0, 1, freqs);
		for (const v of db) expect(Math.abs(v)).toBeLessThan(0.01);
	});
});
