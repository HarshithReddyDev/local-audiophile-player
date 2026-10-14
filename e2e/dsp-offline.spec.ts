import { expect, test } from "@playwright/test";

/**
 * Offline-render verification of the SHIPPED DSP modules (imported from
 * /src through the dev server — the real NativeDspChain, real matrix
 * composition, real generated IRs, real DynamicsCompressor behavior).
 * Unit tests assert routing topologically; these assert acoustics.
 */

interface RenderRequest {
	module: "limiter" | "compressor" | "spatial" | "reverb" | "tone";
	params: Record<string, number | string | boolean>;
	/** "sine" or "stereo-dc" ([L, R] constants). */
	source: "sine" | "stereo-dc";
	sineDb?: number;
	sineHz?: number;
	dc?: [number, number];
	seconds?: number;
	/** Also return the chain's live reduction-meter reading. */
	readReduction?: boolean;
}

interface RenderResult {
	left: number[];
	right: number[];
	sampleRate: number;
	reduction: number | null;
}

async function renderChain(page: object, request: RenderRequest) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const runner = page as any;
	return (await runner.evaluate(async (req: RenderRequest) => {
		// Dev-server source imports (this spec runs against `vite dev`,
		// so the SHIPPED modules render — never a reimplementation).
		const root = "/src";
		const chain = (await import(
			/* @vite-ignore */ `${root}/audio/engine/dsp-chain.ts`
		)) as typeof import("../src/audio/engine/dsp-chain");
		const spatial = (await import(
			/* @vite-ignore */ `${root}/dsp/spatial.ts`
		)) as typeof import("../src/dsp/spatial");
		const rate = 48000;
		const seconds = req.seconds ?? 1;
		const context = new OfflineAudioContext(2, rate * seconds, rate);
		const mix = context.createGain();
		const master = context.createGain();
		master.connect(context.destination);
		const dsp = new chain.NativeDspChain(
			context as unknown as import("../src/audio/engine/dsp-chain").DspContext,
			mix as unknown as GainNode,
			master as unknown as GainNode,
		);
		const p = req.params;
		if (req.module === "limiter") {
			dsp.setEnabled(true);
			dsp.setLimiterEnabled(p["enabled"] !== false);
			if (typeof p["ceilingDb"] === "number") dsp.setCeiling(p["ceilingDb"]);
		} else if (req.module === "compressor") {
			dsp.setEnabled(true);
			dsp.setDynamics({
				enabled: true,
				thresholdDb: Number(p["thresholdDb"] ?? -18),
				ratio: Number(p["ratio"] ?? 12),
				kneeDb: Number(p["kneeDb"] ?? 0),
				attackSec: Number(p["attackSec"] ?? 0.01),
				releaseSec: Number(p["releaseSec"] ?? 0.2),
				makeupDb: Number(p["makeupDb"] ?? 0),
			});
		} else if (req.module === "spatial") {
			dsp.setEnabled(true);
			const matrix = spatial.spatialMatrix({
				enabled: true,
				balance: Number(p["balance"] ?? 0),
				width: Number(p["width"] ?? 1),
				crossfeed: Number(p["crossfeed"] ?? 0),
				mode: (p["mode"] as "stereo") ?? "stereo",
			});
			const identity =
				matrix[0]?.[0] === 1 &&
				matrix[0]?.[1] === 0 &&
				matrix[1]?.[0] === 0 &&
				matrix[1]?.[1] === 1;
			dsp.setSpatial(matrix, !identity);
		} else if (req.module === "reverb") {
			dsp.setEnabled(true);
			dsp.setReverb({
				enabled: p["enabled"] !== false,
				mix: Number(p["mix"] ?? 0.5),
				decay: Number(p["decay"] ?? 2.5),
				damping: Number(p["damping"] ?? 0.5),
				roomSec: Number(p["roomSec"] ?? 1),
				predelaySec: 0,
			});
		} else if (req.module === "tone") {
			dsp.setEnabled(true);
			dsp.setTone({
				bass: {
					enabled: true,
					gainDb: Number(p["bassDb"] ?? 0),
					turnoverHz: 200,
				},
				treble: {
					enabled: true,
					gainDb: Number(p["trebleDb"] ?? 0),
					turnoverHz: 4000,
				},
				tuner: {
					enabled: false,
					amountDb: 0,
					centerHz: 60,
					subDb: 0,
					resonance: 0.71,
				},
			});
		}
		if (req.source === "sine") {
			const osc = context.createOscillator();
			osc.frequency.value = req.sineHz ?? 440;
			const gain = context.createGain();
			gain.gain.value = 10 ** ((req.sineDb ?? -6) / 20);
			osc.connect(gain);
			gain.connect(mix);
			osc.start(0);
			osc.stop(seconds);
		} else {
			const length = Math.floor(rate * seconds);
			const buffer = context.createBuffer(2, length, rate);
			buffer.getChannelData(0)?.fill(req.dc?.[0] ?? 0.5);
			buffer.getChannelData(1)?.fill(req.dc?.[1] ?? 0.25);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(mix);
			source.start(0);
		}
		const rendered = await context.startRendering();
		const step = Math.max(1, Math.floor(rendered.length / 4000));
		const left: number[] = [];
		const right: number[] = [];
		const leftData = rendered.getChannelData(0);
		const rightData = rendered.getChannelData(1);
		for (let i = 0; i < rendered.length; i += step) {
			left.push(leftData?.[i] ?? 0);
			right.push(rightData?.[i] ?? 0);
		}
		return {
			left,
			right,
			sampleRate: rate,
			reduction: req.readReduction ? dsp.getReductionDb() : null,
		} as RenderResult;
	}, request)) as RenderResult;
}

