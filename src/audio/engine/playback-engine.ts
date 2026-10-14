/**
 * PlaybackEngine — the only module that touches media elements directly.
 *
 * Dual-deck pipeline (Phase 4):
 *
 *   deckA element → deckA gain ─┐
 *                                ├→ mix Gain → master Gain → destination
 *   deckB element → deckB gain ─┘
 *
 * One deck is active (audible); the other is standby for gapless preload and
 * equal-power crossfade. Volume lives on master; rate on both elements.
 * Phase 5 DSP inserts between mix and master without touching the decks.
 *
 * UI code must talk to this engine, never to audio elements. All state flows
 * out through subscribed events; only the ACTIVE deck's events are forwarded.
 */

export type EngineEvent =
	| "timeupdate"
	| "loadedmetadata"
	| "ended"
	| "play"
	| "pause"
	| "seeking"
	| "seeked"
	| "error"
	| "preloaderror";

export type EngineListener = (
	event: EngineEvent,
	engine: PlaybackEngine,
) => void;

/** Minimal media-element surface the engine needs. HTMLAudioElement satisfies it. */
export interface MediaElement {
	src: string;
	currentTime: number;
	duration: number;
	readonly paused: boolean;
	readonly readyState: number;
	/** Present on real elements; used for diagnostics only. */
	readonly networkState?: number;
	volume: number;
	muted: boolean;
	playbackRate: number;
	preload: string;
	/** Native pitch preservation (all real elements have it). */
	preservesPitch?: boolean;
	error: { readonly message: string } | null;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	/** Chromium-only output routing; absent elsewhere (guarded). */
	setSinkId?: (deviceId: string) => Promise<void>;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

/** Deck gain: thin wrapper so curve scheduling is unit-testable without audio hardware. */
export interface DeckGain {
	setImmediate(value: number): void;
	curveTo(values: Float32Array, startTime: number, duration: number): void;
	cancelScheduled(): void;
	now(): number;
}

/** Equal-power crossfade gains for t in [0,1]: out²+in² = 1. */
export function equalPowerGains(t: number): [out: number, inn: number] {
	const clamped = Math.min(1, Math.max(0, t));
	const angle = (clamped * Math.PI) / 2;
	return [Math.cos(angle), Math.sin(angle)];
}

/** 64-point curve arrays for setValueCurveAtTime. Start/end exact. */
export function equalPowerCurves(steps = 64): {
	out: Float32Array;
	inn: Float32Array;
} {
	const out = new Float32Array(steps);
	const inn = new Float32Array(steps);
	for (let i = 0; i < steps; i++) {
		const t = steps === 1 ? 1 : i / (steps - 1);
		const [o, n] = equalPowerGains(t);
		out[i] = o;
		inn[i] = n;
	}
	return { out, inn };
}

export interface EngineSnapshot {
	currentTime: number;
	duration: number | null;
	paused: boolean;
	rate: number;
}

interface Deck {
	element: MediaElement;
	gain: DeckGain;
	url: string | null;
	/**
	 * True when url is an object URL this engine created (revoke on
	 * release). Remote http(s) URLs are borrowed, never revoked.
	 */
	ownsUrl: boolean;
	/** Opaque preload identity supplied by the controller (track id). */
	key: string | null;
}

import type { CompressorParams } from "../../dsp/dynamics";
import type { Matrix2x2 } from "../../dsp/spatial";
import type { DspBandParams, ReverbParams, ToneParams } from "./dsp-chain";
import { NativeDspChain } from "./dsp-chain";

interface EngineGraph {
	context: {
		readonly state: string;
		readonly currentTime: number;
		resume(): Promise<unknown>;
		close(): Promise<unknown>;
	};
	/** Decks → mix → [DSP] → master. Null DSP methods = no chain (tests). */
	mix: unknown;
	master: unknown;
	masterVolume(value: number): void;
	/** Wire an element into the graph: source → deck gain → mix. */
	attachDeck(element: MediaElement): DeckGain;
	setDspEnabled?(on: boolean): void;
	applyDsp?(preampDb: number, bands: DspBandParams[]): void;
	applyTone?(tone: ToneParams): void;
	applyDynamics?(params: CompressorParams): void;
	applySpatial?(matrix: Matrix2x2, active: boolean): void;
	applyReverb?(params: ReverbParams): void;
	setLimiterEnabled?(on: boolean): void;
	setLimiterCeiling?(db: number): void;
	getReductionDb?(): number | null;
	ensureAnalyser?(): unknown;
	getSampleRate?(): number | null;
	getDspState?(): { enabled: boolean; bands: number } | null;
}

/** Lazily tapped analyser (master → analyser → destination, once). */
let chainAnalyser: AnalyserNode | null = null;

function ensureChainAnalyser(
	context: AudioContext,
	master: GainNode,
): AnalyserNode {
	if (chainAnalyser) return chainAnalyser;
	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	analyser.smoothingTimeConstant = 0.75;
	try {
		master.disconnect();
	} catch {
		// Already tapped or never connected.
	}
	master.connect(analyser);
	analyser.connect(context.destination);
	chainAnalyser = analyser;
	return analyser;
}

function createRealGraph(): EngineGraph | null {
	if (
		typeof window === "undefined" ||
		typeof window.AudioContext === "undefined"
	)
		return null;
	const context = new window.AudioContext();
	const mix = context.createGain();
	const master = context.createGain();
	master.connect(context.destination);
	// Starts bypassed (mix → master); enabling reroutes through the chain.
	const chain = new NativeDspChain(context, mix, master);
	return {
		context,
		mix,
		master,
		masterVolume: (value) => {
			master.gain.setTargetAtTime(value, context.currentTime, 0.01);
		},
		setDspEnabled: (on) => chain.setEnabled(on),
		applyDsp: (preampDb, bands) => {
			chain.setPreamp(preampDb);
			chain.setBands(bands);
		},
		applyTone: (tone) => chain.setTone(tone),
		applyDynamics: (params) => chain.setDynamics(params),
		applySpatial: (matrix, active) => chain.setSpatial(matrix, active),
		applyReverb: (params) => chain.setReverb(params),
		setLimiterEnabled: (on) => chain.setLimiterEnabled(on),
		setLimiterCeiling: (db) => chain.setCeiling(db),
		getReductionDb: () => chain.getReductionDb(),
		ensureAnalyser: () => ensureChainAnalyser(context, master),
		getSampleRate: () => context.sampleRate,
		getDspState: () => ({ enabled: chain.isEnabled, bands: chain.nodeCount }),
		attachDeck: (element) => {
			const source = context.createMediaElementSource(
				element as HTMLAudioElement,
			);
			const node = context.createGain();
			node.gain.value = 0;
			source.connect(node);
			node.connect(mix);
			return {
				setImmediate: (value) => {
					node.gain.cancelScheduledValues(context.currentTime);
					node.gain.setValueAtTime(value, context.currentTime);
				},
				curveTo: (values, startTime, duration) => {
					node.gain.cancelScheduledValues(startTime);
					node.gain.setValueAtTime(values[0] ?? 0, startTime);
					node.gain.setValueCurveAtTime(values, startTime, duration);
				},
				cancelScheduled: () => {
					node.gain.cancelScheduledValues(context.currentTime);
				},
				now: () => context.currentTime,
			};
		},
	};
}

/**
 * Source the engine can load. Files become owned blob URLs; remote
 * http(s) URLs are borrowed from the provider (never revoked, never
 * persisted — resolution is the caller's job).
 */
export type EngineSource =
	| { kind: "file"; file: File }
	| { kind: "url"; url: string };

function isOwnedUrl(url: string): boolean {
	return url.startsWith("blob:");
}

export class PlaybackEngine {
	private decks: [Deck, Deck];
	private active = 0;
	private graph: EngineGraph | null = null;
	private graphFactory: (() => EngineGraph | null) | null;
	private listeners = new Map<EngineEvent, Set<EngineListener>>();
	private lastError: string | null = null;
	private fadeTimer: ReturnType<typeof setTimeout> | null = null;
	private fadeDone: ((completed: boolean) => void) | null = null;
	private fading = false;

