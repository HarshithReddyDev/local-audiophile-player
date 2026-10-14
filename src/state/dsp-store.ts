import { create } from "zustand";
import type { CompressorParams } from "../dsp/dynamics";
import { COMPRESSOR_DEFAULTS, sanitizeCompressor } from "../dsp/dynamics";
import type { GraphicProfile } from "../dsp/graphic";
import { defaultGraphic, sanitizeGraphic } from "../dsp/graphic";
import type { LoudnessParams } from "../dsp/loudness";
import { LOUDNESS_DEFAULTS, sanitizeLoudness } from "../dsp/loudness";
import type { ReplayGainMode } from "../dsp/replaygain";
import { REPLAYGAIN_MODES } from "../dsp/replaygain";
import {
	REVERB_DEFAULTS,
	type ReverbParams,
	sanitizeReverb,
} from "../dsp/reverb";
import type { DeviceDspSnapshot, EqMode } from "../dsp/snapshot";
import type { SpatialParams } from "../dsp/spatial";
import { SPATIAL_DEFAULTS } from "../dsp/spatial";
import type { BassTone, BassTuner, TrebleTone } from "../dsp/tone";
import {
	BASS_DEFAULTS,
	BASS_TUNER_DEFAULTS,
	sanitizeBass,
	sanitizeBassTuner,
	sanitizeTreble,
	TREBLE_DEFAULTS,
} from "../dsp/tone";
import { loadPrefs, savePrefs } from "../storage/persistence";
import { useEQStore } from "./eq-store";

export interface LimiterState {
	enabled: boolean;
	/** dBFS ceiling, −12…0. Sample-peak backstop, NOT true-peak. */
	ceilingDb: number;
}

export const LIMITER_DEFAULTS: LimiterState = { enabled: true, ceilingDb: -1 };

function sanitizeLimiter(raw: LimiterState): LimiterState {
	const ceiling = Number.isFinite(raw.ceilingDb)
		? Math.min(0, Math.max(-12, raw.ceilingDb))
		: LIMITER_DEFAULTS.ceilingDb;
	return { enabled: raw.enabled === true, ceilingDb: ceiling };
}

interface DspPersisted {
	eqMode: EqMode;
	graphic: GraphicProfile;
	bass: BassTone;
	treble: TrebleTone;
	tuner: BassTuner;
	limiter: LimiterState;
	compressor: CompressorParams;
	spatial: SpatialParams;
	reverb: ReverbParams;
	loudness: LoudnessParams;
	replayGainMode: ReplayGainMode;
	graphicPresets: {
		id: string;
		name: string;
		updatedAt: number;
		graphic: GraphicProfile;
	}[];
	activeDeviceId: string | null;
	activeDeviceName: string | null;
	/**
	 * Master bypass: the whole chain is disengaged without touching any
	 * module state or preset. Persisted — what you hear on reload matches.
	 */
	masterBypass: boolean;
}

interface DspState extends DspPersisted {
	setEqMode: (mode: EqMode) => void;
	setGraphic: (graphic: GraphicProfile) => void;
	saveGraphicPreset: (name: string) => string | null;
	renameGraphicPreset: (id: string, name: string) => void;
	deleteGraphicPreset: (id: string) => void;
	loadGraphicPreset: (id: string) => void;
	setBass: (bass: BassTone) => void;
	setTreble: (treble: TrebleTone) => void;
	setTuner: (tuner: BassTuner) => void;
	setLimiter: (limiter: LimiterState) => void;
	setCompressor: (compressor: CompressorParams) => void;
	setSpatial: (spatial: SpatialParams) => void;
	setReverb: (reverb: ReverbParams) => void;
	setLoudness: (loudness: LoudnessParams) => void;
	setReplayGainMode: (mode: ReplayGainMode) => void;
	/** Master bypass on/off (persisted; never mutates modules/presets). */
	setMasterBypass: (on: boolean) => void;
	/**
	 * Momentary A/B comparison: bypasses listening only, never persisted
	 * and never touching stored configuration.
	 */
	comparing: boolean;
	setComparing: (on: boolean) => void;
	resetModule: (
		module:
			| "graphic"
			| "bass"
			| "treble"
			| "tuner"
			| "limiter"
			| "compressor"
			| "spatial"
			| "reverb"
			| "loudness",
	) => void;
	resetAll: () => void;
	/** Capture the full live state (PEQ read from the EQ store). */
	snapshot: () => DeviceDspSnapshot;
	/**
	 * Replace all module state from a snapshot (device layer). PEQ goes
	 * through the EQ store so persistence stays single-sourced.
	 */
	applySnapshot: (
		snapshot: DeviceDspSnapshot,
		device: { id: string; name: string } | null,
	) => void;
	clearDevice: () => void;
}

