import { useEffect } from "react";
import type { DspBandParams } from "../../audio/engine/dsp-chain";
import { PlaybackEngine } from "../../audio/engine/playback-engine";
import { CloudError } from "../../cloud/model";
import { graphicToBands } from "../../dsp/graphic";
import { toLoudnessBands } from "../../dsp/loudness";
import { selectReplayGain } from "../../dsp/replaygain";
import { spatialMatrix } from "../../dsp/spatial";
import { toToneBands, toTunerBands } from "../../dsp/tone";
import { BAND_LIMITS } from "../../dsp/types";
import type { PlayableTrackSource } from "../../library/library-service";
import { libraryService } from "../../library/library-service";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { useSettingsStore } from "../../state/settings-store";
import type { Track } from "../../types/library";

/**
 * Owns the single PlaybackEngine and keeps it in sync with the stores.
 * Mount once at the app root. React components never touch the engine.
 *
 * Responsibilities: track loading (with a generation guard so rapid
 * A→B→C→D selections leave only D authoritative), auto-advance with
 * missing-track skipping, next-track preload, crossfade triggering,
 * MediaSession publishing, and engine→store event sync. The engine stays
 * authoritative for time; timers are never the playback clock.
 */

// Generation guard: every playTrack call takes a token; any async
// continuation from a superseded call is dropped silently.
let playToken = 0;

// Preload bookkeeping: avoid retrying a failed stage every tick. Reset
// whenever the upcoming track changes (peek comparison in preloadNext).
let preloadFailedFor: string | null = null;

// Expiry bookkeeping: one transparent refresh attempt per track after a
// mid-playback remote failure (expired temporary URL, rotated session).
let refreshTriedFor: string | null = null;

/** User-facing message for a resolution failure (CloudErrors are pre-worded). */
function resolutionMessage(trackId: string, error: unknown): string {
	if (error instanceof CloudError) return error.message;
	const track = useLibraryStore.getState().tracks[trackId];
	if (track?.remote) return "Cloud track is unavailable. Reconnect the source.";
	return "Audio file is unavailable. Re-import it or reconnect its folder.";
}

/** Load a resolved source onto the engine (file bytes or remote URL). */
function engineLoad(
	engine: PlaybackEngine,
	playable: PlayableTrackSource,
	trackId: string,
): void {
	if (playable.kind === "file") engine.load(playable.file, trackId);
	else engine.loadSource({ kind: "url", url: playable.url }, trackId);
}

/** Last resolution failure (CloudError or unknown), for error banners. */
let lastResolveError: unknown = null;

/**
 * Resolve a track for play/preload: fresh remote URLs every time (never
 * cached — temporary URLs expire), local files as before. Failures are
 * captured for messaging; null means unresolvable right now.
 */
async function resolveForPlay(
	trackId: string,
): Promise<PlayableTrackSource | null> {
	lastResolveError = null;
	try {
		return await libraryService.resolvePlayable(trackId);
	} catch (error) {
		lastResolveError = error;
		return null;
	}
}

function enginePreload(
	engine: PlaybackEngine,
	playable: PlayableTrackSource,
	trackId: string,
): void {
	if (playable.kind === "file") engine.preload(playable.file, trackId);
	else engine.preloadSource({ kind: "url", url: playable.url }, trackId);
}

function setupMediaSession(): void {
	if (!("mediaSession" in navigator)) return;
	// Each handler is registered independently so one unsupported action
	// never prevents the rest. Background playback relies on these plus the
	// HTMLAudioElement continuing while hidden — no visibility pause exists
	// anywhere in this app by design.
	const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
		["play", () => togglePlayback()],
		[
			"pause",
			() => {
				usePlayerStore.getState().setStatus("paused");
				engineRef.current?.pause();
			},
		],
		[
			"stop",
			() => {
				usePlayerStore.getState().setStatus("paused");
				engineRef.current?.pause();
			},
		],
		["previoustrack", () => previousTrack()],
		["nexttrack", () => nextTrack()],
		["seekbackward", (details) => seekBySeconds(-(details.seekOffset ?? 10))],
		["seekforward", (details) => seekBySeconds(details.seekOffset ?? 10)],
		[
			"seekto",
			(details) => {
				if (details.seekTime != null) seekTo(details.seekTime);
			},
		],
	];
	for (const [action, handler] of handlers) {
		try {
			navigator.mediaSession.setActionHandler(action, handler);
		} catch {
			// Unsupported action in this browser; others still apply.
		}
	}
}

