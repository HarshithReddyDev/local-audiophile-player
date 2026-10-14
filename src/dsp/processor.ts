/**
 * Stateful biquad processor: Direct Form 1, per-channel state.
 *
 * Form choice (documented, not assumed): DF1 implements the cookbook
 * difference equation verbatim, so implementation-vs-reference audits read
 * line-for-line. DF2-transposed has marginally better finite-precision
 * behavior, but all processing here is float64, where the difference is far
 * below any audio or test tolerance — verified by the impulse/step and
 * response tests, including extreme Q at Nyquist edges.
 */
import type { BiquadCoefficients } from "./types";
import { UNITY_BIQUAD } from "./types";

export class BiquadProcessor {
	private x1: Float64Array;
	private x2: Float64Array;
	private y1: Float64Array;
	private y2: Float64Array;
	private coefficients: BiquadCoefficients = { ...UNITY_BIQUAD };

	constructor(channels = 2) {
		const n = Math.max(1, Math.floor(channels));
		this.x1 = new Float64Array(n);
		this.x2 = new Float64Array(n);
		this.y1 = new Float64Array(n);
		this.y2 = new Float64Array(n);
	}

	get channels(): number {
		return this.x1.length;
	}

	setCoefficients(coefficients: BiquadCoefficients): void {
		this.coefficients = { ...coefficients };
	}

	reset(): void {
		this.x1.fill(0);
		this.x2.fill(0);
		this.y1.fill(0);
		this.y2.fill(0);
	}

	/**
	 * Process n frames in place across channel arrays. No allocations;
	 * out-of-range channels are ignored, short arrays clamp n.
	 */
	process(channels: Float64Array[], n: number): void {
		const { b0, b1, b2, a1, a2 } = this.coefficients;
		const count = Math.min(channels.length, this.channels);
		for (let c = 0; c < count; c++) {
			const x = channels[c];
			if (!x) continue;
			const frames = Math.min(n, x.length);
			let x1 = this.x1[c] ?? 0;
			let x2 = this.x2[c] ?? 0;
			let y1 = this.y1[c] ?? 0;
			let y2 = this.y2[c] ?? 0;
			for (let i = 0; i < frames; i++) {
				const input = x[i] ?? 0;
				const output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
				x2 = x1;
				x1 = input;
				y2 = y1;
				y1 = output;
				x[i] = output;
			}
			this.x1[c] = x1;
			this.x2[c] = x2;
			this.y1[c] = y1;
			this.y2[c] = y2;
		}
	}
}
