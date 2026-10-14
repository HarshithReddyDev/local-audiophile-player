/**
 * IEM domain: measurements, targets, profiles. References by id everywhere —
 * no duplicated curve objects. The generated PEQProfile (Phase 7 output) is
 * the SAME type the manual EQ uses; the engine never learns its origin.
 */

import type { FitRangePresetId, HfTreatment } from "../dsp/autoeq";
import type {
	CurveChannel,
	ResponseCurve,
	TargetBuilderParams,
} from "../dsp/curves";
import type { SmoothingPresetId } from "../dsp/smoothing";
import type { DeviceDspSnapshot } from "../dsp/snapshot";
import type { SerializedPEQ } from "../dsp/types";

export interface Measurement {
	id: string;
	name: string;
	/** Free-form origin note ("my 711 rig", "imported 2026-09-12", …). */
	source: string;
	channel: CurveChannel;
	frequencies: number[];
	gains: number[];
	metadata: {
		rig?: string;
		coupler?: string;
		notes?: string;
		pointCount: number;
		minFrequency: number;
		maxFrequency: number;
	};
	createdAt: number;
}

export type TargetKind = "builtin-flat" | "parametric" | "imported";

export interface TargetCurve {
	id: string;
	name: string;
	kind: TargetKind;
	frequencies: number[];
	gains: number[];
	metadata: {
		source?: string;
		attribution?: string;
		params?: TargetBuilderParams;
		pointCount: number;
	};
	createdAt: number;
	updatedAt: number;
}

export interface IEMProfile {
	id: string;
	name: string;
	manufacturer: string;
	model: string;
	measurementId: string | null;
	targetId: string | null;
	/** Filled by Phase 7 AutoEQ; null until then. Same type as manual EQ. */
	eq: SerializedPEQ | null;
	/**
	 * Full device DSP layer (EQ mode, tone, dynamics, spatial, reverb,
	 * loudness, limiter, ReplayGain mode). Null until captured. Applying
	 * a profile with a snapshot replaces all module state; without one,
	 * only the legacy eq field applies. Additive: older records lack it.
	 */
	dsp?: DeviceDspSnapshot | null;
	/** Provenance for generated EQ; null for manual/empty. Additive field. */
	eqMeta: {
		optimizerVersion: number;
		fittedAt: number;
		rmsAfterDb: number;
		maxBands: number;
		/** Phase 8A: HF treatment used; absent on pre-Phase-8 records. */
		hfTreatment?: HfTreatment;
		/** Phase 8A: requested range preset; absent on old records. */
		fitRangePreset?: FitRangePresetId;
		/** Phase 8A: effective range after measurement clamping. */
		effectiveRangeHz?: [number, number];
		/** Phase 8D: smoothing preset; absent (≡ "off") on old records. */
		smoothingPreset?: SmoothingPresetId;
	} | null;
	createdAt: number;
	updatedAt: number;
}

/** Canonical fitting domain. Fitting must stay inside measured data. */
export interface FrequencyRange {
	min: number;
	max: number;
}

export const DEFAULT_FIT_RANGE: FrequencyRange = { min: 20, max: 20000 };

/**
 * Phase 7 contract — input to the future optimizer. Declared here so both
 * sides compile against it; the optimizer itself does not exist yet.
 */
export interface AutoEQInput {
	measurement: ResponseCurve;
	target: ResponseCurve;
	/** Clamped to the measurement's valid range by the caller. */
	frequencyRange: FrequencyRange;
	fittingOptions: {
		maxBands: number;
		maxGainDb: number;
		preferParametric: boolean;
	};
}

export type AutoEQOutput = SerializedPEQ;

export function toResponseCurve(
	frequencies: number[],
	gains: number[],
): ResponseCurve {
	return { frequencies: [...frequencies], gains: [...gains] };
}
