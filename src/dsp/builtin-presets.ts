/**
 * Built-in EQ + DSP preset library.
 *
 * GENERAL STARTING-POINT PRESETS ONLY — not device corrections, not
 * measurement-derived. Every entry is authored in-repo, musically
 * restrained (conservative gain, broad Q first), and fully auditable:
 * unique id, name, description, category, PEQ/graphic config, preamp,
 * DSP modules where part of a combined preset, provenance, version.
 *
 * Existing DSP math, AutoEQ, Phase 8D, playback, and queue semantics are
 * untouched — these presets only feed the existing stores/engine.
 */

import type { DeviceDspSnapshot } from "./snapshot";
import type { FilterType } from "./types";

export type BuiltinPresetKind = "eq" | "dsp" | "combined";

export type BuiltinEqCategory = "general" | "music" | "content" | "listening";
export type BuiltinDspCategory =
	| "tone"
	| "dynamics"
	| "spatial"
	| "listening"
	| "advanced";

export interface BuiltinBand {
	type: FilterType;
	frequency: number;
	gain: number;
	q: number;
	enabled: boolean;
}

export interface BuiltinPreset {
	id: string;
	kind: BuiltinPresetKind;
	name: string;
	description: string;
	/** Display category (general/music/content/listening or tone/...). */
	category: string;
	/** PEQ bands (empty = flat). Preamp in dB, ≤ 0 when boosts exist. */
	bands: BuiltinBand[];
	preampDb: number;
	eqEnabled: boolean;
	/** DSP modules for dsp/combined presets; absent modules stay as-is. */
	dsp?: Partial<DeviceDspSnapshot>;
	provenance: "in-repo";
	version: 1;
}

function band(
	type: FilterType,
	frequency: number,
	gain: number,
	q = 1,
	enabled = true,
): BuiltinBand {
	return { type, frequency, gain, q, enabled };
}

function eq(
	id: string,
	name: string,
	description: string,
	category: BuiltinEqCategory,
	bands: BuiltinBand[],
	preampDb: number,
): BuiltinPreset {
	return {
		id,
		kind: "eq",
		name,
		description,
		category,
		bands,
		preampDb,
		eqEnabled: bands.length > 0,
		provenance: "in-repo",
		version: 1,
	};
}

function dsp(
	id: string,
	name: string,
	description: string,
	category: BuiltinDspCategory,
	patch: Partial<DeviceDspSnapshot>,
): BuiltinPreset {
	return {
		id,
		kind: "dsp",
		name,
		description,
		category,
		bands: [],
		preampDb: 0,
		eqEnabled: false,
		dsp: patch,
		provenance: "in-repo",
		version: 1,
	};
}

function combined(
	id: string,
	name: string,
	description: string,
	category: string,
	bands: BuiltinBand[],
	preampDb: number,
	patch: Partial<DeviceDspSnapshot>,
): BuiltinPreset {
	return {
		id,
		kind: "combined",
		name,
		description,
		category,
		bands,
		preampDb,
		eqEnabled: bands.length > 0,
		dsp: patch,
		provenance: "in-repo",
		version: 1,
	};
}

const OFF_SPATIAL: DeviceDspSnapshot["spatial"] = {
	enabled: false,
	balance: 0,
	width: 1,
	crossfeed: 0,
	mode: "stereo",
};

const OFF_REVERB: DeviceDspSnapshot["reverb"] = {
	enabled: false,
	mix: 0,
	decay: 2.5,
	damping: 0.5,
	roomSec: 1.2,
	predelaySec: 0.02,
};

const OFF_COMP: DeviceDspSnapshot["compressor"] = {
	enabled: false,
	thresholdDb: -18,
	ratio: 3,
	kneeDb: 6,
	attackSec: 0.01,
	releaseSec: 0.2,
	makeupDb: 0,
};