// Module-level engine so stable callbacks (MediaSession) can reach it.
const engineRef: { current: PlaybackEngine | null } = { current: null };

/**
 * Engine access for visualizers, meters, and output-device UI.
 * Components never load audio through it — only inspect taps/settings.
 */
export function getPlaybackEngine(): PlaybackEngine | null {
	return engineRef.current;
}

/**
 * Effective preamp for a track: manual PEQ preamp plus the ReplayGain
 * selection, clamped once. This is the SINGLE gain application point —
 * ReplayGain is never applied anywhere else (no double-apply).
 */
export function effectivePreampDb(
	manualPreampDb: number,
	mode: "off" | "track" | "album",
	track: Track | undefined,
): { preampDb: number; rgDb: number; rgSource: string } {
	const { gainDb, source } = selectReplayGain(mode, {
		trackGainDb: track?.replayGain?.trackGainDb ?? null,
		trackPeak: track?.replayGain?.trackPeak ?? null,
		albumGainDb: track?.replayGain?.albumGainDb ?? null,
		albumPeak: track?.replayGain?.albumPeak ?? null,
	});
	const manual = Number.isFinite(manualPreampDb) ? manualPreampDb : 0;
	const preampDb = Math.min(
		BAND_LIMITS.preamp.max,
		Math.max(BAND_LIMITS.preamp.min, manual + gainDb),
	);
	return { preampDb, rgDb: gainDb, rgSource: source };
}

/** Seek an activated deck to a CUE segment start (metadata is ready). */
function seekCueStart(engine: PlaybackEngine, track: Track): void {
	if (track.cue) engine.seek(track.cue.startSec);
}

function updateMediaMetadata(trackId: string | null): void {
	if (typeof navigator === "undefined" || !("mediaSession" in navigator))
		return;
	if (!trackId) {
		navigator.mediaSession.metadata = null;
		return;
	}
	const track = useLibraryStore.getState().tracks[trackId];
	if (!track) return;
	const artworkId = track.artworkId;
	try {
		navigator.mediaSession.metadata = new MediaMetadata({
			title: track.title,
			artist: track.artist,
			album: track.album,
			artwork: [],
		});
	} catch {
		// Older browsers accept fewer fields; playback is unaffected.
	}
	updatePositionState();
	if (!artworkId) return;
	// Fill in cover art when the cache resolves; ignore stale responses
	// after the user moved on to another track.
	void libraryService.getArtworkUrl(artworkId).then((url) => {
		if (!url || !("mediaSession" in navigator)) return;
		const current = usePlayerStore.getState().currentTrackId();
		if (current !== trackId) return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: track.artist,
				album: track.album,
				artwork: [{ src: url, sizes: "512x512" }],
			});
		} catch {
			// Artwork is decorative; playback is unaffected.
		}
	});
}

/**
 * Guarded position-state payload (unit-testable): finite duration > 0,
 * finite position clamped to [0, duration], finite sane rate. Null when
 * nothing should be published.
 */
export function positionStatePayload(
	duration: number | null,
	position: number,
	rate: number,
): { duration: number; playbackRate: number; position: number } | null {
	if (duration == null || !Number.isFinite(duration) || duration <= 0)
		return null;
	if (!Number.isFinite(position) || !Number.isFinite(rate)) return null;
	if (rate <= 0 || rate > 4) return null;
	return {
		duration,
		playbackRate: rate,
		position: Math.min(Math.max(0, position), duration),
	};
}

function updatePositionState(): void {
	try {
		if (typeof navigator === "undefined") return;
		const session = navigator.mediaSession;
		if (
			!("mediaSession" in navigator) ||
			typeof session.setPositionState !== "function"
		)
			return;
		const player = usePlayerStore.getState();
		const payload = positionStatePayload(
			player.duration,
			player.currentTime,
			player.rate,
		);
		if (!payload) return;
		session.setPositionState(payload);
	} catch {
		// setPositionState is unsupported in some browsers (e.g. Safari);
		// capability-detected no-op, playback unaffected.
	}
}