	constructor(
		factory: () => MediaElement = () => new Audio(),
		graphFactory: (() => EngineGraph | null) | null = null,
	) {
		const makeDeck = (): Deck => {
			const element = factory();
			const deck: Deck = {
				element,
				gain: fallbackGainInstance,
				url: null,
				ownsUrl: false,
				key: null,
			};
			for (const event of [
				"timeupdate",
				"loadedmetadata",
				"ended",
				"play",
				"pause",
				"seeking",
				"seeked",
				"error",
			] as EngineEvent[]) {
				element.addEventListener(event, () => this.onDeckEvent(deck, event));
			}
			return deck;
		};
		this.decks = [makeDeck(), makeDeck()];
		this.graphFactory = graphFactory;
	}

	private get activeDeck(): Deck {
		const deck = this.decks[this.active];
		if (!deck) throw new Error("No active deck");
		return deck;
	}

	private get standbyDeck(): Deck {
		const deck = this.decks[1 - this.active];
		if (!deck) throw new Error("No standby deck");
		return deck;
	}

	/** Load a source on the active deck, cancelling any fade or preload. */
	loadSource(source: EngineSource, key: string | null = null): void {
		this.cancelFade();
		this.clearPreload();
		const deck = this.activeDeck;
		this.ensureGraph();
		this.releaseDeckUrl(deck);
		if (source.kind === "file") {
			deck.url = URL.createObjectURL(source.file);
			deck.ownsUrl = true;
		} else {
			deck.url = source.url;
			// Borrowed remote URL — plus blob: URLs handed in directly.
			deck.ownsUrl = isOwnedUrl(source.url);
		}
		deck.key = key;
		this.lastError = null;
		deck.element.volume = 1;
		deck.element.muted = false;
		deck.element.preload = "auto";
		deck.element.src = deck.url;
		if (deck.element.playbackRate === 0) deck.element.playbackRate = 1;
		deck.gain.setImmediate(1);
		this.standbyDeck.gain.setImmediate(0);
	}

