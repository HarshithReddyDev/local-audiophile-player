import { beforeEach, describe, expect, it } from "vitest";
import { COMPRESSOR_DEFAULTS } from "../../dsp/dynamics";
import { sanitizeReverb } from "../../dsp/reverb";
import {
	BASS_DEFAULTS,
	BASS_TUNER_DEFAULTS,
	TREBLE_DEFAULTS,
} from "../../dsp/tone";
import {
	type DspContext,
	generateImpulseResponse,
	NativeDspChain,
} from "./dsp-chain";

/** Recording fake nodes: routing assertions without audio hardware. */
interface FakeNode {
	name: string;
	outgoing: string[];
	params: Record<string, number>;
	buffer: unknown;
}

function makeParam(store: Record<string, number>, key: string) {
	return {
		get value() {
			return store[key] ?? 0;
		},
		set value(v: number) {
			store[key] = v;
		},
		setTargetAtTime: (v: number) => {
			store[key] = v;
		},
		setValueAtTime: (v: number) => {
			store[key] = v;
		},
		cancelScheduledValues: () => undefined,
	};
}

let counter = 0;

function fakeNode(kind: string): FakeNode & Record<string, unknown> {
	const id = `${kind}-${counter++}`;
	const params: Record<string, number> = {};
	const node: FakeNode & Record<string, unknown> = {
		name: id,
		outgoing: [],
		params,
		buffer: null,
		connect: (dest: unknown) => {
			const target = dest as FakeNode | undefined;
			node.outgoing.push(
				target && typeof target === "object" && "name" in target
					? String(target.name)
					: "?",
			);
		},
		disconnect: () => {
			node.outgoing = [];
		},
		gain: makeParam(params, "gain"),
		frequency: makeParam(params, "frequency"),
		Q: makeParam(params, "Q"),
		threshold: makeParam(params, "threshold"),
		ratio: makeParam(params, "ratio"),
		knee: makeParam(params, "knee"),
		attack: makeParam(params, "attack"),
		release: makeParam(params, "release"),
		delayTime: makeParam(params, "delayTime"),
		reduction: -3,
		curve: null,
		oversample: "none",
		type: "peaking",
	};
	return node;
}

function fakeContext(): DspContext & {
	nodes: (FakeNode & Record<string, unknown>)[];
} {
	const nodes: (FakeNode & Record<string, unknown>)[] = [];
	const track = <T extends FakeNode & Record<string, unknown>>(node: T): T => {
		nodes.push(node);
		return node;
	};
	return {
		nodes,
		sampleRate: 48000,
		currentTime: 0,
		createGain: () => track(fakeNode("gain")),
		createBiquadFilter: () => track(fakeNode("biquad")),
		createWaveShaper: () => track(fakeNode("shaper")),
		createDynamicsCompressor: () => track(fakeNode("comp")),
		createChannelSplitter: () => track(fakeNode("splitter")),
		createChannelMerger: () => track(fakeNode("merger")),
		createConvolver: () => track(fakeNode("convolver")),
		createDelay: () => track(fakeNode("delay")),
		createBuffer: (channels: number, length: number) => {
			const data: Float32Array[] = [];
			for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
			return {
				getChannelData: (ch: number) => data[ch] ?? null,
			} as unknown as AudioBuffer;
		},
	} as unknown as DspContext & {
		nodes: (FakeNode & Record<string, unknown>)[];
	};
}

function chain() {
	const context = fakeContext();
	const byName = (prefix: string) =>
		context.nodes.filter((n) => n.name.startsWith(prefix));
	const mix = byName("mix");
	const master = byName("master");
	const contextWithIO = context as unknown as DspContext;
	// Mix/master are plain gains owned by the test harness.
	const mixNode = fakeNode("mix");
	const masterNode = fakeNode("master");
	context.nodes.push(mixNode, masterNode);
	const dsp = new NativeDspChain(
		contextWithIO,
		mixNode as unknown as GainNode,
		masterNode as unknown as GainNode,
	);
	void mix;
	void master;
	return { context, dsp, mixNode, masterNode };
}

function outgoingNames(node: FakeNode): string[] {
	return [...node.outgoing].sort();
}

