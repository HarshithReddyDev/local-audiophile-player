/**
 * Behavioral audio presets: named DSP starting points (NOT measurements,
 * NOT device corrections — the names say what they do, and the docs say
 * they are subjective starting points). Each entry is a partial module
 * patch applied onto the live state; anything it doesn't mention is left
 * alone, and everything is reversible via per-module reset.
 */

import type { DeviceDspSnapshot } from "./snapshot";

export interface BehavioralPreset {
	id: string;
	name: string;
	description: string;
	patch: Partial<DeviceDspSnapshot>;
}

function graphic(
	gains: number[],
	layoutId = "10",
): DeviceDspSnapshot["graphic"] {
	return { layoutId, gains, enabled: true };
}

export const BEHAVIORAL_PRESETS: BehavioralPreset[] = [
	{
		id: "flat",
		name: "Flat",
		description: "Disables every shaping module. The honest baseline.",
		patch: {
			bass: { enabled: false, gainDb: 0, turnoverHz: 200 },
			treble: { enabled: false, gainDb: 0, turnoverHz: 4000 },
			tuner: {
				enabled: false,
				amountDb: 0,
				centerHz: 60,
				subDb: 0,
				resonance: 0.71,
			},
			loudness: { enabled: false, listeningLevelDb: -20 },
			spatial: {
				enabled: false,
				balance: 0,
				width: 1,
				crossfeed: 0,
				mode: "stereo",
			},
			reverb: {
				enabled: false,
				mix: 0.2,
				decay: 2.5,
				damping: 0.5,
				roomSec: 1.2,
				predelaySec: 0.02,
			},
			compressor: {
				enabled: false,
				thresholdDb: -18,
				ratio: 3,
				kneeDb: 6,
				attackSec: 0.01,
				releaseSec: 0.2,
				makeupDb: 0,
			},
		},
	},
	{
		id: "bass-boost",
		name: "Bass Boost",
		description: "Gentle low-shelf lift. Watch the headroom readout.",
		patch: {
			bass: { enabled: true, gainDb: 4, turnoverHz: 150 },
		},
	},
	{
		id: "treble-boost",
		name: "Treble Boost",
		description: "Gentle high-shelf lift for dull recordings.",
		patch: {
			treble: { enabled: true, gainDb: 3, turnoverHz: 6000 },
		},
	},
	{
		id: "vocal",
		name: "Vocal",
		description:
			"Presence lift around 3 kHz via the bass/treble neutral path — uses a mild graphic smile-inverted curve.",
		patch: {
			graphic: graphic([0, 0, 0, 0, 0, 1, 2, 2, 1, 0]),
		},
	},
	{
		id: "podcast",
		name: "Podcast",
		description: "Speech clarity: tame lows, lift presence, gentle leveling.",
		patch: {
			bass: { enabled: true, gainDb: -3, turnoverHz: 200 },
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
	},
	{
		id: "classical",
		name: "Classical",
		description:
			"Barely-there hall feel. Reverb stays subtle and off by default elsewhere.",
		patch: {
			reverb: {
				enabled: true,
				mix: 0.12,
				decay: 2,
				damping: 0.4,
				roomSec: 1.8,
				predelaySec: 0.02,
			},
		},
	},
	{
		id: "rock",
		name: "Rock",
		description: "Classic smile: lows and highs up, mids relaxed.",
		patch: {
			graphic: graphic([3, 2, 1, 0, -1, -1, 0, 1, 2, 3]),
		},
	},
	{
		id: "electronic",
		name: "Electronic",
		description: "Sub emphasis plus air, via the bass tuner and treble shelf.",
		patch: {
			tuner: {
				enabled: true,
				amountDb: 5,
				centerHz: 55,
				subDb: 2,
				resonance: 0.8,
			},
			treble: { enabled: true, gainDb: 2, turnoverHz: 8000 },
		},
	},
	{
		id: "acoustic",
		name: "Acoustic",
		description: "Slight warmth, nothing else.",
		patch: {
			bass: { enabled: true, gainDb: 1.5, turnoverHz: 250 },
		},
	},
	{
		id: "night",
		name: "Night Listening",
		description:
			"Low-volume mode: relative loudness compensation plus gentle leveling. Configurable afterwards.",
		patch: {
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
	},
	{
		id: "low-volume",
		name: "Low Volume",
		description: "Loudness compensation only, no dynamics change.",
		patch: {
			loudness: { enabled: true, listeningLevelDb: -30 },
		},
	},
	{
		id: "wide",
		name: "Wide",
		description:
			"Moderate stereo widening. May thin mono playback — the UI warns.",
		patch: {
			spatial: {
				enabled: true,
				balance: 0,
				width: 1.25,
				crossfeed: 0,
				mode: "stereo",
			},
		},
	},
	{
		id: "mono",
		name: "Mono",
		description: "Dual-mono for single-earbud or compatibility checks.",
		patch: {
			spatial: {
				enabled: true,
				balance: 0,
				width: 1,
				crossfeed: 0,
				mode: "mono",
			},
		},
	},
];

export function behavioralPreset(id: string): BehavioralPreset | null {
	return BEHAVIORAL_PRESETS.find((p) => p.id === id) ?? null;
}