function defaults(): DspPersisted {
	return {
		eqMode: "parametric",
		graphic: defaultGraphic("10"),
		bass: { ...BASS_DEFAULTS },
		treble: { ...TREBLE_DEFAULTS },
		tuner: { ...BASS_TUNER_DEFAULTS },
		limiter: { ...LIMITER_DEFAULTS },
		compressor: { ...COMPRESSOR_DEFAULTS },
		spatial: { ...SPATIAL_DEFAULTS },
		reverb: { ...REVERB_DEFAULTS },
		loudness: { ...LOUDNESS_DEFAULTS },
		replayGainMode: "off",
		graphicPresets: [],
		activeDeviceId: null,
		activeDeviceName: null,
		masterBypass: false,
	};
}

function sanitizePersisted(raw: Partial<DspPersisted>): DspPersisted {
	const base = defaults();
	const graphicPresets = Array.isArray(raw.graphicPresets)
		? raw.graphicPresets.filter(
				(p): p is DspPersisted["graphicPresets"][number] =>
					typeof p === "object" &&
					p !== null &&
					typeof (p as { id?: unknown }).id === "string" &&
					typeof (p as { name?: unknown }).name === "string" &&
					typeof (p as { graphic?: unknown }).graphic === "object" &&
					(p as { graphic?: unknown }).graphic !== null,
			)
		: [];
	return {
		eqMode: raw.eqMode === "graphic" ? "graphic" : "parametric",
		graphic:
			raw.graphic && typeof raw.graphic === "object"
				? sanitizeGraphic(raw.graphic as GraphicProfile)
				: base.graphic,
		bass:
			raw.bass && typeof raw.bass === "object"
				? sanitizeBass(raw.bass as BassTone)
				: base.bass,
		treble:
			raw.treble && typeof raw.treble === "object"
				? sanitizeTreble(raw.treble as TrebleTone)
				: base.treble,
		tuner:
			raw.tuner && typeof raw.tuner === "object"
				? sanitizeBassTuner(raw.tuner as BassTuner)
				: base.tuner,
		limiter:
			raw.limiter && typeof raw.limiter === "object"
				? sanitizeLimiter(raw.limiter as LimiterState)
				: base.limiter,
		compressor:
			raw.compressor && typeof raw.compressor === "object"
				? sanitizeCompressor(raw.compressor as CompressorParams)
				: base.compressor,
		spatial:
			raw.spatial && typeof raw.spatial === "object"
				? {
						enabled: (raw.spatial as SpatialParams).enabled === true,
						balance: Number.isFinite((raw.spatial as SpatialParams).balance)
							? Math.min(
									1,
									Math.max(-1, (raw.spatial as SpatialParams).balance),
								)
							: 0,
						width: Number.isFinite((raw.spatial as SpatialParams).width)
							? Math.min(1.5, Math.max(0, (raw.spatial as SpatialParams).width))
							: 1,
						crossfeed: Number.isFinite((raw.spatial as SpatialParams).crossfeed)
							? Math.min(
									0.5,
									Math.max(0, (raw.spatial as SpatialParams).crossfeed),
								)
							: 0,
						mode: (
							["stereo", "mono", "left-only", "right-only", "swap"] as const
						).includes((raw.spatial as SpatialParams).mode)
							? (raw.spatial as SpatialParams).mode
							: "stereo",
					}
				: base.spatial,
		reverb:
			raw.reverb && typeof raw.reverb === "object"
				? sanitizeReverb(raw.reverb as ReverbParams)
				: base.reverb,
		loudness:
			raw.loudness && typeof raw.loudness === "object"
				? sanitizeLoudness(raw.loudness as LoudnessParams)
				: base.loudness,
		replayGainMode: REPLAYGAIN_MODES.includes(
			raw.replayGainMode as ReplayGainMode,
		)
			? (raw.replayGainMode as ReplayGainMode)
			: "off",
		graphicPresets: graphicPresets.map((p) => ({
			...p,
			graphic: sanitizeGraphic(p.graphic),
		})),
		activeDeviceId:
			typeof raw.activeDeviceId === "string" ? raw.activeDeviceId : null,
		activeDeviceName:
			typeof raw.activeDeviceName === "string" ? raw.activeDeviceName : null,
		masterBypass: raw.masterBypass === true,
	};
}

function persist(state: DspPersisted): void {
	const {
		eqMode,
		graphic,
		bass,
		treble,
		tuner,
		limiter,
		compressor,
		spatial,
		reverb,
		loudness,
		replayGainMode,
		graphicPresets,
		activeDeviceId,
		activeDeviceName,
		masterBypass,
	} = state;
	savePrefs("dsp", {
		eqMode,
		graphic,
		bass,
		treble,
		tuner,
		limiter,
		compressor,
		spatial,
		reverb,
		loudness,
		replayGainMode,
		graphicPresets,
		activeDeviceId,
		activeDeviceName,
		masterBypass,
	});
}

let presetCounter = 0;
function newPresetId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `gpreset-${crypto.randomUUID().slice(0, 8)}`;
	}
	presetCounter += 1;
	return `gpreset-${Date.now().toString(36)}-${presetCounter}`;
}