	/** Load a file on the active deck, cancelling any fade or preload. */
	load(file: File, key: string | null = null): void {
		this.loadSource({ kind: "file", file }, key);
	}

	/** Stage a source on the standby deck (bounded lookahead of one). */
	preloadSource(source: EngineSource, key: string): void {
		if (this.standbyDeck.key === key && this.standbyDeck.url) return;
		this.ensureGraph();
		const deck = this.standbyDeck;
		this.releaseDeckUrl(deck);
		if (source.kind === "file") {
			deck.url = URL.createObjectURL(source.file);
			deck.ownsUrl = true;
		} else {
			deck.url = source.url;
			deck.ownsUrl = isOwnedUrl(source.url);
		}
		deck.key = key;
		deck.element.volume = 1;
		deck.element.muted = false;
		deck.element.preload = "auto";
		deck.element.src = deck.url;
		deck.element.load();
		deck.gain.setImmediate(0);
	}

	/** Stage a file on the standby deck (bounded lookahead of one). */
	preload(file: File, key: string): void {
		this.preloadSource({ kind: "file", file }, key);
	}

	get preloadedKey(): string | null {
		return this.standbyDeck.url ? this.standbyDeck.key : null;
	}

	/** Instant role swap to a ready standby (gapless snap, no fade). */
	activatePreload(): boolean {
		const standby = this.standbyDeck;
		if (!standby.url || standby.element.readyState < 2) return false;
		this.cancelFade();
		const previous = this.activeDeck;
		previous.element.pause();
		previous.gain.setImmediate(0);
		this.active = 1 - this.active;
		this.activeDeck.gain.setImmediate(1);
		return true;
	}

	/**
	 * Equal-power crossfade into the preloaded standby, scheduled on the
	 * audio clock. Resolves true once the swap completes; false when no
	 * ready preload exists (caller falls back to an ended-boundary snap).
	 */
	async beginCrossfade(durationSec: number): Promise<boolean> {
		const standby = this.standbyDeck;
		if (!standby.url || standby.element.readyState < 2 || this.fading)
			return false;
		this.fading = true;
		try {
			await standby.element.play();
		} catch {
			this.fading = false;
			return false;
		}
		if (!this.fading) {
			// Cancelled while play() was in flight: the standby may have
			// started anyway — stop it; gains were already snapped back.
			standby.element.pause();
			return false;
		}
		const duration = Math.min(12, Math.max(0.5, durationSec));
		const t0 = standby.gain.now();
		const { out, inn } = equalPowerCurves();
		this.activeDeck.gain.curveTo(out, t0, duration);
		standby.gain.curveTo(inn, t0, duration);
		const completed = await new Promise<boolean>((resolve) => {
			this.fadeDone = resolve;
			this.fadeTimer = setTimeout(() => {
				this.fadeTimer = null;
				this.fadeDone = null;
				this.completeFade();
				resolve(true);
			}, duration * 1000);
		});
		return completed;
	}

	/** Abort a fade: snap back to the active deck, silence standby. */
	cancelFade(): void {
		if (this.fadeTimer) {
			clearTimeout(this.fadeTimer);
			this.fadeTimer = null;
		}
		if (!this.fading) return;
		this.fading = false;
		this.activeDeck.gain.cancelScheduled();
		this.standbyDeck.gain.cancelScheduled();
		this.activeDeck.gain.setImmediate(1);
		this.standbyDeck.gain.setImmediate(0);
		this.standbyDeck.element.pause();
		this.fadeDone?.(false);
		this.fadeDone = null;
	}

	get isFading(): boolean {
		return this.fading;
	}