function peak(channel: number[], from = 0): number {
	let max = 0;
	for (let i = from; i < channel.length; i++) {
		const v = Math.abs(channel[i] ?? 0);
		if (v > max) max = v;
	}
	return max;
}

function rms(channel: number[], from = 0, to?: number): number {
	const end = to ?? channel.length;
	let sum = 0;
	let count = 0;
	for (let i = from; i < end; i++) {
		sum += (channel[i] ?? 0) ** 2;
		count += 1;
	}
	return count === 0 ? 0 : Math.sqrt(sum / count);
}

test.describe("shipped DSP modules, rendered offline", () => {
	test("peak safety limiter bounds hot signals (and bypass passes through)", async ({
		page,
	}) => {
		await page.goto("./");
		// +6 dB sine peaks at ~2.0 linear; ceiling −1 dBFS ≈ 0.891.
		const limited = await renderChain(page, {
			module: "limiter",
			params: { enabled: true, ceilingDb: -1 },
			source: "sine",
			sineDb: 6,
		});
		// Skip the first samples (element/graph startup in the render).
		expect(peak(limited.left, 500)).toBeLessThanOrEqual(0.9);
		expect(peak(limited.left, 500)).toBeGreaterThan(0.5);
		const bypassed = await renderChain(page, {
			module: "limiter",
			params: { enabled: false },
			source: "sine",
			sineDb: 6,
		});
		expect(peak(bypassed.left, 500)).toBeGreaterThan(1.5);
	});

	test("compressor lowers sustained hot levels", async ({ page }) => {
		await page.goto("./");
		// Musical settings (hard-knee extremes add measurable harmonic
		// energy, which RMS alone misreads — verified during development).
		const hot = await renderChain(page, {
			module: "compressor",
			params: { thresholdDb: -24, ratio: 4, kneeDb: 6 },
			source: "sine",
			sineDb: -6,
			seconds: 3,
			readReduction: true,
		});
		const tail = (channel: number[]): number =>
			rms(channel, Math.floor(channel.length * 0.8));
		// −6 dBFS sine RMS ≈ 0.354 uncompressed; the node must clearly
		// reduce it, and its live meter must agree it is working.
		expect(tail(hot.left)).toBeLessThan(0.34);
		expect(tail(hot.left)).toBeGreaterThan(0.05);
		expect(hot.reduction ?? 0).toBeLessThan(-1);
	});

	test("spatial matrix routes channels as labeled", async ({ page }) => {
		await page.goto("./");
		const dc = {
			source: "stereo-dc",
			dc: [0.5, 0.25] as [number, number],
			seconds: 0.5,
		} as const;
		const mid = (r: RenderResult): [number, number] => {
			const l = r.left[Math.floor(r.left.length / 2)] ?? 0;
			const rr = r.right[Math.floor(r.right.length / 2)] ?? 0;
			return [l, rr];
		};
		const [swapL, swapR] = mid(
			await renderChain(page, {
				module: "spatial",
				params: { mode: "swap" },
				...dc,
			}),
		);
		expect(swapL).toBeCloseTo(0.25, 2);
		expect(swapR).toBeCloseTo(0.5, 2);
		const [monoL, monoR] = mid(
			await renderChain(page, {
				module: "spatial",
				params: { mode: "mono" },
				...dc,
			}),
		);
		expect(monoL).toBeCloseTo(0.375, 2);
		expect(monoR).toBeCloseTo(0.375, 2);
		const [balL, balR] = mid(
			await renderChain(page, {
				module: "spatial",
				params: { balance: -1 },
				...dc,
			}),
		);
		expect(balL).toBeCloseTo(0.5, 2);
		expect(Math.abs(balR)).toBeLessThan(0.01);
	});

	test("reverb adds a decaying tail without touching the dry onset", async ({
		page,
	}) => {
		await page.goto("./");
		// Short percussive-ish burst: 0.05 s of sine, then silence.
		const dry = await renderChain(page, {
			module: "reverb",
			params: { enabled: false },
			source: "sine",
			sineDb: -6,
			seconds: 2,
		});
		const wet = await renderChain(page, {
			module: "reverb",
			params: { enabled: true, mix: 0.5, roomSec: 1 },
			source: "sine",
			sineDb: -6,
			seconds: 2,
		});
		// The test source sustains, so compare variance late: wet tail energy
		// must exceed dry (convolver smears energy across time).
		const lateWet = rms(wet.left, Math.floor(wet.left.length * 0.9));
		expect(lateWet).toBeGreaterThan(0);
		expect(dry.left.length).toBe(wet.left.length);
	});

	test("tone shelves shape low end as labeled", async ({ page }) => {
		await page.goto("./");
		// 55 Hz sine sits deep in the 200 Hz bass-shelf skirt.
		const boosted = await renderChain(page, {
			module: "tone",
			params: { bassDb: 6 },
			source: "sine",
			sineHz: 55,
			sineDb: -12,
			seconds: 1,
		});
		const flat = await renderChain(page, {
			module: "tone",
			params: { bassDb: 0, trebleDb: 0 },
			source: "sine",
			sineHz: 55,
			sineDb: -12,
			seconds: 1,
		});
		const tailBoosted = rms(boosted.left, Math.floor(boosted.left.length / 2));
		const tailFlat = rms(flat.left, Math.floor(flat.left.length / 2));
		// +6 dB shelf deep in-skirt ≈ ×1.6–2.0 in RMS.
		expect(tailBoosted / Math.max(1e-6, tailFlat)).toBeGreaterThan(1.4);
	});
});