const initial = sanitizePersisted(loadPrefs<Partial<DspPersisted>>("dsp", {}));

export const useDspStore = create<DspState>()((set, get) => {
	const update = (patch: Partial<DspPersisted>): void => {
		set(patch);
		persist({ ...get(), ...patch });
	};
	return {
		...initial,
		// Transient listening state: never persisted, always starts off.
		comparing: false,

		setMasterBypass: (masterBypass) => update({ masterBypass }),
		setComparing: (comparing) => set({ comparing }),

		setEqMode: (eqMode) => update({ eqMode }),
		setGraphic: (graphic) => update({ graphic: sanitizeGraphic(graphic) }),
		saveGraphicPreset: (name) => {
			const trimmed = name.trim();
			if (trimmed === "") return null;
			const preset = {
				id: newPresetId(),
				name: trimmed,
				updatedAt: Date.now(),
				graphic: sanitizeGraphic(get().graphic),
			};
			update({ graphicPresets: [preset, ...get().graphicPresets] });
			return preset.id;
		},
		renameGraphicPreset: (id, name) => {
			const trimmed = name.trim();
			if (trimmed === "") return;
			update({
				graphicPresets: get().graphicPresets.map((p) =>
					p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
				),
			});
		},
		deleteGraphicPreset: (id) => {
			update({
				graphicPresets: get().graphicPresets.filter((p) => p.id !== id),
			});
		},
		loadGraphicPreset: (id) => {
			const preset = get().graphicPresets.find((p) => p.id === id);
			if (preset) update({ graphic: sanitizeGraphic(preset.graphic) });
		},
		setBass: (bass) => update({ bass: sanitizeBass(bass) }),
		setTreble: (treble) => update({ treble: sanitizeTreble(treble) }),
		setTuner: (tuner) => update({ tuner: sanitizeBassTuner(tuner) }),
		setLimiter: (limiter) => update({ limiter: sanitizeLimiter(limiter) }),
		setCompressor: (compressor) =>
			update({ compressor: sanitizeCompressor(compressor) }),
		setSpatial: (spatial) =>
			update({
				spatial: sanitizePersisted({ spatial } as Partial<DspPersisted>)
					.spatial,
			}),
		setReverb: (reverb) => update({ reverb: sanitizeReverb(reverb) }),
		setLoudness: (loudness) => update({ loudness: sanitizeLoudness(loudness) }),
		setReplayGainMode: (replayGainMode) => update({ replayGainMode }),

		resetModule: (module) => {
			const base = defaults();
			update({ [module]: base[module] } as Partial<DspPersisted>);
		},
		resetAll: () => {
			const base = defaults();
			update({ ...base, graphicPresets: get().graphicPresets });
		},

		snapshot: () => {
			const s = get();
			const profile = useEQStore.getState().profile;
			return {
				version: 1,
				eqMode: s.eqMode,
				peq: {
					version: 1,
					preamp: profile.preamp,
					enabled: profile.enabled,
					bands: profile.bands.map((b) => ({
						type: b.type,
						frequency: b.frequency,
						gain: b.gain,
						q: b.q,
						enabled: b.enabled,
					})),
				},
				graphic: sanitizeGraphic(s.graphic),
				bass: { ...s.bass },
				treble: { ...s.treble },
				tuner: { ...s.tuner },
				limiter: { ...s.limiter },
				compressor: { ...s.compressor },
				spatial: { ...s.spatial },
				reverb: { ...s.reverb },
				loudness: { ...s.loudness },
				replayGainMode: s.replayGainMode,
			};
		},

		applySnapshot: (snapshot, device) => {
			const eq = useEQStore.getState();
			if (snapshot.peq) {
				eq.loadBands(
					snapshot.peq.bands.map((b) => ({ ...b })),
					snapshot.peq.preamp,
					snapshot.peq.enabled,
				);
			} else {
				eq.resetProfile();
			}
			update({
				eqMode: snapshot.eqMode,
				graphic: snapshot.graphic
					? sanitizeGraphic(snapshot.graphic)
					: defaults().graphic,
				bass: sanitizeBass(snapshot.bass),
				treble: sanitizeTreble(snapshot.treble),
				tuner: sanitizeBassTuner(snapshot.tuner),
				limiter: sanitizeLimiter(snapshot.limiter),
				compressor: sanitizeCompressor(snapshot.compressor),
				spatial: sanitizePersisted({
					spatial: snapshot.spatial,
				} as Partial<DspPersisted>).spatial,
				reverb: sanitizeReverb(snapshot.reverb),
				loudness: sanitizeLoudness(snapshot.loudness),
				replayGainMode: REPLAYGAIN_MODES.includes(snapshot.replayGainMode)
					? snapshot.replayGainMode
					: "off",
				activeDeviceId: device?.id ?? null,
				activeDeviceName: device?.name ?? null,
			});
		},

		clearDevice: () => update({ activeDeviceId: null, activeDeviceName: null }),
	};
});
