/**
 * Graphic EQ: fixed-center peaking banks rendered through the same biquad
 * pool as the parametric profile (no second DSP implementation).
 *
 * Bands use constant Q = 1.0 (documented simplification, not a claim about
 * any product's proportional-Q design). Layouts follow standard octave /
 * third-octave centers; the 5-band layout matches this app's staggered
 * new-band frequencies so the two modes agree with each other.
 */

export const GRAPHIC_Q = 1.0;
/** Slider/decibel range for graphic gains (matches common ±12 dB decks). */
export const GRAPHIC_GAIN_DB = { min: -12, max: 12 } as const;

export interface GraphicLayout {
	/** Stable id, e.g. "10". */
	id: string;
	label: string;
	/** Ascending center frequencies in Hz. */
	centers: number[];
}

function logSpaced(count: number, fMin: number, fMax: number): number[] {
	const lo = Math.log10(fMin);
	const hi = Math.log10(fMax);
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const f = 10 ** (lo + ((hi - lo) * i) / (count - 1));
		out.push(Math.round(f * 100) / 100);
	}
	return out;
}

export const GRAPHIC_LAYOUTS: GraphicLayout[] = [
	{
		id: "5",
		label: "5-band",
		centers: [60, 230, 910, 3600, 14000],
	},
	{
		id: "10",
		label: "10-band (octave)",
		centers: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
	},
	{
		id: "15",
		label: "15-band (2/3-octave)",
		centers: [
			25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000,
			16000,
		],
	},
	{
		id: "20",
		label: "20-band",
		centers: logSpaced(20, 25, 20000),
	},
	{
		id: "31",
		label: "31-band (1/3-octave)",
		centers: [
			20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
			800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
			12500, 16000, 20000,
		],
	},
	{
		id: "32",
		label: "32-band (1/3-octave)",
		centers: [
			16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
			630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
			10000, 12500, 16000, 20000,
		],
	},
];

export function graphicLayout(id: string): GraphicLayout | null {
	return GRAPHIC_LAYOUTS.find((l) => l.id === id) ?? null;
}

export interface GraphicProfile {
	/** Layout id from GRAPHIC_LAYOUTS. */
	layoutId: string;
	/** dB per band, same order as layout centers. */
	gains: number[];
	enabled: boolean;
}

export function defaultGraphic(layoutId = "10"): GraphicProfile {
	const layout = graphicLayout(layoutId) ?? GRAPHIC_LAYOUTS[1]!;
	return {
		layoutId: layout.id,
		gains: layout.centers.map(() => 0),
		enabled: false,
	};
}

function clampGain(db: number): number {
	if (!Number.isFinite(db)) return 0;
	return Math.min(GRAPHIC_GAIN_DB.max, Math.max(GRAPHIC_GAIN_DB.min, db));
}

/** Sanitize persisted/foreign gains to the active layout (length + range). */
export function sanitizeGraphic(profile: GraphicProfile): GraphicProfile {
	const layout = graphicLayout(profile.layoutId) ?? GRAPHIC_LAYOUTS[1]!;
	const gains = layout.centers.map((_, i) => clampGain(profile.gains[i] ?? 0));
	return { layoutId: layout.id, gains, enabled: profile.enabled === true };
}

/**
 * Graphic gains → parametric bands (peaking, constant Q) so the single
 * biquad pool, response engine, export, and persistence all share one
 * representation. Band ids encode layout + index for determinism.
 */
export function graphicToBands(profile: GraphicProfile): {
	type: "peaking";
	frequency: number;
	gain: number;
	q: number;
	enabled: boolean;
}[] {
	const clean = sanitizeGraphic(profile);
	const layout = graphicLayout(clean.layoutId) ?? GRAPHIC_LAYOUTS[1]!;
	return layout.centers.map((frequency, i) => ({
		type: "peaking" as const,
		frequency,
		gain: clean.gains[i] ?? 0,
		q: GRAPHIC_Q,
		enabled: clean.enabled,
	}));
}

/**
 * Parametric response → graphic gains by sampling the profile response at
 * each layout center. This is interpolation, not inversion: re-converting
 * back yields an approximation, and callers must say so in the UI.
 */
export function sampleToGraphic(
	layoutId: string,
	sampleAt: (frequency: number) => number,
): GraphicProfile {
	const layout = graphicLayout(layoutId) ?? GRAPHIC_LAYOUTS[1]!;
	return {
		layoutId: layout.id,
		gains: layout.centers.map((f) => clampGain(sampleAt(f))),
		enabled: true,
	};
}
