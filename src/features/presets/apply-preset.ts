/**
 * Applying built-in presets through the existing stores. No DSP math here —
 * bands go through eqStore.loadBands (fresh ids, sanitized), DSP modules
 * through the matching dsp-store setters (each sanitizes).
 */
import type { BuiltinPreset } from "../../dsp/builtin-presets";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";

export function applyBuiltinPreset(preset: BuiltinPreset): void {
	const eq = useEQStore.getState();
	if (preset.kind === "dsp") {
		applyDspPatch(preset);
		return;
	}
	eq.loadBands(
		preset.bands.map((b) => ({ ...b })),
		preset.preampDb,
		preset.eqEnabled || preset.bands.length > 0,
	);
	if (preset.kind === "combined" || preset.dsp) applyDspPatch(preset);
}

function applyDspPatch(preset: BuiltinPreset): void {
	const s = useDspStore.getState();
	const patch = preset.dsp;
	if (!patch) return;
	if (patch.bass) s.setBass({ ...patch.bass });
	if (patch.treble) s.setTreble({ ...patch.treble });
	if (patch.tuner) s.setTuner({ ...patch.tuner });
	if (patch.limiter) s.setLimiter({ ...patch.limiter });
	if (patch.compressor) s.setCompressor({ ...patch.compressor });
	if (patch.spatial) s.setSpatial({ ...patch.spatial });
	if (patch.reverb) s.setReverb({ ...patch.reverb });
	if (patch.loudness) s.setLoudness({ ...patch.loudness });
	if (patch.graphic) s.setGraphic({ ...patch.graphic });
	if (patch.replayGainMode) s.setReplayGainMode(patch.replayGainMode);
	if (patch.eqMode) s.setEqMode(patch.eqMode);
}
