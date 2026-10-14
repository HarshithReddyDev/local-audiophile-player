/**
 * Minimal peak limiter: instant attack, smooth release, hard ceiling.
 *
 * Design (documented, smallest safe first): per-sample peak follower feeds a
 * single gain. Reduction grabs instantly — a smoothed attack measurably lets
 * whole transients through (caught by test) — while recovery back to unity
 * follows a 50 ms smoother so release stays inaudible. No lookahead: that
 * would add latency plus block-sized architecture for a safety net that only
 * needs to catch EQ-boost overshoot. NOT a true-peak limiter (no
 * oversampling); it bounds sample peaks, which is the stated requirement.
 * Deterministic, bounded, NaN/Inf-proof.
 */
export interface LimiterParams {
	/** dBFS ceiling, e.g. -1. Clamped to [-12, 0]. */
	ceilingDb: number;
}

export const LIMITER_DEFAULTS: LimiterParams = {
	ceilingDb: -1,
};

export function clampCeiling(db: number): number {
	if (!Number.isFinite(db)) return LIMITER_DEFAULTS.ceilingDb;
	return Math.min(0, Math.max(-12, db));
}

export class PeakLimiter {
	private envelope = 0;
	private gain = 1;
	private release: number;
	private ceiling: number;

	constructor(params: Partial<LimiterParams> = {}, sampleRate = 48000) {
		this.ceiling =
			10 ** (clampCeiling(params.ceilingDb ?? LIMITER_DEFAULTS.ceilingDb) / 20);
		const fs =
			Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
		this.release = Math.exp(-1 / ((50 / 1000) * fs));
	}

	get ceilingLinear(): number {
		return this.ceiling;
	}

	setCeiling(db: number): void {
		this.ceiling = 10 ** (clampCeiling(db) / 20);
	}

	reset(): void {
		this.envelope = 0;
		this.gain = 1;
	}

	/** In-place mono/stereo-safe processing over channel arrays. */
	process(channels: Float64Array[], n: number): void {
		const count = channels.length;
		for (let i = 0; i < n; i++) {
			let peak = 0;
			for (let c = 0; c < count; c++) {
				const v = Math.abs(channels[c]?.[i] ?? 0);
				if (v > peak) peak = v;
			}
			if (!Number.isFinite(peak)) peak = 0;
			this.envelope = Math.max(peak, this.envelope * this.release);
			const target =
				this.envelope > this.ceiling ? this.ceiling / this.envelope : 1;
			// Instant grab toward reduction (strict bound), smooth recovery.
			this.gain =
				target < this.gain
					? target
					: this.gain + (target - this.gain) * (1 - this.release);
			if (!Number.isFinite(this.gain)) {
				this.gain = 1;
				this.envelope = 0;
			}
			for (let c = 0; c < count; c++) {
				const channel = channels[c];
				if (channel && i < channel.length)
					channel[i] = (channel[i] ?? 0) * this.gain;
			}
		}
	}
}
