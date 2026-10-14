# Audio engine: modular DSP graph

Companion to `docs/dsp.md` (filter-model foundations, unchanged). This
document covers the extended module graph: order, bypass semantics, the
gain architecture, browser verification, and honest limits.

## Signal chain (fixed order)

```
deck gains → mix → preamp → PEQ pool → tone shelves → dynamics →
spatial → ┬→ limiter (peak safety shaper) → master (volume) → destination
          └→ reverb send → predelay → convolver → wet ─┘ (parallel)
```

`src/audio/engine/dsp-chain.ts` (`NativeDspChain`). Bypass is by
**exclusion**: disabled modules are disconnected out of the path
(`rewire()` first disconnects every stage output, then rebuilds, so no
stale unity-wired path can ever double the signal — regression-tested).
With everything off, mix connects straight to master.

## Gain order (audited, single-point each)

```
ReplayGain → manual preamp (added ONCE in the controller) → EQ →
tone/tuner/loudness → dynamics (+ makeup) → spatial (unity at neutral)
→ limiter → master volume
```

ReplayGain lives in `effectivePreampDb` (`use-playback.ts`) and nowhere
else. Makeup gain is manual with a suggested value. Spatial matrices are
unity at neutral settings (verified). Nothing else in the codebase adds
gain to the playback path.

## Modules

| Module | Implementation | Bypass | Notes |
|---|---|---|---|
| Preamp | GainNode, ±24 dB | n/a (unity = transparent) | Headroom readout from the response model |
| PEQ / graphic | BiquadFilterNode pool (cap 40) | parked at unity when unused | One live EQ path at a time |
| Tone (bass/treble/tuner) | 4 dedicated shelves/peaks | excluded when neutral | Params mirror `dsp/tone.ts` exactly |
| Compressor | DynamicsCompressorNode + makeup GainNode | excluded | GR meter reads `node.reduction` |
| Spatial | Splitter → 4 gains (2×2) → Merger | excluded unless matrix ≠ identity | Balance/width/crossfeed/mode compose pure |
| Reverb | Parallel convolver, locally generated IR | branch disconnected when off/mix 0 | Dry path latency-free |
| Limiter | WaveShaper hard-clip ceiling | excluded when off | **Peak safety limiter: sample-peak, NOT true-peak** |

## Why no AudioWorklet (validation gate, Phase BH)

Every module above maps onto a native node with documented semantics:
biquads (cookbook), DynamicsCompressor (documented curve + meter),
splitter/merger gains (linear algebra), convolver (LTI reverb). No
measured requirement needs sample-level JS: no FIR design, no sample
readback, no non-standard dynamics law. Offline renders through the
shipped code (`e2e/dsp-offline.spec.ts`) confirm limiter bounding,
compression, routing, reverb tails, and shelf lifts. A Worklet would add
threading, latency, and base-path asset complexity for zero audible
gain — rejected with evidence, re-evaluable if a future module (e.g.
linear-phase FIR) demands it. No WASM/Rust/SharedArrayBuffer/WebCodecs
anywhere in the audio path.

## Honest limits (also surfaced in UI)

- **In-player DSP only.** The graph processes audio this app plays
  (local files, cloud/remote sources via media elements). It cannot EQ
  other apps, other browser tabs, or OS audio — the Settings About
  section and DSP view say so verbatim.
- **Limiter is sample-peak.** Inter-sample (true) peaks can still clip
  downstream; the UI labels it "Peak safety limiter", never "true peak".
- **Compressor curves are the browser's.** Our static model
  (`dsp/dynamics.ts`) predicts ballistics-free behavior for plots; the
  node adds attack/release smoothing. Verified finding: hard-knee
  extremes add measurable harmonic energy (RMS alone misreads it), so
  verification uses musical settings plus the node's own meter.
- **Loudness is relative and approximate.** Browser volume is not
  calibrated SPL; compensation fades to exactly zero at reference.
  No ISO 226 claim is made (licensed reference data is not bundled).
- **Reverb is synthetic ambience.** Locally generated decaying-noise
  IRs; labeled as artificial, default off.
- **Width above neutral risks mono cancellation.** The UI warns and
  offers a mono check mode.
- **No bit-perfect/exclusive output.** The browser/OS mixer owns
  resampling and routing; the Output section shows the render rate and
  says so.

## Verification

- Unit: pure models (`graphic/tone/dynamics/spatial/loudness/
  replaygain/reverb` tests), chain routing with a recording fake
  context (9 tests — caught a real double-path bug), response engine.
- Browser: `e2e/dsp-offline.spec.ts` renders the shipped modules
  through OfflineAudioContext (5 acoustic assertions);
  `e2e/dsp-nodes.spec.ts` keeps node↔cookbook equivalence;
  `e2e/dsp.spec.ts` drives every module card on Chromium + mobile.
- Performance: nodes are created once and parked, never torn down;
  param updates are a-rate smoothed; the analyser tap is lazy;
  visualizers pause off-screen. No render-thread JS exists to profile.