export interface PlayOptions {
	/** Swap in a staged standby deck instead of reloading (auto-advance). */
	usePreload?: boolean;
	/** Suppress the error banner (auto-skip tries the next item instead). */
	quiet?: boolean;
}

export async function playTrack(
	trackId: string | null,
	autoplay: boolean,
	opts?: PlayOptions,
): Promise<boolean> {
	const engine = engineRef.current;
	if (!engine || !trackId) return false;
	const token = ++playToken;
	const player = usePlayerStore.getState();
	if (
		opts?.usePreload &&
		engine.preloadedKey === trackId &&
		engine.activatePreload()
	) {
		player.setStatus("loading");
		updateMediaMetadata(trackId);
		const preloaded = useLibraryStore.getState().tracks[trackId];
		if (preloaded) seekCueStart(engine, preloaded);
		if (!autoplay) {
			player.setStatus("paused");
			return true;
		}
		try {
			await engine.play();
			if (token !== playToken) return false;
			player.clearError();
			await libraryService.beginPlayback(trackId);
			return true;
		} catch {
			return false;
		}
	}
	const file = await resolveForPlay(trackId);
	if (token !== playToken) return false; // superseded while resolving
	if (!file) {
		if (!opts?.quiet) {
			player.setError(resolutionMessage(trackId, lastResolveError));
		}
		return false;
	}
	refreshTriedFor = null;
	engineLoad(engine, file, trackId);
	const loaded = useLibraryStore.getState().tracks[trackId];
	if (loaded?.cue) {
		// Segment start needs metadata; a one-shot seek lands it exactly.
		// Ready-state races resolve via the loadedmetadata event, which
		// always fires after src assignment.
		const off = engine.on("loadedmetadata", () => {
			off();
			if (usePlayerStore.getState().currentTrackId() === trackId) {
				engine.seek(loaded.cue?.startSec ?? 0);
			}
		});
	}
	player.setStatus("loading");
	updateMediaMetadata(trackId);
	if (!autoplay) {
		player.setStatus("paused");
		return true;
	}
	try {
		await engine.play();
		if (token !== playToken) return false;
		player.clearError();
		await libraryService.beginPlayback(trackId);
		return true;
	} catch {
		// Engine already emitted "error"; the store carries the message.
		return false;
	}
}

/**
 * Natural track end: finish history, then walk forward skipping
 * missing/unplayable items (bounded by queue length). Ends the session
 * when nothing playable remains.
 */
async function advanceAfterEnd(): Promise<void> {
	const engine = engineRef.current;
	const startState = usePlayerStore.getState();
	const finishedId = startState.currentTrackId();
	const peeked = startState.peekNext(true);
	if (
		engine &&
		peeked &&
		peeked !== finishedId &&
		engine.preloadedKey === peeked &&
		engine.activatePreload()
	) {
		const player = usePlayerStore.getState();
		const id = player.next(true);
		if (finishedId) await libraryService.finishPlayback(finishedId, true);
		if (!id) return;
		startState.setStatus("loading");
		updateMediaMetadata(id);
		try {
			await engine.play();
			player.clearError();
			await libraryService.beginPlayback(id);
		} catch {
			// Activation raced (e.g. immediate user skip): fall through.
			await advanceLoop(finishedId);
		}
		return;
	}
	await advanceLoop(finishedId);
}

async function advanceLoop(finishedId: string | null): Promise<void> {
	if (finishedId) await libraryService.finishPlayback(finishedId, true);
	const bound = usePlayerStore.getState().queue.length + 1;
	for (let i = 0; i < bound; i++) {
		const id = usePlayerStore.getState().next(true);
		if (!id) return; // store set status to "ended"
		if (await playTrack(id, true, { quiet: true })) return;
	}
}

/** Stage the upcoming track on the standby deck (bounded lookahead of one). */
async function preloadNext(): Promise<void> {
	const engine = engineRef.current;
	if (!engine || engine.preloadedKey) return;
	const player = usePlayerStore.getState();
	if (player.status !== "playing" && player.status !== "paused") return;
	if (preloadFailedFor) {
		// One attempt per queue position; a new track resets the guard.
		if (player.peekNext(true) === preloadFailedFor) return;
		preloadFailedFor = null;
	}
	const id = player.peekNext(true);
	if (!id || id === player.currentTrackId()) return;
	const file = await resolveForPlay(id);
	// Drop the result if the queue moved on while resolving.
	if (usePlayerStore.getState().peekNext(true) !== id) return;
	if (!file) {
		preloadFailedFor = id;
		return;
	}
	enginePreload(engine, file, id);
}

