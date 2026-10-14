# DSP engine (Phase 5: preamp + PEQ + limiter)

## Signal chain

```
deck gains → mix → [preamp Gain → PEQ BiquadFilterNodes → WaveShaper limiter]
             → master (volume) → destination
```

The bracketed section is bypassed as a unit: disabled means mix connects
straight to master — no teardown, no clicks, parameters preserved. Enabled
with zero bands still applies preamp + limiter (both meaningful alone).

## Architecture decision: native nodes (no AudioWorklet)

Criteria from §18, all favoring native `BiquadFilterNode`: cookbook-identical
math, audio-thread C++, zero added latency, a-rate zipper-free updates,
Baseline-2015 compat, testable via pure math + `getFrequencyResponse`,
trivial AutoEQ mapping (set node params), cheapest on mobile, no worklet
module or base-path asset. A custom Worklet would be justified only by
non-biquad processing (FIR/convolution) or sample readback — neither is a
Phase 5 requirement. References: `docs/dsp-research.md`.

## Filter model

`FilterType`: peaking, lowshelf, highshelf, lowpass, highpass, notch,
bandpass. `EQBand {id, type, frequency, gain, q, enabled}`;
`PEQProfile {preamp, bands[], enabled}` — **the future AutoEQ contract**:
an optimizer will return this same type, consumed unchanged.

UI Q/gain semantics match `BiquadFilterNode` exactly: Q ignored on shelves
(fixed slope), gain ignored on pass/notch/bandpass filters.

## Coefficient model

Pure `createBiquad(band, sampleRate)` (W3C RBJ cookbook) → normalized
`{b0,b1,b2,a1,a2}` (a0 = 1). Total function: invalid input yields unity,
never NaN/throw. One verified divergence from textbook RBJ: **lowpass/
highpass use the spec's dB-scaled Q** (`α = sinω0/(2·10^(Q/20))`), caught by
the node-equivalence suite (node read +0.71 dB where RBJ predicts −3.01).
Stability enforced by the pole-triangle test at creation.

The offline `BiquadProcessor` (Direct Form 1, per-channel state) and
`PEQChain` (preamp → stages → limiter, no loop allocations) exist for
analysis/future use — realtime playback uses native nodes.

## Response calculation

`biquadMagnitudeDb` (closed-form H(e^{jω})), `peqMagnitudeDb` (preamp +
enabled-band sum; dB adds), `responseGrid` (log 20 Hz–20 kHz). The UI graph
renders from these exact functions — no parallel UI math.

## Preamp and headroom

Preamp (dB, ±24) is gain staging ahead of the bands — distinct from master
volume. The UI computes profile peak from the response engine and suggests
negating compensation (`suggestedPreampCompensation`), one click to apply.
Unheeded boosts hit the limiter backstop, never silent clipping.

## Limiter

WaveShaper hard-clip at −1 dBFS ceiling (strict sample-peak bound, zero
latency). NOT true-peak (no oversampling) and not called that. The pure
`PeakLimiter` (instant attack, 50 ms release) documents and tests the
behavioral contract offline.

## Bypass and updates

Bypass rewires mix→master synchronously, nodes intact. Live edits use
`setTargetAtTime` (15 ms) on a-rate params — no zipper noise, no teardown.
Band add/remove grows/parks a node pool (cap 24 structural, 12 UI).

## Preset format

```json
{ "version": 1, "preamp": -5.2, "enabled": true,
  "bands": [{ "type": "peaking", "frequency": 60, "gain": 2.5, "q": 0.7, "enabled": true }] }
```

Versioned, coefficient-free (recomputed per context rate), validated on
load with unknown fields tolerated. Persisted in localStorage via the
existing prefs helper — no new storage technology. Position, not client id,
is band identity.

## Testing strategy

- Pure math: definitional response (peaking hits gain at Fc, shelf DC/
  Nyquist, filter extremes), flat-wire symmetry, cascade additivity,
  impulse/step boundedness, stability grid (7 types × params × 3 rates),
  limiter bounds + recovery, serialization round-trips, golden cases.
- Node equivalence (browser): `getFrequencyResponse` vs independent
  cookbook transcription — peaking, both shelves (via app pure core in
  earlier runs), LP/HP incl. the α_QdB divergence, flat wire.
- Regression (§27): DSP on/off/bypassed playback clock advances (a broken
  link freezes it — the Phase 4 lesson as oracle) + fake-graph attach
  assertions + deck→mix→DSP→master wiring review.
- E2E: EQ open/enable/add/edit, graph updates from the same engine,
  preset save→reload→survive, preamp hint apply, playback continuity
  across bypass toggles, Firefox core flows.

## Future AutoEQ interface

```
measurement → target → optimizer → PEQProfile → DSP engine
```

The optimizer returns `PEQProfile` (this phase's type, unchanged); IEM work
adds `{name, measurement, target, eq}` around it without touching the
engine. No measurement code exists yet by design.

## Extended module graph (audiophile batch)

The Phase 5 core above is unchanged. The live chain around it grew into
the modular graph documented in `docs/audio-engine.md`: preamp → PEQ /
graphic pool → tone shelves (bass/treble/tuner) → DynamicsCompressor +
makeup → 2×2 spatial matrix → parallel generated-IR reverb → peak
safety limiter → master. Pure models live in `src/dsp/` (`graphic`,
`tone`, `dynamics`, `spatial`, `loudness`, `replaygain`, `reverb`,
`formats`, `cue`, `lyrics`, `smart`, `behavioral`, `snapshot`);
persistence and layering in `src/state/dsp-store.ts`; device snapshots
in `docs/device-profiles.md`; exchange formats in `docs/presets.md`.
