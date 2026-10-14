/**
 * Native DSP graph: modular processors between mix and master.
 *
 * Fixed, documented order (see docs/audio-engine.md):
 *
 *   mix → preamp → PEQ pool → tone shelves → dynamics → spatial →
 *   reverb send ─┐
 *                ├→ limiter → master
 *   reverb ──────┘ (parallel wet branch, dry stays latency-free)
 *
 * Why native (see docs/dsp-research.md): cookbook-identical biquads,
 * audio-thread C++, zero added latency on the dry path, a-rate
 * zipper-free updates, Baseline-2015 compat. Every module has
 * enable/bypass (bypass rebuilds routing around the module — no
 * unity-gain pretense), validated params, stable defaults, and
 * deterministic rebuilds. No AudioWorklet: DynamicsCompressorNode and
 * ConvolverNode cover dynamics and reverb with no measured gap
 * (documented in audio-engine.md §validation-gates).
 */

import type { CompressorParams } from "../../dsp/dynamics";
import { COMPRESSOR_DEFAULTS } from "../../dsp/dynamics";
import type { Matrix2x2 } from "../../dsp/spatial";
import type { BassTone, BassTuner, TrebleTone } from "../../dsp/tone";
import {
	BASS_DEFAULTS,
	BASS_TUNER_DEFAULTS,
	TREBLE_DEFAULTS,
} from "../../dsp/tone";

export interface DspBandParams {
	type: BiquadFilterType;
	frequency: number;
	gain: number;
	q: number;
	enabled: boolean;
}

export interface ToneParams {
	bass: BassTone;
	treble: TrebleTone;
	tuner: BassTuner;
}

import type { ReverbParams } from "../../dsp/reverb";
import { REVERB_DEFAULTS, sanitizeReverb } from "../../dsp/reverb";

export type { ReverbParams } from "../../dsp/reverb";

/** Audible smoothing for live parameter drags (no zipper noise, no lag). */
const PARAM_TC = 0.015;
/** Structural PEQ pool cap (UI caps lower). */
const MAX_NODES = 24;
/** Tone stages: bass shelf, treble shelf, tuner shelf, tuner peak. */
const TONE_NODES = 4;

/** Minimal node-factory surface (real AudioContext satisfies it). */
export interface DspContext {
	readonly sampleRate: number;
	readonly currentTime: number;
	createGain(): GainNode;
	createBiquadFilter(): BiquadFilterNode;
	createWaveShaper(): WaveShaperNode;
	createDynamicsCompressor(): DynamicsCompressorNode;
	createChannelSplitter(numberOfOutputs: number): ChannelSplitterNode;
	createChannelMerger(numberOfInputs: number): ChannelMergerNode;
	createConvolver(): ConvolverNode;
	createDelay(maxDelayTime?: number): DelayNode;
	createBuffer(
		numberOfChannels: number,
		length: number,
		sampleRate: number,
	): AudioBuffer;
}

function hardClipCurve(
	ceiling: number,
	points = 1024,
): Float32Array<ArrayBuffer> {
	const curve = new Float32Array(new ArrayBuffer(points * 4));
	for (let i = 0; i < points; i++) {
		const x = (i / (points - 1)) * 2 - 1;
		curve[i] = Math.min(ceiling, Math.max(-ceiling, x));
	}
	return curve;
}

function setSmoothed(param: AudioParam, value: number, t: number): void {
	param.setTargetAtTime(value, t, PARAM_TC);
}

/**
 * Locally generated stereo room impulse: exponentially decaying noise
 * with a progressive one-pole lowpass (damping). Generated on demand —
 * no bundled IR files, no licensing questions, fully deterministic for
 * identical params (seeded PRNG).
 */
export function generateImpulseResponse(
	context: DspContext,
	params: ReverbParams,
): AudioBuffer {
	const p = sanitizeReverb(params);
	const length = Math.max(1, Math.floor(p.roomSec * context.sampleRate));
	const buffer = context.createBuffer(2, length, context.sampleRate);
	// Deterministic seed so identical params rebuild identical IRs.
	let seed = 0x9e3779b9;
	const random = (): number => {
		seed = (Math.imul(seed ^ (seed >>> 15), 0x85ebca6b) >>> 0) & 0xffffffff;
		seed = (Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35) >>> 0) & 0xffffffff;
		seed ^= seed >>> 16;
		return (seed >>> 0) / 0xffffffff - 0.5;
	};
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		if (!data) continue;
		let lowpassed = 0;
		// Damping 0 → heavy smoothing (dark), 1 → nearly raw (bright).
		const smooth = 1 - p.damping * 0.985;
		for (let i = 0; i < length; i++) {
			const t = i / context.sampleRate;
			const envelope = Math.exp(-t * p.decay * 2);
			lowpassed = lowpassed * smooth + random() * (1 - smooth);
			data[i] = lowpassed * envelope;
		}
	}
	return buffer;
}

