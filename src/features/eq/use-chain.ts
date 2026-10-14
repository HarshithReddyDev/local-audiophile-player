import { useMemo } from "react";
import { graphicToBands } from "../../dsp/graphic";
import { toLoudnessBands } from "../../dsp/loudness";
import {
	type ChainResponseInput,
	chainPeakBoostDb,
	chainResponseGrid,
} from "../../dsp/response";
import { toToneBands, toTunerBands } from "../../dsp/tone";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";

export const CHAIN_SAMPLE_RATE = 48000;

/**
 * Full static-chain input shared by the graph, headroom readout, and
 * export paths: exactly one EQ path (parametric or graphic) plus tone,
 * tuner, and loudness shelves. Non-LTI modules (compressor, limiter,
 * spatial, reverb) have no magnitude response and are excluded by
 * construction — the UI says so next to the graph.
 */
export function useChainInput(): ChainResponseInput {
	const profile = useEQStore((s) => s.profile);
	const eqMode = useDspStore((s) => s.eqMode);
	const graphic = useDspStore((s) => s.graphic);
	const bass = useDspStore((s) => s.bass);
	const treble = useDspStore((s) => s.treble);
	const tuner = useDspStore((s) => s.tuner);
	const loudness = useDspStore((s) => s.loudness);
	return useMemo(() => {
		const stages: ChainResponseInput["stages"] = [];
		const eqBands =
			eqMode === "graphic" ? graphicToBands(graphic) : profile.bands;
		for (const band of eqBands) {
			stages.push({
				type: band.type,
				frequency: band.frequency,
				gain: band.gain,
				q: band.q,
				enabled: profile.enabled && band.enabled,
			});
		}
		for (const stage of toToneBands(bass, treble)) stages.push(stage);
		for (const stage of toTunerBands(tuner)) stages.push(stage);
		for (const stage of toLoudnessBands(loudness)) stages.push(stage);
		return {
			preampDb: profile.enabled ? profile.preamp : 0,
			stages,
			enabled: true,
		};
	}, [profile, eqMode, graphic, bass, treble, tuner, loudness]);
}

/** Worst-case static boost (dB ≥ 0) for the headroom readout. */
export function useChainPeakBoost(chain: ChainResponseInput): number {
	return useMemo(() => chainPeakBoostDb(chain, CHAIN_SAMPLE_RATE, 96), [chain]);
}

/** Full-chain grid for graphs (memoized on the chain input). */
export function useChainGrid(chain: ChainResponseInput) {
	return useMemo(
		() => chainResponseGrid(chain, CHAIN_SAMPLE_RATE, 160),
		[chain],
	);
}