describe("dsp chain routing", () => {
	beforeEach(() => {
		counter = 0;
	});

	it("bypasses everything to mix→master when disabled", () => {
		const { dsp, mixNode, masterNode } = chain();
		expect(dsp.isEnabled).toBe(false);
		expect(dsp.isWired).toBe(false);
		expect(outgoingNames(mixNode)).toEqual([masterNode.name]);
		// Limiter shaper must not be in the bypass path.
		expect(masterNode.outgoing).toEqual([]);
	});

	it("routes preamp→pool→limiter→master with PEQ only", () => {
		const { context, dsp, mixNode, masterNode } = chain();
		dsp.setEnabled(true);
		dsp.setBands([
			{ type: "peaking", frequency: 1000, gain: 3, q: 1, enabled: true },
		]);
		expect(dsp.isWired).toBe(true);
		const names = (prefix: string) =>
			context.nodes.filter((n) => n.name.startsWith(prefix)).map((n) => n.name);
		const preamp = names("gain")[0]!;
		const biquads = names("biquad");
		const shaper = names("shaper")[0]!;
		expect(outgoingNames(mixNode)).toEqual([preamp]);
		// Bypassed modules go nowhere downstream. (Fixed internal wiring
		// persists by design; exclusion is proven at the module boundary:
		// nothing feeds the module, the module feeds nothing.)
		const comp = names("comp")[0]!;
		const merger = names("merger")[0]!;
		const wet = names("gain")
			.map((n) => context.nodes.find((m) => m.name === n)!)
			.filter((n) => n.outgoing.length === 0);
		expect(context.nodes.find((n) => n.name === comp)?.outgoing ?? []).toEqual(
			[],
		);
		expect(
			context.nodes.find((n) => n.name === merger)?.outgoing ?? [],
		).toEqual([]);
		expect(wet.length).toBeGreaterThan(0);
		expect(biquads.length).toBeGreaterThanOrEqual(1);
		expect(
			context.nodes.find((n) => n.name === biquads[biquads.length - 1])
				?.outgoing,
		).toEqual([shaper]);
		expect(context.nodes.find((n) => n.name === shaper)?.outgoing).toEqual([
			masterNode.name,
		]);
	});

	it("inserts tone stages only when non-neutral", () => {
		const { dsp, context } = chain();
		dsp.setEnabled(true);
		const toneCount = () =>
			context.nodes.filter(
				(n) =>
					n.name.startsWith("biquad") &&
					(n as unknown as { type?: string }).type !== undefined &&
					Number((n.params as Record<string, number>)["gain"] ?? 0) !== 0,
			).length;
		expect(toneCount()).toBe(0);
		dsp.setTone({
			bass: { ...BASS_DEFAULTS, enabled: true, gainDb: 4 },
			treble: { ...TREBLE_DEFAULTS },
			tuner: { ...BASS_TUNER_DEFAULTS },
		});
		expect(toneCount()).toBe(1);
	});

	it("excludes the limiter shaper when disabled (no self-connection)", () => {
		const { dsp, mixNode, masterNode, context } = chain();
		dsp.setEnabled(true);
		dsp.setLimiterEnabled(false);
		expect(dsp.isLimiterEnabled).toBe(false);
		const shaper = context.nodes.find((n) => n.name.startsWith("shaper"))!;
		expect(shaper.outgoing).toEqual([]);
		// Master must never connect to itself.
		expect(masterNode.outgoing).not.toContain(masterNode.name);
		expect(mixNode.outgoing.length).toBeGreaterThan(0);
	});

	it("wires the spatial matrix and sets the four gains", () => {
		const { dsp, context } = chain();
		dsp.setEnabled(true);
		dsp.setSpatial(
			[
				[0, 1],
				[1, 0],
			],
			true,
		);
		const splitter = context.nodes.find((n) => n.name.startsWith("splitter"))!;
		expect(splitter.outgoing.length).toBe(4);
		// Swap matrix: ll=0, lr=1, rl=1, rr=0 in [ll,lr,rl,rr] order.
		// The four matrix gains are exactly the splitter's fan-out targets.
		const matrixGains = splitter.outgoing.map(
			(name) =>
				(
					context.nodes.find((n) => n.name === name)?.params as
						| Record<string, number>
						| undefined
				)?.["gain"],
		);
		expect(matrixGains).toEqual([0, 1, 1, 0]);
		dsp.setSpatial(
			[
				[1, 0],
				[0, 1],
			],
			false,
		);
		const merger = context.nodes.find((n) => n.name.startsWith("merger"))!;
		expect(merger.outgoing).toEqual([]);
	});

	it("builds the parallel wet branch only when reverb is on", () => {
		const { dsp, context } = chain();
		dsp.setEnabled(true);
		const wet = context.nodes.filter((n) => n.name.startsWith("gain")).pop()!;
		expect(wet.outgoing).toEqual([]);
		dsp.setReverb({
			...sanitizeReverb({
				enabled: true,
				mix: 0.3,
				decay: 2.5,
				damping: 0.5,
				roomSec: 0.5,
				predelaySec: 0.01,
			}),
		});
		expect(wet.outgoing.length).toBe(1);
		dsp.setReverb({
			...sanitizeReverb({
				enabled: false,
				mix: 0.3,
				decay: 2.5,
				damping: 0.5,
				roomSec: 0.5,
				predelaySec: 0.01,
			}),
		});
		expect(wet.outgoing).toEqual([]);
	});

	it("applies dynamics params to the compressor node", () => {
		const { dsp, context } = chain();
		dsp.setEnabled(true);
		dsp.setDynamics({
			...COMPRESSOR_DEFAULTS,
			enabled: true,
			thresholdDb: -12,
			ratio: 4,
		});
		const comp = context.nodes.find((n) => n.name.startsWith("comp"))!;
		const params = comp.params as Record<string, number>;
		expect(params["threshold"]).toBe(-12);
		expect(params["ratio"]).toBe(4);
		expect(dsp.getReductionDb()).toBe(-3);
		dsp.setDynamics({ ...COMPRESSOR_DEFAULTS, enabled: false });
		expect(dsp.getReductionDb()).toBeNull();
		expect(comp.outgoing).toEqual([]);
	});
});