export class NativeDspChain {
	private preamp: GainNode;
	private shaper: WaveShaperNode;
	private pool: BiquadFilterNode[] = [];
	private toneNodes: BiquadFilterNode[] = [];
	private compressor: DynamicsCompressorNode;
	private makeup: GainNode;
	private splitter: ChannelSplitterNode;
	private spatialGains: [GainNode, GainNode, GainNode, GainNode];
	private merger: ChannelMergerNode;
	private reverbSend: GainNode;
	private predelay: DelayNode;
	private convolver: ConvolverNode;
	private wet: GainNode;
	private enabled = false;
	private limiterEnabled = true;
	private wired = false;
	private ceilingDb = -1;
	private tone: ToneParams = {
		bass: { ...BASS_DEFAULTS },
		treble: { ...TREBLE_DEFAULTS },
		tuner: { ...BASS_TUNER_DEFAULTS },
	};
	private dynamics: CompressorParams = { ...COMPRESSOR_DEFAULTS };
	private matrix: Matrix2x2 = [
		[1, 0],
		[0, 1],
	];
	private spatialActive = false;
	private reverb: ReverbParams = { ...REVERB_DEFAULTS };

	constructor(
		private context: DspContext,
		private mix: GainNode,
		private master: GainNode,
	) {
		this.preamp = context.createGain();
		this.shaper = context.createWaveShaper();
		this.shaper.oversample = "none";
		this.shaper.curve = hardClipCurve(10 ** (this.ceilingDb / 20));
		this.compressor = context.createDynamicsCompressor();
		this.makeup = context.createGain();
		this.applyDynamicsParams();
		this.splitter = context.createChannelSplitter(2);
		this.spatialGains = [
			context.createGain(),
			context.createGain(),
			context.createGain(),
			context.createGain(),
		];
		this.merger = context.createChannelMerger(2);
		// Internal spatial + reverb wiring is (re-)established in rewire().
		for (let i = 0; i < TONE_NODES; i++) {
			this.toneNodes.push(context.createBiquadFilter());
		}
		this.applyToneParams();
		this.reverbSend = context.createGain();
		this.predelay = context.createDelay(0.5);
		this.convolver = context.createConvolver();
		this.wet = context.createGain();
		this.applyReverbParams();
		this.rewire();
	}

	get isEnabled(): boolean {
		return this.enabled;
	}

	get nodeCount(): number {
		return this.pool.length;
	}

	get isLimiterEnabled(): boolean {
		return this.limiterEnabled;
	}

	setEnabled(on: boolean): void {
		if (on === this.enabled) return;
		this.enabled = on;
		this.rewire();
	}

	setLimiterEnabled(on: boolean): void {
		if (on === this.limiterEnabled) return;
		this.limiterEnabled = on;
		this.rewire();
	}

	setCeiling(db: number): void {
		const clamped = Number.isFinite(db) ? Math.min(0, Math.max(-12, db)) : -1;
		if (clamped === this.ceilingDb) return;
		this.ceilingDb = clamped;
		this.shaper.curve = hardClipCurve(10 ** (clamped / 20));
	}

	setPreamp(db: number): void {
		const gain = Number.isFinite(db) ? 10 ** (db / 20) : 1;
		setSmoothed(this.preamp.gain, gain, this.context.currentTime);
	}