export const BUILTIN_EQ_PRESETS: BuiltinPreset[] = [
	eq(
		"builtin-flat",
		"Flat",
		"No tonal change. The honest baseline for comparisons.",
		"general",
		[],
		0,
	),
	eq(
		"builtin-warm",
		"Warm",
		"Adds gentle low-end weight and slightly relaxes the upper treble.",
		"general",
		[
			band("lowshelf", 150, 2.5, 0.7),
			band("peaking", 3000, -1, 1),
			band("highshelf", 9000, -1.5, 0.7),
		],
		-2.5,
	),
	eq(
		"builtin-bright",
		"Bright",
		"Adds upper-frequency energy for a more forward presentation.",
		"general",
		[band("highshelf", 7000, 2.5, 0.7), band("peaking", 3500, 1, 1.2)],
		-2.5,
	),
	eq(
		"builtin-bass-boost",
		"Bass Boost",
		"Broad low lift for thin recordings. Check headroom.",
		"general",
		[band("lowshelf", 120, 4, 0.7)],
		-4,
	),
	eq(
		"builtin-treble-boost",
		"Treble Boost",
		"Broad high lift for dull recordings.",
		"general",
		[band("highshelf", 8000, 3, 0.7)],
		-3,
	),
	eq(
		"builtin-v-shape",
		"V-Shape",
		"Lows and highs lifted, mids gently relaxed. A classic consumer curve.",
		"general",
		[
			band("lowshelf", 120, 3, 0.7),
			band("peaking", 1000, -2, 0.8),
			band("highshelf", 8000, 3, 0.7),
		],
		-3,
	),
	eq(
		"builtin-vocal",
		"Vocal",
		"Emphasizes the frequency regions commonly useful for speech and vocal presence.",
		"general",
		[
			band("peaking", 180, -2, 0.9),
			band("peaking", 2800, 2.5, 1.2),
			band("highshelf", 10000, 1, 0.7),
		],
		-2.5,
	),
	eq(
		"builtin-neutral",
		"Neutral",
		"Barely-there tilt: a touch less boom, a touch more air.",
		"general",
		[band("peaking", 200, -1, 0.8), band("highshelf", 10000, 1, 0.7)],
		-1,
	),
	eq(
		"builtin-soft",
		"Soft",
		"Relaxes the presence region for harsh recordings or fatigue.",
		"general",
		[band("peaking", 3000, -2, 0.9), band("highshelf", 9000, -2, 0.7)],
		0,
	),
	eq(
		"builtin-loudness",
		"Loudness",
		"Static gentle loudness tilt for quiet listening. Prefer the adaptive Loudness module for daily use.",
		"general",
		[band("lowshelf", 120, 3, 0.7), band("highshelf", 9000, 2, 0.7)],
		-3,
	),
	eq(
		"builtin-rock",
		"Rock",
		"Low/high lift with a small upper-mid push for guitars.",
		"music",
		[
			band("lowshelf", 100, 3, 0.7),
			band("peaking", 800, -1, 1),
			band("peaking", 3000, 1.5, 1.2),
			band("highshelf", 9000, 2.5, 0.7),
		],
		-3,
	),
	eq(
		"builtin-pop",
		"Pop",
		"Tight lows, forward vocals, clean air.",
		"music",
		[
			band("peaking", 150, -1, 0.8),
			band("peaking", 2500, 2, 1.1),
			band("highshelf", 10000, 2, 0.7),
		],
		-2.5,
	),
	eq(
		"builtin-electronic",
		"Electronic",
		"Sub weight plus air; mids stay out of the way.",
		"music",
		[
			band("lowshelf", 80, 4, 0.7),
			band("peaking", 500, -1, 1),
			band("highshelf", 10000, 2.5, 0.7),
		],
		-4,
	),
	eq(
		"builtin-hip-hop",
		"Hip-Hop",
		"Deep low shelf with a small presence lift for vocal attack.",
		"music",
		[band("lowshelf", 70, 4.5, 0.7), band("peaking", 3000, 1.5, 1.2)],
		-4.5,
	),
	eq(
		"builtin-classical",
		"Classical",
		"Almost flat: a whisper of air, nothing else.",
		"music",
		[band("highshelf", 11000, 1, 0.7)],
		-1,
	),
	eq(
		"builtin-jazz",
		"Jazz",
		"Slight warmth and body, treble untouched.",
		"music",
		[band("lowshelf", 180, 2, 0.7), band("peaking", 800, 1, 1)],
		-2,
	),
	eq(
		"builtin-acoustic",
		"Acoustic",
		"Small low-mid trim to reduce boxiness, gentle air.",
		"music",
		[band("peaking", 300, -1.5, 1), band("highshelf", 10000, 1.5, 0.7)],
		-1.5,
	),
	eq(
		"builtin-metal",
		"Metal",
		"Tight low-mids, aggressive presence. Still restrained — push further only deliberately.",
		"music",
		[
			band("peaking", 400, -2, 1),
			band("peaking", 3500, 2.5, 1.1),
			band("lowshelf", 90, 2.5, 0.7),
		],
		-3,
	),
	eq(
		"builtin-indie",
		"Indie",
		"Mild mid-forward curve for lo-fi mixes.",
		"music",
		[band("peaking", 1200, 1.5, 0.9), band("highshelf", 9000, 1, 0.7)],
		-2,
	),
	eq(
		"builtin-rnb",
		"R&B",
		"Warm lows, silky highs, relaxed upper mids.",
		"music",
		[
			band("lowshelf", 120, 3, 0.7),
			band("peaking", 2500, -1, 1),
			band("highshelf", 11000, 1.5, 0.7),
		],
		-3,
	),
	eq(
		"builtin-podcast",
		"Podcast",
		"Trims rumble, lifts speech presence. A starting point for spoken word.",
		"content",
		[
			band("highpass", 80, 0, 0.7),
			band("peaking", 250, -2, 0.9),
			band("peaking", 3000, 2.5, 1.1),
		],
		-2.5,
	),
	eq(
		"builtin-voice",
		"Voice",
		"Narrower speech focus for calls and voice notes.",
		"content",
		[band("peaking", 200, -2.5, 0.8), band("peaking", 3200, 3, 1.2)],
		-3,
	),
	eq(
		"builtin-spoken-word",
		"Spoken Word",
		"Like Voice but gentler for long audiobook sessions.",
		"content",
		[band("peaking", 220, -1.5, 0.8), band("peaking", 2800, 2, 1.1)],
		-2,
	),
	eq(
		"builtin-audiobook",
		"Audiobook",
		"Warm, non-fatiguing tilt for hours of narration.",
		"content",
		[
			band("lowshelf", 200, 1, 0.7),
			band("peaking", 3500, -1, 1),
			band("highshelf", 8000, -1, 0.7),
		],
		-1,
	),
	eq(
		"builtin-movie",
		"Movie",
		"Sub lift plus dialogue presence for small speakers.",
		"content",
		[band("lowshelf", 70, 4, 0.7), band("peaking", 2500, 2, 1)],
		-4,
	),
	eq(
		"builtin-gaming",
		"Gaming",
		"Footstep presence with controlled boom.",
		"content",
		[
			band("peaking", 150, -1.5, 0.9),
			band("peaking", 2800, 2.5, 1.2),
			band("highshelf", 9000, 1.5, 0.7),
		],
		-3,
	),
	eq(
		"builtin-night-listening",
		"Night Listening",
		"Gentle low-level tilt plus reduced harshness.",
		"listening",
		[
			band("lowshelf", 120, 2.5, 0.7),
			band("peaking", 4000, -1.5, 1),
			band("highshelf", 9000, 1, 0.7),
		],
		-2.5,
	),
	eq(
		"builtin-low-volume",
		"Low Volume",
		"Static compensation tilt for quiet playback.",
		"listening",
		[band("lowshelf", 100, 3.5, 0.7), band("highshelf", 9500, 2, 0.7)],
		-3.5,
	),
	eq(
		"builtin-relaxed",
		"Relaxed",
		"Takes the edge off bright gear without sounding muffled.",
		"listening",
		[band("peaking", 5500, -2, 0.8), band("highshelf", 10000, -1.5, 0.7)],
		0,
	),
	eq(
		"builtin-detail",
		"Detail",
		"Small presence lift for low-level detail. Keep volume safe.",
		"listening",
		[band("peaking", 4500, 2, 1.2), band("highshelf", 12000, 1, 0.7)],
		-2.5,
	),
	eq(
		"builtin-wide-helper",
		"Wide Helper",
		"Slight mid dip that pairs well with the stereo widener.",
		"listening",
		[band("peaking", 900, -1.5, 0.8), band("highshelf", 10000, 1.5, 0.7)],
		-1.5,
	),
	eq(
		"builtin-mono-assist",
		"Mono Assist",
		"Presence-focused curve for single-channel listening checks.",
		"listening",
		[band("peaking", 3000, 2, 1)],
		-2,
	),
];

