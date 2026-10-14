/**
 * Tone shaping: bass/treble shelves and a controlled bass tuner.
 *
 * Nothing here is a black box — every control maps to documented biquad
 * stages (via toToneBands / toTunerBands) that feed the shared response
 * engine and the native filter nodes 1:1.
 */

export interface BassTone {
	enabled: boolean;
	/** dB, −12…+12. */
	gainDb: number;
	/** Turnover Hz, 50…500. */
	turnoverHz: number;
}

export interface TrebleTone {
	enabled: boolean;
	/** dB, −12…+12. */
	gainDb: number;
	/** Turnover Hz, 1000…12000. */
	turnoverHz: number;
}

export const BASS_DEFAULTS: BassTone = {
	enabled: false,
	gainDb: 0,
	turnoverHz: 200,
};

export const TREBLE_DEFAULTS: TrebleTone = {
	enabled: false,
	gainDb: 0,
	turnoverHz: 4000,
};

export const TONE_LIMITS = {
	gainDb: { min: -12, max: 12 },
	bassTurnover: { min: 50, max: 500 },
	trebleTurnover: { min: 1000, max: 12000 },
} as const;

function clamp(
	value: number,
	min: number,
	max: number,
	fallback: number,
): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

export function sanitizeBass(raw: BassTone): BassTone {
	return {
		enabled: raw.enabled === true,
		gainDb: clamp(
			raw.gainDb,
			TONE_LIMITS.gainDb.min,
			TONE_LIMITS.gainDb.max,
			0,
		),
		turnoverHz: clamp(
			raw.turnoverHz,
			TONE_LIMITS.bassTurnover.min,
			TONE_LIMITS.bassTurnover.max,
			BASS_DEFAULTS.turnoverHz,
		),
	};
}

export function sanitizeTreble(raw: TrebleTone): TrebleTone {
	return {
		enabled: raw.enabled === true,
		gainDb: clamp(
			raw.gainDb,
			TONE_LIMITS.gainDb.min,
			TONE_LIMITS.gainDb.max,
			0,
		),
		turnoverHz: clamp(
			raw.turnoverHz,
			TONE_LIMITS.trebleTurnover.min,
			TONE_LIMITS.trebleTurnover.max,
			TREBLE_DEFAULTS.turnoverHz,
		),
	};
}

export interface ToneBand {
	type: "lowshelf" | "highshelf" | "peaking";
	frequency: number;
	gain: number;
	q: number;
	enabled: boolean;
}

/** Bass + treble as shelf stages (skipped entirely when neutral/off). */
export function toToneBands(bass: BassTone, treble: TrebleTone): ToneBand[] {
	const b = sanitizeBass(bass);
	const t = sanitizeTreble(treble);
	const out: ToneBand[] = [];
	if (b.enabled && b.gainDb !== 0) {
		out.push({
			type: "lowshelf",
			frequency: b.turnoverHz,
			gain: b.gainDb,
			q: 0.71,
			enabled: true,
		});
	}
	if (t.enabled && t.gainDb !== 0) {
		out.push({
			type: "highshelf",
			frequency: t.turnoverHz,
			gain: t.gainDb,
			q: 0.71,
			enabled: true,
		});
	}
	return out;
}

/**
 * Bass tuner: controlled low-frequency shaping, not a blind boost.
 * amount = shelf lift at center; sub = extra peaking an octave below
 * for sub-bass emphasis; resonance sets that peak's Q. Neutral default
 * (all zeros, disabled) changes nothing — verified by test.
 */
export interface BassTuner {
	enabled: boolean;
	/** dB shelf lift, 0…+12. */
	amountDb: number;
	/** Shelf turnover Hz, 30…150. */
	centerHz: number;
	/** Extra sub-bass peaking dB, 0…+6. */
	subDb: number;
	/** Sub peak Q, 0.5…2. */
	resonance: number;
}

export const BASS_TUNER_DEFAULTS: BassTuner = {
	enabled: false,
	amountDb: 0,
	centerHz: 60,
	subDb: 0,
	resonance: 0.71,
};

export const BASS_TUNER_LIMITS = {
	amountDb: { min: 0, max: 12 },
	centerHz: { min: 30, max: 150 },
	subDb: { min: 0, max: 6 },
	resonance: { min: 0.5, max: 2 },
} as const;

export function sanitizeBassTuner(raw: BassTuner): BassTuner {
	return {
		enabled: raw.enabled === true,
		amountDb: clamp(
			raw.amountDb,
			BASS_TUNER_LIMITS.amountDb.min,
			BASS_TUNER_LIMITS.amountDb.max,
			0,
		),
		centerHz: clamp(
			raw.centerHz,
			BASS_TUNER_LIMITS.centerHz.min,
			BASS_TUNER_LIMITS.centerHz.max,
			BASS_TUNER_DEFAULTS.centerHz,
		),
		subDb: clamp(
			raw.subDb,
			BASS_TUNER_LIMITS.subDb.min,
			BASS_TUNER_LIMITS.subDb.max,
			0,
		),
		resonance: clamp(
			raw.resonance,
			BASS_TUNER_LIMITS.resonance.min,
			BASS_TUNER_LIMITS.resonance.max,
			BASS_TUNER_DEFAULTS.resonance,
		),
	};
}

export function toTunerBands(tuner: BassTuner): ToneBand[] {
	const t = sanitizeBassTuner(tuner);
	if (!t.enabled) return [];
	const out: ToneBand[] = [];
	if (t.amountDb > 0) {
		out.push({
			type: "lowshelf",
			frequency: t.centerHz,
			gain: t.amountDb,
			q: 0.71,
			enabled: true,
		});
	}
	if (t.subDb > 0) {
		out.push({
			type: "peaking",
			frequency: Math.max(20, t.centerHz / 2),
			gain: t.subDb,
			q: t.resonance,
			enabled: true,
		});
	}
	return out;
}

/** Worst-case low-end lift, for clipping warnings (dB, ≥ 0). */
export function tunerPeakDb(tuner: BassTuner): number {
	const t = sanitizeBassTuner(tuner);
	if (!t.enabled) return 0;
	return t.amountDb + t.subDb;
}