	/**
	 * Reconcile band nodes with the profile: grow the pool as needed, map
	 * params 1:1 (our FilterType strings match BiquadFilterType exactly),
	 * park unused nodes at unity instead of destroying them.
	 */
	setBands(bands: DspBandParams[]): void {
		const active = bands.filter((b) => b.enabled).slice(0, MAX_NODES);
		while (this.pool.length < active.length) {
			const node = this.context.createBiquadFilter();
			this.pool.push(node);
		}
		const t = this.context.currentTime;
		for (let i = 0; i < this.pool.length; i++) {
			const node = this.pool[i];
			const band = active[i];
			if (!node) continue;
			if (!band) {
				// Parked: peaking at 0 dB is a flat wire.
				node.type = "peaking";
				setSmoothed(node.frequency, 1000, t);
				setSmoothed(node.gain, 0, t);
				setSmoothed(node.Q, 1, t);
				continue;
			}
			node.type = band.type;
			setSmoothed(node.frequency, band.frequency, t);
			setSmoothed(node.Q, band.q, t);
			setSmoothed(node.gain, band.gain, t);
		}
		this.rewire();
	}

	/**
	 * Tone stages: [bass shelf, treble shelf, tuner shelf, tuner peak].
	 * Neutral stages park at unity; the module drops out of routing when
	 * all four are neutral.
	 */
	setTone(tone: ToneParams): void {
		this.tone = {
			bass: { ...tone.bass },
			treble: { ...tone.treble },
			tuner: { ...tone.tuner },
		};
		this.applyToneParams();
		this.rewire();
	}

	private toneBandAt(index: number): DspBandParams | null {
		const { bass, treble, tuner } = this.tone;
		switch (index) {
			case 0:
				return bass.enabled && bass.gainDb !== 0
					? {
							type: "lowshelf",
							frequency: bass.turnoverHz,
							gain: bass.gainDb,
							q: 0.71,
							enabled: true,
						}
					: null;
			case 1:
				return treble.enabled && treble.gainDb !== 0
					? {
							type: "highshelf",
							frequency: treble.turnoverHz,
							gain: treble.gainDb,
							q: 0.71,
							enabled: true,
						}
					: null;
			case 2:
				return tuner.enabled && tuner.amountDb > 0
					? {
							type: "lowshelf",
							frequency: tuner.centerHz,
							gain: tuner.amountDb,
							q: 0.71,
							enabled: true,
						}
					: null;
			case 3:
				return tuner.enabled && tuner.subDb > 0
					? {
							type: "peaking",
							frequency: Math.max(20, tuner.centerHz / 2),
							gain: tuner.subDb,
							q: tuner.resonance,
							enabled: true,
						}
					: null;
			default:
				return null;
		}
	}

	private toneActive(): boolean {
		for (let i = 0; i < TONE_NODES; i++) {
			if (this.toneBandAt(i) !== null) return true;
		}
		return false;
	}

	private applyToneParams(): void {
		const t = this.context.currentTime;
		for (let i = 0; i < this.toneNodes.length; i++) {
			const node = this.toneNodes[i];
			const band = this.toneBandAt(i);
			if (!node) continue;
			if (!band) {
				node.type = "peaking";
				setSmoothed(node.frequency, 1000, t);
				setSmoothed(node.gain, 0, t);
				setSmoothed(node.Q, 1, t);
				continue;
			}
			node.type = band.type;
			setSmoothed(node.frequency, band.frequency, t);
			setSmoothed(node.Q, band.q, t);
			setSmoothed(node.gain, band.gain, t);
		}
	}

	setDynamics(params: CompressorParams): void {
		this.dynamics = { ...params };
		this.applyDynamicsParams();
		this.rewire();
	}

	private applyDynamicsParams(): void {
		const p = this.dynamics;
		const t = this.context.currentTime;
		setSmoothed(this.compressor.threshold, p.thresholdDb, t);
		setSmoothed(this.compressor.ratio, Math.max(1, p.ratio), t);
		setSmoothed(this.compressor.knee, p.kneeDb, t);
		setSmoothed(this.compressor.attack, p.attackSec, t);
		setSmoothed(this.compressor.release, p.releaseSec, t);
		setSmoothed(this.makeup.gain, 10 ** (p.makeupDb / 20), t);
	}

	/** Live gain reduction in dB (≤ 0), or null when bypassed. */
	getReductionDb(): number | null {
		if (!this.enabled || !this.dynamics.enabled) return null;
		const reduction = this.compressor.reduction;
		return Number.isFinite(reduction) ? Math.min(0, reduction) : 0;
	}