	async play(): Promise<void> {
		await this.resumeContext();
		try {
			await this.activeDeck.element.play();
		} catch (error) {
			// A superseding load() aborts the in-flight play() with AbortError.
			if (error instanceof DOMException && error.name === "AbortError")
				throw error;
			this.lastError =
				error instanceof Error ? error.message : "Playback failed";
			this.emit("error");
			throw error;
		}
	}

	pause(): void {
		this.cancelFade();
		this.activeDeck.element.pause();
	}

	seek(seconds: number): void {
		if (!Number.isFinite(seconds)) return;
		this.cancelFade();
		const duration = this.snapshot().duration;
		const target =
			duration != null
				? Math.min(Math.max(0, seconds), duration)
				: Math.max(0, seconds);
		try {
			this.activeDeck.element.currentTime = target;
		} catch {
			// Seeking an unloadable resource throws in some browsers; the
			// element error event carries the real failure.
		}
	}

	setVolume(value: number): void {
		const v = Math.min(1, Math.max(0, value));
		if (this.graph) this.graph.masterVolume(v);
		else {
			this.activeDeck.element.volume = v;
			this.standbyDeck.element.volume = v;
		}
	}

	setMuted(muted: boolean): void {
		if (this.graph) this.graph.masterVolume(muted ? 0 : 1);
		else {
			this.activeDeck.element.muted = muted;
			this.standbyDeck.element.muted = muted;
		}
	}

	/** Applies the persisted volume after (un)muting so mute never loses level. */
	applyVolume(volume: number, muted: boolean): void {
		this.setVolume(muted ? 0 : volume);
	}

	/**
	 * DSP insert/remove without teardown: reroutes mix → [chain] → master
	 * synchronously and preserves all node parameters.
	 */
	setDspEnabled(on: boolean): void {
		this.graph?.setDspEnabled?.(on);
	}

	/** Push preamp + band params (smoothed a-rate updates, no clicks). */
	applyDspProfile(preampDb: number, bands: DspBandParams[]): void {
		this.graph?.applyDsp?.(preampDb, bands);
	}

	applyToneProfile(tone: ToneParams): void {
		this.graph?.applyTone?.(tone);
	}

	applyDynamicsProfile(params: CompressorParams): void {
		this.graph?.applyDynamics?.(params);
	}

	applySpatialProfile(matrix: Matrix2x2, active: boolean): void {
		this.graph?.applySpatial?.(matrix, active);
	}

	applyReverbProfile(params: ReverbParams): void {
		this.graph?.applyReverb?.(params);
	}

	setLimiterEnabled(on: boolean): void {
		this.graph?.setLimiterEnabled?.(on);
	}

	setLimiterCeiling(db: number): void {
		this.graph?.setLimiterCeiling?.(db);
	}

	/** Live compressor gain reduction in dB (≤ 0), null when bypassed. */
	getReductionDb(): number | null {
		return this.graph?.getReductionDb?.() ?? null;
	}

	/** Shared analyser tap for visualizers (created on first use). */
	getAnalyser(): unknown {
		return this.graph?.ensureAnalyser?.() ?? null;
	}

	getSampleRate(): number | null {
		return this.graph?.getSampleRate?.() ?? null;
	}

	/**
	 * Route both decks to an output device where supported (Chromium
	 * setSinkId). Resolves false when unavailable — never throws into
	 * the transport.
	 */
	async setOutputDevice(deviceId: string): Promise<boolean> {
		try {
			const decks = [this.activeDeck.element, this.standbyDeck.element];
			let applied = false;
			for (const element of decks) {
				if (typeof element.setSinkId === "function") {
					await element.setSinkId(deviceId);
					applied = true;
				}
			}
			return applied;
		} catch {
			return false;
		}
	}

	setRate(rate: number): void {
		if (!Number.isFinite(rate)) return;
		const r = Math.min(2, Math.max(0.25, rate));
		this.activeDeck.element.playbackRate = r;
		this.standbyDeck.element.playbackRate = r;
	}

	/**
	 * Pitch handling for rate changes: preserved (default) keeps musical
	 * pitch while changing tempo; off gives the classic tape effect.
	 * Browser-implemented; honored wherever the element supports it.
	 */
	setPreservePitch(on: boolean): void {
		for (const deck of this.decks) {
			try {
				deck.element.preservesPitch = on;
			} catch {
				// Read-only or absent in this browser; rate still applies.
			}
		}
	}

	snapshot(): EngineSnapshot {
		const element = this.activeDeck.element;
		const duration = element.duration;
		return {
			currentTime: element.currentTime,
			duration: Number.isFinite(duration) ? duration : null,
			paused: element.paused,
			rate: element.playbackRate,
		};
	}

