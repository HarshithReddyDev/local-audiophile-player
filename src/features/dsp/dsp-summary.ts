import type { CompressorParams } from "../../dsp/dynamics";
import type { LoudnessParams } from "../../dsp/loudness";
import type { ReverbParams } from "../../dsp/reverb";
import type { EqMode } from "../../dsp/snapshot";
import type { SpatialParams } from "../../dsp/spatial";
import type { BassTone, BassTuner, TrebleTone } from "../../dsp/tone";
import type { LimiterState } from "../../state/dsp-store";

export interface DspSummaryRow {
	key: string;
	label: string;
	value: string;
	/** True when the row deserves a warning tone (protection off, etc). */
	warning?: boolean;
}

export interface DspSummaryInput {
	eqMode: EqMode;
	eqEnabled: boolean;
	eqActiveBands: number;
	preampDb: number;
	replayGainDb: number;
	bass: BassTone;
	treble: TrebleTone;
	tuner: BassTuner;
	limiter: LimiterState;
	compressor: CompressorParams;
	spatial: SpatialParams;
	reverb: ReverbParams;
	loudness: LoudnessParams;
}

/** Signed decibels with one decimal: "+2.0 dB", "0.0 dB", "−4.8 dB". */
export function formatDb(db: number): string {
	const rounded = Math.round(db * 10) / 10;
	const text = rounded === 0 ? "0.0" : rounded.toFixed(1);
	return `${rounded > 0 ? "+" : ""}${text} dB`.replace("-", "−");
}

/**
 * Compact status rows for the active audio configuration. Only
 * non-default processors are listed (plus the EQ row, which always
 * shows so "EQ OFF" states are never ambiguous).
 */
export function summarizeDsp(input: DspSummaryInput): DspSummaryRow[] {
	const rows: DspSummaryRow[] = [];
	const eqLabel = input.eqMode === "graphic" ? "Graphic EQ" : "EQ";
	rows.push({
		key: "eq",
		label: eqLabel,
		value: input.eqEnabled
			? `ON · ${input.eqActiveBands} band${input.eqActiveBands === 1 ? "" : "s"}`
			: "OFF",
	});

	const preamp =
		input.replayGainDb !== 0
			? `${formatDb(input.preampDb)} (RG ${formatDb(input.replayGainDb)})`
			: formatDb(input.preampDb);
	rows.push({ key: "preamp", label: "Preamp", value: preamp });

	if (input.bass.enabled && input.bass.gainDb !== 0) {
		rows.push({
			key: "bass",
			label: "Bass",
			value: formatDb(input.bass.gainDb),
		});
	}
	if (input.treble.enabled && input.treble.gainDb !== 0) {
		rows.push({
			key: "treble",
			label: "Treble",
			value: formatDb(input.treble.gainDb),
		});
	}
	if (input.tuner.enabled && input.tuner.amountDb > 0) {
		rows.push({
			key: "tuner",
			label: "Bass tuner",
			value: `${formatDb(input.tuner.amountDb)} @ ${Math.round(input.tuner.centerHz)} Hz`,
		});
	}
	if (!input.limiter.enabled) {
		rows.push({
			key: "limiter",
			label: "Limiter",
			value: "OFF — unprotected",
			warning: true,
		});
	} else if (input.limiter.ceilingDb !== -1) {
		rows.push({
			key: "limiter",
			label: "Limiter",
			value: `ON · ${formatDb(input.limiter.ceilingDb)}FS`,
		});
	}
	if (input.compressor.enabled) {
		rows.push({
			key: "compressor",
			label: "Comp",
			value: `${formatDb(input.compressor.thresholdDb)} ${trimNumber(input.compressor.ratio)}:1`,
		});
	}
	if (input.spatial.enabled) {
		if (input.spatial.balance !== 0) {
			const side = input.spatial.balance < 0 ? "L" : "R";
			rows.push({
				key: "balance",
				label: "Balance",
				value: `${side} ${Math.round(Math.abs(input.spatial.balance) * 100)}`,
			});
		}
		if (input.spatial.mode !== "stereo") {
			rows.push({
				key: "mode",
				label: "Channels",
				value: labelForMode(input.spatial.mode),
			});
		} else if (input.spatial.width !== 1) {
			rows.push({
				key: "width",
				label: "Width",
				value: `${Math.round(input.spatial.width * 100)}%`,
			});
		}
		if (input.spatial.crossfeed > 0) {
			rows.push({
				key: "crossfeed",
				label: "Crossfeed",
				value: input.spatial.crossfeed.toFixed(2),
			});
		}
	}
	if (input.reverb.enabled && input.reverb.mix > 0) {
		rows.push({
			key: "reverb",
			label: "Reverb",
			value: `${Math.round(input.reverb.mix * 100)}%`,
		});
	}
	if (input.loudness.enabled) {
		rows.push({
			key: "loudness",
			label: "Loudness",
			value: `${formatDb(input.loudness.listeningLevelDb)} ref`,
		});
	}
	return rows;
}

function trimNumber(value: number): string {
	return String(Math.round(value * 100) / 100);
}

function labelForMode(mode: DspSummaryInput["spatial"]["mode"]): string {
	switch (mode) {
		case "mono":
			return "Mono";
		case "left-only":
			return "Left only";
		case "right-only":
			return "Right only";
		case "swap":
			return "Swapped";
		default:
			return "Stereo";
	}
}