export const BUILTIN_DSP_PRESETS: BuiltinPreset[] = [
	dsp(
		"builtin-dsp-flat-tone",
		"Flat Tone",
		"Bass and treble at neutral. The tone baseline.",
		"tone",
		{
			bass: { enabled: false, gainDb: 0, turnoverHz: 200 },
			treble: { enabled: false, gainDb: 0, turnoverHz: 4000 },
		},
	),
	dsp(
		"builtin-dsp-warm-tone",
		"Warm Tone",
		"Gentle bass-shelf warmth for thin recordings.",
		"tone",
		{
			bass: { enabled: true, gainDb: 2.5, turnoverHz: 180 },
			treble: { enabled: false, gainDb: 0, turnoverHz: 4000 },
		},
	),
	dsp(
		"builtin-dsp-bright-tone",
		"Bright Tone",
		"Gentle treble-shelf lift for dull recordings.",
		"tone",
		{
			bass: { enabled: false, gainDb: 0, turnoverHz: 200 },
			treble: { enabled: true, gainDb: 2, turnoverHz: 6000 },
		},
	),
	dsp(
		"builtin-dsp-bass-lift",
		"Bass Lift",
		"Controlled +4 dB low shelf. Watch headroom.",
		"tone",
		{
			bass: { enabled: true, gainDb: 4, turnoverHz: 150 },
		},
	),
	dsp(
		"builtin-dsp-treble-lift",
		"Treble Lift",
		"Controlled +3 dB high shelf.",
		"tone",
		{
			treble: { enabled: true, gainDb: 3, turnoverHz: 6000 },
		},
	),
	dsp(
		"builtin-dsp-gentle-comp",
		"Gentle Compression",
		"Transparent leveling for uneven recordings. Low ratio, soft knee.",
		"dynamics",
		{
			compressor: {
				enabled: true,
				thresholdDb: -20,
				ratio: 2,
				kneeDb: 12,
				attackSec: 0.02,
				releaseSec: 0.25,
				makeupDb: 2,
			},
		},
	),
	dsp(
		"builtin-dsp-podcast-dyn",
		"Podcast Dynamics",
		"Speech leveling for podcasts and calls. Pairs with the Podcast EQ.",
		"dynamics",
		{
			compressor: {
				enabled: true,
				thresholdDb: -20,
				ratio: 3,
				kneeDb: 6,
				attackSec: 0.01,
				releaseSec: 0.25,
				makeupDb: 3,
			},
		},
	),
	dsp(
		"builtin-dsp-night-dyn",
		"Night Dynamics",
		"Quiet-hours leveling: low threshold, gentle ratio, slow release.",
		"dynamics",
		{
			compressor: {
				enabled: true,
				thresholdDb: -24,
				ratio: 2,
				kneeDb: 12,
				attackSec: 0.02,
				releaseSec: 0.3,
				makeupDb: 2,
			},
		},
	),
	dsp(
		"builtin-dsp-natural-width",
		"Natural Width",
		"Imperceptible widening that keeps mono compatibility.",
		"spatial",
		{
			spatial: {
				enabled: true,
				balance: 0,
				width: 1.1,
				crossfeed: 0,
				mode: "stereo",
			},
		},
	),
	dsp(
		"builtin-dsp-wide",
		"Wide",
		"Clearly wider stereo. Check mono mixes — the UI warns above neutral.",
		"spatial",
		{
			spatial: {
				enabled: true,
				balance: 0,
				width: 1.25,
				crossfeed: 0,
				mode: "stereo",
			},
		},
	),
	dsp(
		"builtin-dsp-xfeed-light",
		"Crossfeed Light",
		"Softens hard-panned headphone imaging a little.",
		"spatial",
		{
			spatial: {
				enabled: true,
				balance: 0,
				width: 1,
				crossfeed: 0.15,
				mode: "stereo",
			},
		},
	),
	dsp(
		"builtin-dsp-xfeed-medium",
		"Crossfeed Medium",
		"Stronger crossfeed for extremely separated mixes. Preference-dependent.",
		"spatial",
		{
			spatial: {
				enabled: true,
				balance: 0,
				width: 1,
				crossfeed: 0.3,
				mode: "stereo",
			},
		},
	),
	dsp(
		"builtin-dsp-night",
		"Night Listening",
		"Low-level loudness tilt plus gentle leveling. Everything else stays off.",
		"listening",
		{
			loudness: { enabled: true, listeningLevelDb: -25 },
			compressor: {
				enabled: true,
				thresholdDb: -24,
				ratio: 2,
				kneeDb: 12,
				attackSec: 0.02,
				releaseSec: 0.3,
				makeupDb: 2,
			},
		},
	),
	dsp(
		"builtin-dsp-low-volume",
		"Low Volume",
		"Relative loudness compensation only — no dynamics change.",
		"listening",
		{
			loudness: { enabled: true, listeningLevelDb: -30 },
		},
	),
	dsp(
		"builtin-dsp-voice-focus",
		"Voice Focus",
		"Mono-compatible speech focus: balance centered, no widening.",
		"listening",
		{
			spatial: {
				enabled: true,
				balance: 0,
				width: 1,
				crossfeed: 0,
				mode: "stereo",
			},
			compressor: {
				enabled: true,
				thresholdDb: -20,
				ratio: 3,
				kneeDb: 6,
				attackSec: 0.01,
				releaseSec: 0.25,
				makeupDb: 3,
			},
		},
	),
];