	getError(): string | null {
		return this.lastError ?? this.activeDeck.element.error?.message ?? null;
	}

	getContextState(): string | null {
		return this.graph ? this.graph.context.state : null;
	}

	getContextTime(): number | null {
		return this.graph ? this.graph.context.currentTime : null;
	}

	async resumeContext(): Promise<void> {
		if (this.graph && this.graph.context.state === "suspended") {
			try {
				await this.graph.context.resume();
			} catch {
				// Resume failure surfaces as an element/play error below.
			}
		}
	}

	/** Phase 5 insertion surface: everything between these nodes is future DSP. */
	getMixNode(): unknown {
		return this.graph?.mix ?? null;
	}

	getMasterNode(): unknown {
		return this.graph?.master ?? null;
	}

	/** Deck introspection for tests and diagnostics (not for rendering). */
	getDebugState(): {
		active: number;
		fading: boolean;
		dsp: { enabled: boolean; bands: number } | null;
		decks: {
			hasUrl: boolean;
			key: string | null;
			paused: boolean;
			readyState: number;
			networkState: number;
			errorCode: number | null;
		}[];
	} {
		return {
			active: this.active,
			fading: this.fading,
			dsp: this.graph?.getDspState?.() ?? null,
			decks: this.decks.map((d) => ({
				hasUrl: d.url !== null,
				key: d.key,
				paused: d.element.paused,
				readyState: d.element.readyState,
				networkState: d.element.networkState ?? -1,
				errorCode:
					typeof (d.element.error as { code?: unknown } | null)?.code ===
					"number"
						? ((d.element.error as { code?: number } | null)?.code ?? null)
						: null,
			})),
		};
	}

	on(event: EngineEvent, listener: EngineListener): () => void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
		return () => set.delete(listener);
	}

	destroy(): void {
		this.cancelFade();
		for (const deck of this.decks) {
			deck.element.pause();
			this.releaseDeckUrl(deck);
			deck.key = null;
		}
		this.listeners.clear();
		if (this.graph) {
			void this.graph.context.close().catch(() => undefined);
			this.graph = null;
		}
	}

	private completeFade(): void {
		this.fading = false;
		const previous = this.activeDeck;
		previous.element.pause();
		previous.gain.setImmediate(0);
		this.active = 1 - this.active;
		this.activeDeck.gain.setImmediate(1);
		this.emit("play");
	}

	private clearPreload(): void {
		const standby = this.standbyDeck;
		this.releaseDeckUrl(standby);
		standby.key = null;
	}

	/** Release a deck URL only when this engine owns it (blob: URLs). */
	private releaseDeckUrl(deck: Deck): void {
		if (deck.url && deck.ownsUrl) {
			try {
				URL.revokeObjectURL(deck.url);
			} catch {
				// Release is best-effort; playback is unaffected.
			}
		}
		deck.url = null;
		deck.ownsUrl = false;
	}

	private ensureGraph(): void {
		if (this.graph) return;
		if (this.graphFactory) {
			this.graph = this.graphFactory();
		} else if (typeof HTMLAudioElement !== "undefined") {
			this.graph = createRealGraph();
		} else {
			return;
		}
		if (!this.graph) return;
		const hasAudioElement = typeof HTMLAudioElement !== "undefined";
		for (const deck of this.decks) {
			if (deck.gain !== fallbackGainInstance) continue;
			// Real elements wire source → gain → mix; fakes use the factory.
			if (hasAudioElement && deck.element instanceof HTMLAudioElement) {
				deck.gain = this.graph.attachDeck(deck.element);
			} else if (this.graphFactory) {
				deck.gain = this.graph.attachDeck(deck.element);
			}
		}
	}

	private onDeckEvent(deck: Deck, event: EngineEvent): void {
		const isActive = deck === this.activeDeck;
		if (!isActive) {
			// Standby failures matter (preload of an unplayable file);
			// everything else on standby is bookkeeping noise.
			if (event === "error" && deck.key) this.emit("preloaderror");
			return;
		}
		this.emit(event);
	}

	private emit(event: EngineEvent): void {
		if (event === "error" && !this.lastError) {
			this.lastError =
				this.activeDeck.element.error?.message ?? "Unknown playback error";
		}
		for (const listener of this.listeners.get(event) ?? [])
			listener(event, this);
	}
}

const fallbackGainInstance: DeckGain = fallbackGain();

function fallbackGain(): DeckGain {
	return {
		setImmediate: () => undefined,
		curveTo: () => undefined,
		cancelScheduled: () => undefined,
		now: () => 0,
	};
}