/** Start an equal-power crossfade when the trigger window is reached. */
async function maybeCrossfade(remaining: number | null): Promise<void> {
	const engine = engineRef.current;
	if (!engine || engine.isFading) return;
	const player = usePlayerStore.getState();
	if (!player.crossfadeEnabled || player.status !== "playing") return;
	if (
		remaining == null ||
		remaining > player.crossfadeDuration ||
		remaining < 0.3
	)
		return;
	const nextId = player.peekNext(true);
	const currentId = player.currentTrackId();
	if (!nextId || nextId === currentId || engine.preloadedKey !== nextId) return;
	const ok = await engine.beginCrossfade(player.crossfadeDuration);
	if (!ok) return;
	// The new deck is audible: advance bookkeeping to match.
	const finishedId = currentId;
	const id = usePlayerStore.getState().next(true);
	if (finishedId) await libraryService.finishPlayback(finishedId, true);
	if (!id) return;
	preloadFailedFor = null;
	updateMediaMetadata(id);
	usePlayerStore.getState().clearError();
	await libraryService.beginPlayback(id);
}

export function previousTrack(): void {
	const player = usePlayerStore.getState();
	const snapshot = engineRef.current?.snapshot();
	// Standard transport behavior: restart when well into the track.
	if (snapshot && snapshot.currentTime > 3) {
		engineRef.current?.seek(0);
		player.setTime(0);
		return;
	}
	const id = player.previous();
	if (!id) {
		// At the start: restart instead of changing tracks.
		engineRef.current?.seek(0);
		player.setTime(0);
		return;
	}
	void playTrack(id, player.status === "playing" || player.status === "ended");
}

/** Manual next: always advances (repeat-one only affects natural endings). */
export function nextTrack(): void {
	void advanceManual();
}

async function advanceManual(): Promise<void> {
	const bound = usePlayerStore.getState().queue.length + 1;
	for (let i = 0; i < bound; i++) {
		const id = usePlayerStore.getState().next(false);
		if (!id) return;
		// The first failure reports loudly; the walk continues quietly like
		// auto-advance instead of sticking the transport on an error.
		// A later success clears the banner via playTrack.
		if (await playTrack(id, true, { quiet: i > 0 })) return;
	}
}

export function togglePlayback(): void {
	const engine = engineRef.current;
	const player = usePlayerStore.getState();
	if (!engine) return;
	if (player.status === "playing") {
		engine.pause();
		return;
	}
	if (player.status === "loading") return; // transition in flight
	if (player.status === "paused") {
		// Resume in place: reloading here would restart the track from 0.
		void engine.play().catch(() => {
			// The engine error event carries the message to the store.
		});
		return;
	}
	const id = player.currentTrackId();
	if (id) void playTrack(id, true);
}

/**
 * Stop audio and empty the queue. Clearing store state alone would leave
 * the loaded element playing with an "idle" UI.
 */
export function stopPlayback(): void {
	playToken += 1; // supersede any in-flight load
	engineRef.current?.pause();
	usePlayerStore.getState().clearQueue();
	updateMediaMetadata(null);
}

/**
 * Remove one queue item, keeping the engine coherent: removing the current
 * item advances into whatever slid into its place (or pauses when the
 * queue empties) instead of playing a ghost title.
 */
export function removeQueueItem(queueId: string): void {
	const before = usePlayerStore.getState();
	const idx = before.queue.findIndex((q) => q.queueId === queueId);
	if (idx === -1) return;
	const wasCurrent = idx === before.currentIndex;
	const wasActive = before.status === "playing" || before.status === "loading";
	before.removeFromQueue(queueId);
	if (!wasCurrent) return;
	playToken += 1;
	const after = usePlayerStore.getState();
	const id = after.currentTrackId();
	if (!id) {
		engineRef.current?.pause();
		updateMediaMetadata(null);
		return;
	}
	void playTrack(id, wasActive);
}