export const BUILTIN_COMBINED_PRESETS: BuiltinPreset[] = [
	combined(
		"builtin-combined-night",
		"Night Listening+",
		"Moderate low-level tonal compensation, gentle compression, and the peak safety limiter. Everything else off.",
		"listening",
		[band("lowshelf", 120, 2.5, 0.7), band("peaking", 4000, -1.5, 1)],
		-2.5,
		{
			loudness: { enabled: true, listeningLevelDb: -25 },
			compressor: {
				enabled: true,
				thresholdDb: -24,
				ratio: 2,
				kneeDb: 12,
				attackSec: 0.02,
				releaseSec: 0.3,
				makeupDb: 2,
			},
			limiter: { enabled: true, ceilingDb: -1 },
			spatial: { ...OFF_SPATIAL },
			reverb: { ...OFF_REVERB },
		},
	),
	combined(
		"builtin-combined-podcast",
		"Podcast+",
		"Speech EQ, gentle leveling, safety limiter. Everything else off.",
		"content",
		[
			band("highpass", 80, 0, 0.7),
			band("peaking", 250, -2, 0.9),
			band("peaking", 3000, 2.5, 1.1),
		],
		-2.5,
		{
			compressor: {
				enabled: true,
				thresholdDb: -20,
				ratio: 3,
				kneeDb: 6,
				attackSec: 0.01,
				releaseSec: 0.25,
				makeupDb: 3,
			},
			limiter: { enabled: true, ceilingDb: -1 },
			spatial: { ...OFF_SPATIAL },
			reverb: { ...OFF_REVERB },
		},
	),
	combined(
		"builtin-combined-movie-night",
		"Movie Night",
		"Sub weight plus dialogue presence, light leveling, limiter on. Spatial untouched.",
		"content",
		[band("lowshelf", 70, 4, 0.7), band("peaking", 2500, 2, 1)],
		-4,
		{
			compressor: {
				enabled: true,
				thresholdDb: -22,
				ratio: 2,
				kneeDb: 12,
				attackSec: 0.02,
				releaseSec: 0.3,
				makeupDb: 2,
			},
			limiter: { enabled: true, ceilingDb: -1 },
		},
	),
	combined(
		"builtin-combined-flat-safe",
		"Flat & Safe",
		"No tonal change; only the peak safety limiter stays on. The reference reset.",
		"general",
		[],
		0,
		{
			bass: { enabled: false, gainDb: 0, turnoverHz: 200 },
			treble: { enabled: false, gainDb: 0, turnoverHz: 4000 },
			compressor: { ...OFF_COMP },
			spatial: { ...OFF_SPATIAL },
			reverb: { ...OFF_REVERB },
			limiter: { enabled: true, ceilingDb: -1 },
		},
	),
];

