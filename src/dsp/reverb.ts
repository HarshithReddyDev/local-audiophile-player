/**
 * Reverb parameters: validated plain data for the native ConvolverNode
 * branch. The impulse itself is generated locally at apply time (see the
 * engine); this module owns validation, defaults, and limits only.
 */

export interface ReverbParams {
	enabled: boolean;
	/** Wet mix 0…1. */
	mix: number;
	/** Decay exponent, higher = shorter tail. */
	decay: number;
	/** Progressive lowpass 0 (dark) … 1 (bright). */
	damping: number;
	/** Impulse seconds, 0.3…3. */
	roomSec: number;
	/** Pre-delay seconds, 0…0.1. */
	predelaySec: number;
}

export const REVERB_DEFAULTS: ReverbParams = {
	enabled: false,
	mix: 0.2,
	decay: 2.5,
	damping: 0.5,
	roomSec: 1.2,
	predelaySec: 0.02,
};

export const REVERB_LIMITS = {
	mix: { min: 0, max: 1 },
	decay: { min: 0.5, max: 8 },
	damping: { min: 0, max: 1 },
	roomSec: { min: 0.3, max: 3 },
	predelaySec: { min: 0, max: 0.1 },
} as const;

export function sanitizeReverb(raw: ReverbParams): ReverbParams {
	const clamp = (
		value: number,
		min: number,
		max: number,
		fallback: number,
	): number =>
		Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
	return {
		enabled: raw.enabled === true,
		mix: clamp(
			raw.mix,
			REVERB_LIMITS.mix.min,
			REVERB_LIMITS.mix.max,
			REVERB_DEFAULTS.mix,
		),
		decay: clamp(
			raw.decay,
			REVERB_LIMITS.decay.min,
			REVERB_LIMITS.decay.max,
			REVERB_DEFAULTS.decay,
		),
		damping: clamp(
			raw.damping,
			REVERB_LIMITS.damping.min,
			REVERB_LIMITS.damping.max,
			REVERB_DEFAULTS.damping,
		),
		roomSec: clamp(
			raw.roomSec,
			REVERB_LIMITS.roomSec.min,
			REVERB_LIMITS.roomSec.max,
			REVERB_DEFAULTS.roomSec,
		),
		predelaySec: clamp(
			raw.predelaySec,
			REVERB_LIMITS.predelaySec.min,
			REVERB_LIMITS.predelaySec.max,
			REVERB_DEFAULTS.predelaySec,
		),
	};
}