describe("generated impulse responses", () => {
	it("is deterministic, stereo, decaying, and damping-aware", () => {
		const context = fakeContext();
		const params = sanitizeReverb({
			enabled: true,
			mix: 0.3,
			decay: 3,
			damping: 0.5,
			roomSec: 0.5,
			predelaySec: 0,
		});
		const a = generateImpulseResponse(context, params);
		const b = generateImpulseResponse(context, params);
		const left = a.getChannelData(0);
		const right = a.getChannelData(1);
		expect(left?.length).toBe(24000);
		// Deterministic rebuild.
		expect(left?.[1000]).toBe(b.getChannelData(0)?.[1000]);
		// Decaying envelope: early energy dwarfs late energy.
		let early = 0;
		let late = 0;
		for (let i = 0; i < 1000; i++) early += Math.abs(left?.[i] ?? 0);
		for (let i = 23000; i < 24000; i++) late += Math.abs(left?.[i] ?? 0);
		expect(early).toBeGreaterThan(late * 5);
		// Stereo channels differ (independent noise draws).
		expect(left?.[10]).not.toBe(right?.[10]);
		// Darker damping smooths more (lower variance).
		const dark = generateImpulseResponse(context, { ...params, damping: 0 });
		const bright = generateImpulseResponse(context, { ...params, damping: 1 });
		const variance = (buffer: AudioBuffer): number => {
			const data = buffer.getChannelData(0);
			let mean = 0;
			const n = Math.min(4000, data?.length ?? 0);
			for (let i = 0; i < n; i++) mean += Math.abs(data?.[i] ?? 0);
			mean /= Math.max(1, n);
			let variance = 0;
			for (let i = 0; i < n; i++)
				variance += (Math.abs(data?.[i] ?? 0) - mean) ** 2;
			return variance / Math.max(1, n);
		};
		expect(variance(dark)).toBeLessThan(variance(bright));
	});

	it("sanitizes reverb params", () => {
		const clean = sanitizeReverb({
			enabled: true,
			mix: 99,
			decay: -1,
			damping: 2,
			roomSec: 99,
			predelaySec: -1,
		});
		expect(clean).toMatchObject({
			mix: 1,
			decay: 0.5,
			damping: 1,
			roomSec: 3,
			predelaySec: 0,
		});
	});
});