	/**
	 * Spatial matrix ( pre-composed 2×2, see dsp/spatial.ts ). Identity
	 * matrices route around the splitter network entirely.
	 */
	setSpatial(matrix: Matrix2x2, active: boolean): void {
		this.matrix = [
			[matrix[0]?.[0] ?? 1, matrix[0]?.[1] ?? 0],
			[matrix[1]?.[0] ?? 0, matrix[1]?.[1] ?? 1],
		];
		this.spatialActive = active;
		const t = this.context.currentTime;
		const gains = [
			this.matrix[0]?.[0] ?? 1,
			this.matrix[0]?.[1] ?? 0,
			this.matrix[1]?.[0] ?? 0,
			this.matrix[1]?.[1] ?? 1,
		];
		for (let i = 0; i < this.spatialGains.length; i++) {
			const node = this.spatialGains[i];
			if (node) setSmoothed(node.gain, gains[i] ?? 0, t);
		}
		this.rewire();
	}

	setReverb(params: ReverbParams): void {
		const changed =
			Math.abs(params.roomSec - this.reverb.roomSec) > 1e-9 ||
			Math.abs(params.decay - this.reverb.decay) > 1e-9 ||
			Math.abs(params.damping - this.reverb.damping) > 1e-9;
		this.reverb = { ...params };
		this.applyReverbParams(changed);
		this.rewire();
	}

	private applyReverbParams(regenerate = true): void {
		const t = this.context.currentTime;
		if (regenerate) {
			try {
				this.convolver.buffer = generateImpulseResponse(
					this.context,
					this.reverb,
				);
			} catch {
				this.convolver.buffer = null;
			}
		}
		setSmoothed(this.predelay.delayTime, this.reverb.predelaySec, t);
		setSmoothed(this.wet.gain, this.reverb.mix, t);
	}

	private reverbActive(): boolean {
		return this.reverb.enabled && this.reverb.mix > 0;
	}

	/** Rebuild mix → … → master routing. Synchronous; no node teardown. */
	private rewire(): void {
		// Disconnect every stage output first: bypassed modules must not
		// keep stale unity-wired paths that would sum the signal twice.
		// (Redundant identical connects below are spec-ignored no-ops.)
		const stages: AudioNode[] = [
			this.mix,
			this.preamp,
			...this.pool,
			...this.toneNodes,
			this.compressor,
			this.makeup,
			this.splitter,
			...this.spatialGains,
			this.merger,
			this.reverbSend,
			this.predelay,
			this.convolver,
			this.wet,
			this.shaper,
		];
		for (const node of stages) {
			try {
				node.disconnect();
			} catch {
				// Already disconnected.
			}
		}
		if (!this.enabled) {
			this.mix.connect(this.master);
			this.wired = false;
			return;
		}
		// Fixed internal networks (re-established every rebuild).
		this.splitter.connect(this.spatialGains[0], 0);
		this.splitter.connect(this.spatialGains[2], 0);
		this.splitter.connect(this.spatialGains[1], 1);
		this.splitter.connect(this.spatialGains[3], 1);
		this.spatialGains[0]?.connect(this.merger, 0, 0);
		this.spatialGains[1]?.connect(this.merger, 0, 0);
		this.spatialGains[2]?.connect(this.merger, 0, 1);
		this.spatialGains[3]?.connect(this.merger, 0, 1);
		this.reverbSend.connect(this.predelay);
		this.predelay.connect(this.convolver);
		this.convolver.connect(this.wet);
		// Dry path in fixed module order; bypassed modules are skipped.
		let head: AudioNode = this.preamp;
		this.mix.connect(this.preamp);
		for (const node of this.pool) {
			head.connect(node);
			head = node;
		}
		if (this.toneActive()) {
			for (const node of this.toneNodes) {
				head.connect(node);
				head = node;
			}
		}
		if (this.dynamics.enabled) {
			head.connect(this.compressor);
			this.compressor.connect(this.makeup);
			head = this.makeup;
		}
		if (this.spatialActive) {
			head.connect(this.splitter);
			head = this.merger;
		}
		const dryTail: AudioNode = head;
		// Limiter stage: an enabled shaper, otherwise a straight wire.
		const limiterNode: AudioNode = this.limiterEnabled
			? this.shaper
			: this.master;
		if (this.reverbActive()) {
			// Parallel wet branch: dry stays sample-aligned and latency-free.
			dryTail.connect(this.reverbSend);
			this.wet.connect(limiterNode);
			dryTail.connect(limiterNode);
		} else {
			dryTail.connect(limiterNode);
		}
		if (this.limiterEnabled) this.shaper.connect(this.master);
		this.wired = true;
	}

	get isWired(): boolean {
		return this.wired;
	}
}