/**
 * Reconcile the queue after library tracks disappear (delete or library
 * reset). Non-current items are pruned silently; a removed current item
 * behaves like remove-current above. Exported for unit tests; the live
 * wiring is the library-tracks subscription in usePlaybackController.
 */
export function reconcileRemovedTracks(removedIds: readonly string[]): void {
	if (removedIds.length === 0) return;
	const gone = new Set(removedIds);
	const before = usePlayerStore.getState();
	const affected = before.queue.filter((q) => gone.has(q.trackId));
	if (affected.length === 0) return;
	const currentId = before.currentTrackId();
	const currentRemoved = currentId !== null && gone.has(currentId);
	const wasActive = before.status === "playing" || before.status === "loading";
	for (const item of affected) {
		usePlayerStore.getState().removeFromQueue(item.queueId);
	}
	if (!currentRemoved) return;
	playToken += 1;
	const after = usePlayerStore.getState();
	const id = after.currentTrackId();
	if (!id) {
		engineRef.current?.pause();
		updateMediaMetadata(null);
		return;
	}
	void playTrack(id, wasActive);
}

/**
 * Reload a remote track with a freshly resolved URL at the last known
 * position. Resolution is always fresh (temporary URLs expire), so this
 * is the single refresh path for expiry and session rotation alike.
 */
async function refreshRemotePlayback(
	engine: PlaybackEngine,
	trackId: string,
): Promise<void> {
	const player = usePlayerStore.getState();
	const position = engine.snapshot().currentTime;
	const fresh = await resolveForPlay(trackId);
	if (usePlayerStore.getState().currentTrackId() !== trackId) return;
	if (!fresh || fresh.kind !== "url") {
		player.setError(resolutionMessage(trackId, lastResolveError));
		return;
	}
	player.setStatus("loading");
	engineLoad(engine, fresh, trackId);
	try {
		engine.seek(Math.max(0, position));
	} catch {
		// Seek past the refreshed duration clamps inside the engine.
	}
	try {
		await engine.play();
		player.clearError();
		await libraryService.beginPlayback(trackId);
	} catch {
		player.setError(engine.getError() ?? resolutionMessage(trackId, null));
	}
}

export function seekTo(seconds: number): void {
	const engine = engineRef.current;
	if (!engine) return;
	usePlayerStore.getState().setSeeking(true);
	engine.seek(seconds);
	usePlayerStore.getState().setTime(seconds);
}

export function seekBySeconds(delta: number): void {
	const snapshot = engineRef.current?.snapshot();
	if (!snapshot) return;
	seekTo(snapshot.currentTime + delta);
}

let positionBucket = -1;

