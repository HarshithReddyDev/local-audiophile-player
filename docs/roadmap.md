# Roadmap

## Phase 1: Scaffold + playback shell — DONE (this session)

Vite + React 19 + TS strict app, Zustand stores, PlaybackEngine
(HTMLAudio → MediaElementSource → gain → destination), local file/folder
import with metadata, library views, queue, playlists, settings placeholders,
PWA shell, GitHub Pages workflow, Vitest (27+ tests) + Playwright (12 checks).

## Phase 2: Library persistence — DONE

`idb`-backed repository (tracks, sources/handles, artwork Blob cache,
playlists, favorites, ratings, history/stats), stable FNV identity,
incremental scan→diff→apply, background revalidation with explicit
permission states, startup restore that never blocks playback, genre/recent/
favorites views, 10k-track perf measurements. No audio bytes stored.

## Phase 3: Queue/playlists

Persisted playlists, smarter queue (play-next/album context, history view),
duplicate handling polish.

## Phase 4: Advanced playback — DONE

Dual-deck engine (per-deck gains → mix → master; Phase 5 inserts between mix
and master), persisted queue + transport modes, deterministic shuffle-order
model, specified next/previous matrix, lookahead-1 preload, equal-power
crossfade on the audio clock, rate UI, full MediaSession, rapid-action race
guards, background/visibility handling. Measured: Chromium + Firefox +
mobile emu green; no advanced tech needed.

## Phase 5: DSP engine — DONE

Native BiquadFilterNode chain (preamp → 12-band PEQ → hard-clip limiter)
between mix and master; pure RBJ core with the spec's α_QdB LP/HP convention
(caught by node-equivalence tests); response engine shared by tests and UI
graph; bypass-by-rewire; EQ UI with draggable response graph + presets;
no Worklet/WASM. Full detail: `docs/dsp.md`, research in
`docs/dsp-research.md`.

## Phase 6: IEM profiles — DONE

Measurement model + format-detecting parser (AutoEQ/squiglink/REW layouts,
stereo split), log-frequency interpolation, target model (flat built-in +
parametric builder + imports; zero third-party data bundled per license
review), compensation curves, v2 schema migration, profile CRUD with
references, IEM section UI with trio graphs, Phase 7 contract declared.
Details: `docs/measurements.md`, `docs/targets.md`, `docs/iem-profiles.md`,
`docs/measurement-data-licenses.md`.

## Phase 7: AutoEQ — DONE

Greedy residual peak fitting + coordinate-descent refinement in a Web
Worker (generation-ID cancel, honest progress): measurement + target →
correction → `SerializedPEQ` → existing engine. Preview-first workflow with
metrics, predicted/residual graphs, discarding, manual override, and
per-profile provenance. Deterministic, dependency-free, ~10–50 ms fits.
Details: `docs/autoeq.md`, `docs/autoeq-research.md`.

## Phase 7.5: AutoEQ validation — DONE (evidence only, optimizer untouched)

22-case legal synthetic corpus with figures + machine-readable report,
variation studies (targets/ranges/counts/gains/Qs), failure classification
(refinement abandonment, overlap clusters, Q-ceiling tracking, tilt stacks,
HF averaging, truncation edges, noise chasing), engineering A/B with level
estimate, ranked Phase 8 candidates. Details: `docs/autoeq-validation.md`,
`docs/autoeq-validation-corpus.md`, `tests/autoeq/`.

## Phase 8A–8D: AutoEQ refinement — DONE (all opt-in, defaults frozen)

Fit-range presets + HF knee control, local fc refinement, opposition
pruning, optional measurement smoothing (default Off). v2 defaults
reproduce v1 bit-identically; reports carry effective range, HF
treatment, and smoothing provenance. Details: `docs/autoeq-phase8.md`,
`docs/autoeq-smoothing.md`.

## Phase 8: Advanced analysis

Analyzer node features (spectrum, loudness hints). Visualizations stay cheap
on mobile; no SharedArrayBuffer unless justified.

## Phase 9: Performance/compatibility hardening

10k-track profiling, list virtualization if measured, Safari/Firefox matrix
completion, PWA install flow polish, Pages caching review.

## Phase 10: Audiophile batch — DONE (P0 + scoped P1)

Modular native DSP graph (preamp/EQ/tone/dynamics/spatial/reverb/peak
safety limiter) with bypass-by-exclusion routing tests and offline
acoustic verification; graphic EQ (5–32); bass/treble + bass tuner;
preamp headroom readout; honest limiter labeling; compressor with live
GR meter; channel controls + width + crossfeed; generated-IR reverb
(default off); relative equal-loudness mode (no ISO claims);
ReplayGain (tags, track/album/off, peak guard, single apply point);
device DSP layers (global → device, capture/apply/backup, catalog
Use-device); preset exchange (native/GraphicEQ/APO-txt/CSV) with
loss warnings; lyrics (embedded + .lrc, synced); CUE virtual tracks;
visualizers + analysis panel; smart playlists; sort extensions;
hotkeys; output-device selection where supported; settings sections +
backup/restore. Details: `docs/audio-engine.md`,
`docs/player-features.md`, `docs/device-profiles.md`,
`docs/presets.md`, `docs/feature-parity.md`. Stable systems untouched:
AutoEQ math, Phase 8D smoothing, catalog ingestion, queue, dual deck,
IndexedDB (additive Track fields only). No Worklet/WASM (gated, with
evidence). Deliberately not built: system-wide EQ, true-peak limiting,
bit-perfect/exclusive output, SPL-calibrated loudness, streaming
playback, proprietary binary formats.
