/**
 * PEQ filter chain: preamp scalar → N biquad stages in array order.
 * Supports 0–64 bands without architectural change (practical UI caps apply
 * separately). Coefficient swaps never allocate in the sample loop and never
 * touch processor state, so live updates don't click from teardowns.
 */
import { createBiquad } from "./biquad";
import { PeakLimiter } from "./limiter";
import { dbToGain } from "./preamp";
import { BiquadProcessor } from "./processor";
import type { EQBand } from "./types";

export interface ChainConfig {
	bands: EQBand[];
	preampDb: number;
	sampleRate: number;
	channels: number;
	limiterCeilingDb: number;
}

export class PEQChain {
	private stages: BiquadProcessor[] = [];
	private limiter: PeakLimiter;
	private preampGain = 1;
	private sampleRate: number;
	private channels: number;

	constructor(config: ChainConfig) {
		this.sampleRate = config.sampleRate;
		this.channels = Math.max(1, Math.floor(config.channels));
		this.limiter = new PeakLimiter(
			{ ceilingDb: config.limiterCeilingDb },
			config.sampleRate,
		);
		this.configure(config.bands, config.preampDb);
	}

	get bandCount(): number {
		return this.stages.length;
	}

	configure(bands: EQBand[], preampDb: number): void {
		this.preampGain = dbToGain(preampDb);
		// Disabled bands are skipped (unity) — toggling never tears down state.
		const active = bands.filter((band) => band.enabled);
		while (this.stages.length < active.length) {
			this.stages.push(new BiquadProcessor(this.channels));
		}
		if (this.stages.length > active.length) {
			this.stages.length = active.length;
		}
		for (let i = 0; i < active.length; i++) {
			const band = active[i];
			const stage = this.stages[i];
			if (band && stage)
				stage.setCoefficients(createBiquad(band, this.sampleRate));
		}
	}

	setPreamp(db: number): void {
		this.preampGain = dbToGain(db);
	}

	setLimiterCeiling(db: number): void {
		this.limiter.setCeiling(db);
	}

	reset(): void {
		for (const stage of this.stages) stage.reset();
		this.limiter.reset();
	}

	/** In-place processing: preamp → bands → limiter. No allocations. */
	process(channels: Float64Array[], n: number): void {
		if (this.preampGain !== 1) {
			const count = Math.min(channels.length, this.channels);
			for (let c = 0; c < count; c++) {
				const channel = channels[c];
				if (!channel) continue;
				const frames = Math.min(n, channel.length);
				for (let i = 0; i < frames; i++) {
					channel[i] = (channel[i] ?? 0) * this.preampGain;
				}
			}
		}
		for (const stage of this.stages) stage.process(channels, n);
		this.limiter.process(channels, n);
	}
}