export function usePlaybackController(): void {
	useEffect(() => {
		const engine = new PlaybackEngine();
		engineRef.current = engine;

		const offTime = engine.on("timeupdate", () => {
			const snap = engine.snapshot();
			const player = usePlayerStore.getState();
			// CUE segment end: advance exactly like a natural track end.
			// Bounded: advancing moves the current track, so this fires once.
			const activeId = player.currentTrackId();
			const activeTrack = activeId
				? useLibraryStore.getState().tracks[activeId]
				: undefined;
			if (
				player.status === "playing" &&
				activeTrack?.cue?.endSec != null &&
				snap.currentTime >= activeTrack.cue.endSec
			) {
				void advanceAfterEnd();
				return;
			}
			player.setTime(snap.currentTime);
			// Throttled position state: once per 5s bucket, never per tick.
			const bucket = Math.floor(snap.currentTime / 5);
			if (bucket !== positionBucket) {
				positionBucket = bucket;
				updatePositionState();
			}
			const remaining =
				snap.duration != null ? snap.duration - snap.currentTime : null;
			if (remaining != null && remaining < 20) void preloadNext();
			void maybeCrossfade(remaining);
		});
		const offMeta = engine.on("loadedmetadata", () => {
			const snap = engine.snapshot();
			const player = usePlayerStore.getState();
			const trackId = player.currentTrackId();
			const cueTrack = trackId
				? useLibraryStore.getState().tracks[trackId]
				: undefined;
			if (cueTrack?.cue) {
				// Virtual CUE segment: the UI clock runs on the segment,
				// not the underlying file.
				const end = cueTrack.cue.endSec ?? snap.duration;
				player.setDuration(
					end != null
						? Math.max(0, end - cueTrack.cue.startSec)
						: snap.duration,
				);
			} else {
				player.setDuration(snap.duration);
			}
			engine.applyVolume(player.volume, player.muted);
			engine.setRate(player.rate);
			updatePositionState();
			if (trackId) void libraryService.updateDuration(trackId, snap.duration);
			void preloadNext();
		});
		const offEnded = engine.on("ended", () => {
			void advanceAfterEnd();
		});
		const offPlay = engine.on("play", () => {
			usePlayerStore.getState().setStatus("playing");
			updatePositionState();
		});
		const offPause = engine.on("pause", () => {
			// load() aborts the element and may fire pause; only honor pauses
			// that are not part of a track switch.
			const player = usePlayerStore.getState();
			if (player.status === "playing") player.setStatus("paused");
			updatePositionState();
		});
		const offSeeking = engine.on("seeking", () => {
			usePlayerStore.getState().setSeeking(true);
		});
		const offSeeked = engine.on("seeked", () => {
			const player = usePlayerStore.getState();
			player.setSeeking(false);
			player.setTime(engine.snapshot().currentTime);
			updatePositionState();
		});
		const offError = engine.on("error", () => {
			const player = usePlayerStore.getState();
			// Auto-transition failure: try the next item instead of sticking.
			if (player.status === "loading") {
				void advanceLoop(player.currentTrackId());
				return;
			}
			// Mid-playback remote failure (expired temporary URL, rotated
			// session): one transparent refresh at the last position before
			// surfacing an error. Local tracks skip straight to the banner.
			const id = player.currentTrackId();
			const track = id ? useLibraryStore.getState().tracks[id] : undefined;
			if (id && track?.remote && refreshTriedFor !== id) {
				refreshTriedFor = id;
				void refreshRemotePlayback(engine, id);
				return;
			}
			player.setError(engine.getError());
		});
		const offPreloadError = engine.on("preloaderror", () => {
			// Standby failed in the background; the active track is fine.
			// The next advance will skip it via resolveFile returning null.
			preloadFailedFor = engine.preloadedKey;
		});

		const onVisibility = () => {
			if (document.hidden) return;
			// Background policy: audio NEVER pauses on hide — the element
			// keeps playing. Only UI resyncs here (timeupdate throttles in
			// background tabs, so resync from the authoritative engine).
			const snap = engine.snapshot();
			usePlayerStore.getState().setTime(snap.currentTime);
			updatePositionState();
		};
		document.addEventListener("visibilitychange", onVisibility);

		setupMediaSession();
		// Apply persisted preferences to the (future) graph on first metadata.
		const player = usePlayerStore.getState();
		engine.setRate(player.rate);

		return () => {
			offTime();
			offMeta();
			offEnded();
			offPlay();
			offPause();
			offSeeking();
			offSeeked();
			offError();
			offPreloadError();
			document.removeEventListener("visibilitychange", onVisibility);
			engine.destroy();
			engineRef.current = null;
		};
	}, []);

	// Sync volume/mute/rate/pitch changes into the engine.
	const volume = usePlayerStore((s) => s.volume);
	const muted = usePlayerStore((s) => s.muted);
	const rate = usePlayerStore((s) => s.rate);
	const preservePitch = useSettingsStore((s) => s.preservePitch);
	const outputDeviceId = useSettingsStore((s) => s.outputDeviceId);
	useEffect(() => {
		engineRef.current?.applyVolume(volume, muted);
	}, [volume, muted]);
	useEffect(() => {
		engineRef.current?.setRate(rate);
	}, [rate]);
	useEffect(() => {
		engineRef.current?.setPreservePitch(preservePitch);
	}, [preservePitch]);
	useEffect(() => {
		if (outputDeviceId) void engineRef.current?.setOutputDevice(outputDeviceId);
	}, [outputDeviceId]);

	// Sync the full DSP chain (smoothed native param updates).
	// Gain order (documented in docs/audio-engine.md):
	//   ReplayGain → manual preamp (added once here) → EQ → tone →
	//   dynamics → spatial → limiter → master. Nothing else adds gain.
	const eqEnabled = useEQStore((s) => s.profile.enabled);
	const eqPreamp = useEQStore((s) => s.profile.preamp);
	const eqBands = useEQStore((s) => s.profile.bands);
	const eqMode = useDspStore((s) => s.eqMode);
	const graphic = useDspStore((s) => s.graphic);
	const bass = useDspStore((s) => s.bass);
	const treble = useDspStore((s) => s.treble);
	const tuner = useDspStore((s) => s.tuner);
	const limiter = useDspStore((s) => s.limiter);
	const compressor = useDspStore((s) => s.compressor);
	const spatial = useDspStore((s) => s.spatial);
	const reverb = useDspStore((s) => s.reverb);
	const loudness = useDspStore((s) => s.loudness);
	const replayGainMode = useDspStore((s) => s.replayGainMode);
	const masterBypass = useDspStore((s) => s.masterBypass);
	const comparing = useDspStore((s) => s.comparing);
	const currentId = usePlayerStore(
		(s) => s.queue[s.currentIndex]?.trackId ?? null,
	);
	const libraryTracks = useLibraryStore((s) => s.tracks);
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		// EQ section: exactly one of parametric / graphic is live, gated
		// by the EQ master toggle.
		const eqLive =
			eqMode === "graphic"
				? graphicToBands(graphic).map((b) => ({
						type: b.type,
						frequency: b.frequency,
						gain: b.gain,
						q: b.q,
						enabled: graphic.enabled && eqEnabled,
					}))
				: eqBands.map((b) => ({
						type: b.type,
						frequency: b.frequency,
						gain: b.gain,
						q: b.q,
						enabled: b.enabled && eqEnabled,
					}));
		// Loudness compensation rides the pool as static shelves (the
		// tone module carries bass/treble/tuner on dedicated nodes —
		// never both, no double-apply).
		const bands: DspBandParams[] = [...eqLive];
		for (const stage of toLoudnessBands(loudness)) {
			bands.push({ ...stage });
		}
		const toneActive =
			toToneBands(bass, treble).length > 0 || toTunerBands(tuner).length > 0;
		// ReplayGain: single application point (never anywhere else).
		const track = currentId ? libraryTracks[currentId] : undefined;
		const { preampDb } = effectivePreampDb(eqPreamp, replayGainMode, track);
		engine.applyDspProfile(preampDb, bands);
		engine.applyToneProfile({ bass, treble, tuner });
		engine.applyDynamicsProfile(compressor);
		const matrix = spatialMatrix(spatial);
		const spatialActive =
			spatial.enabled &&
			!(
				matrix[0]?.[0] === 1 &&
				matrix[0]?.[1] === 0 &&
				matrix[1]?.[0] === 0 &&
				matrix[1]?.[1] === 1
			);
		engine.applySpatialProfile(matrix, spatialActive);
		engine.applyReverbProfile(reverb);
		engine.setLimiterEnabled(limiter.enabled);
		engine.setLimiterCeiling(limiter.ceilingDb);
		// The chain engages when EQ or any module is active; otherwise the
		// engine bypasses mix→master untouched. Master bypass and momentary
		// A/B comparison disengage listening only — stored configuration
		// is never mutated by either.
		const chainEngaged =
			(bands.some((b) => b.enabled) ||
				toneActive ||
				compressor.enabled ||
				spatialActive ||
				(reverb.enabled && reverb.mix > 0) ||
				limiter.enabled) &&
			!masterBypass &&
			!comparing;
		engine.setDspEnabled(chainEngaged);
	}, [
		eqEnabled,
		eqPreamp,
		eqBands,
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
		currentId,
		libraryTracks,
		masterBypass,
		comparing,
	]);

	// Reconcile the queue when library tracks disappear (delete/reset).
	// Store-level removal already prunes playlists/favorites; the player
	// queue needs the same treatment plus engine coherence, which only
	// this controller can provide.
	useEffect(() => {
		let previous = new Set(Object.keys(useLibraryStore.getState().tracks));
		return useLibraryStore.subscribe((s) => {
			const current = new Set(Object.keys(s.tracks));
			const removed = [...previous].filter((id) => !current.has(id));
			previous = current;
			reconcileRemovedTracks(removed);
		});
	}, []);
}