export const BUILTIN_PRESETS: BuiltinPreset[] = [
	...BUILTIN_EQ_PRESETS,
	...BUILTIN_DSP_PRESETS,
	...BUILTIN_COMBINED_PRESETS,
];

export function builtinPreset(id: string): BuiltinPreset | null {
	return BUILTIN_PRESETS.find((p) => p.id === id) ?? null;
}

/** Peak positive static gain (EQ bands only) for headroom hints. */
export function builtinPeakBoost(preset: BuiltinPreset): number {
	let peak = 0;
	for (const b of preset.bands) {
		if (b.enabled && b.gain > peak) peak = b.gain;
	}
	return peak;
}

/** Validate library invariants (used by unit tests and CI). */
export function validateBuiltinPreset(preset: BuiltinPreset): string[] {
	const problems: string[] = [];
	if (!preset.id.startsWith("builtin-"))
		problems.push("id must start with builtin-");
	if (!preset.name || preset.name.length > 40)
		problems.push("name required, ≤40 chars");
	if (!preset.description || preset.description.length > 220)
		problems.push("description required, ≤220 chars");
	if (preset.provenance !== "in-repo")
		problems.push("provenance must be in-repo");
	if (preset.version !== 1) problems.push("version must be 1");
	if (
		!Number.isFinite(preset.preampDb) ||
		preset.preampDb > 0 ||
		preset.preampDb < -24
	)
		problems.push("preamp must be finite, -24…0");
	if (preset.bands.length > 12) problems.push("too many bands");
	for (const b of preset.bands) {
		if (b.frequency < 10 || b.frequency > 24000)
			problems.push(`band freq out of range: ${b.frequency}`);
		if (b.gain < -24 || b.gain > 24)
			problems.push(`band gain out of range: ${b.gain}`);
		if (b.q < 0.025 || b.q > 40) problems.push(`band Q out of range: ${b.q}`);
	}
	return problems;
}
