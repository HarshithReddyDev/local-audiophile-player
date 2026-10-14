/**
 * Device DSP snapshot: the full, portable DSP state attachable to a
 * device profile. Applying a snapshot REPLACES all module state
 * (documented, predictable — never merges). Null peq means "empty PEQ".
 * Versioned for forward-compatible restores.
 */

import type { CompressorParams } from "./dynamics";
import type { GraphicProfile } from "./graphic";
import type { LoudnessParams } from "./loudness";
import type { ReplayGainMode } from "./replaygain";
import type { ReverbParams } from "./reverb";
import type { SpatialParams } from "./spatial";
import type { BassTone, BassTuner, TrebleTone } from "./tone";
import type { SerializedPEQ } from "./types";

export type EqMode = "parametric" | "graphic";

export interface DeviceDspSnapshot {
	version: 1;
	eqMode: EqMode;
	peq: SerializedPEQ | null;
	graphic: GraphicProfile | null;
	bass: BassTone;
	treble: TrebleTone;
	tuner: BassTuner;
	limiter: { enabled: boolean; ceilingDb: number };
	compressor: CompressorParams;
	spatial: SpatialParams;
	reverb: ReverbParams;
	loudness: LoudnessParams;
	replayGainMode: ReplayGainMode;
}

/** Structural validation for imported snapshots (never throws). */
export function parseSnapshot(raw: unknown): DeviceDspSnapshot | null {
	if (typeof raw !== "object" || raw === null) return null;
	const v = raw as Record<string, unknown>;
	if (v["version"] !== 1) return null;
	if (v["eqMode"] !== "parametric" && v["eqMode"] !== "graphic") return null;
	const isObject = (x: unknown): x is Record<string, unknown> =>
		typeof x === "object" && x !== null;
	if (
		v["peq"] !== null &&
		!(
			isObject(v["peq"]) && (v["peq"] as { version?: unknown })["version"] === 1
		)
	) {
		return null;
	}
	for (const key of [
		"bass",
		"treble",
		"tuner",
		"limiter",
		"compressor",
		"spatial",
		"reverb",
		"loudness",
	] as const) {
		if (!isObject(v[key])) return null;
	}
	if (
		v["graphic"] !== null &&
		v["graphic"] !== undefined &&
		!isObject(v["graphic"])
	)
		return null;
	if (
		v["replayGainMode"] !== "off" &&
		v["replayGainMode"] !== "track" &&
		v["replayGainMode"] !== "album"
	) {
		return null;
	}
	return v as unknown as DeviceDspSnapshot;
}
