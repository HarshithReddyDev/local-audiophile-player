# AutoEQ measurement smoothing (Phase 8D)

Optional preprocessing that tames point-to-point measurement noise before
fitting. Default **Off**; opt-in per preset. Raw measurements are never
modified — smoothing derives a separate fitting curve.

## Why smoothing exists

Phase 7.5 classified case 18 (noisy response) as mild filter chasing:
narrow Q≈6 bands parked on ±1.5 dB noise wiggles, including an opposing
pair at 985 Hz. Tighter Q/gain caps were rejected as the fix (they would
hurt legitimate narrow cases like 07). Smoothing the *input* is the
principled candidate: remove noise before fitting instead of constraining
the fitter afterward.

Pipeline position (target never smoothed — it is an intentional reference):

```
Raw Measurement → [optional smoothing] → fitMeasurement → Target
→ Compensation → AutoEQ → PEQProfile (unchanged structure)
```

## Research: methods evaluated (§3)

| Method | Verdict |
|---|---|
| A. Moving average, linear Hz | Rejected: a fixed-Hz window spans ~1000× different octave widths at 50 Hz vs 15 kHz. |
| B. Gaussian, log-domain | Tested rival: stronger-than-nominal effect at σ=w/2 (dev 0.58 vs 0.23 dB), 2.7× slower, identical fit outcome. No demonstrated benefit over boxcar. Rejected. |
| C. Savitzky–Golay | Rejected without implementation: polynomial overshoot/ringing risk near sharp edges, fiddly edges, hard to explain. Criteria demand no overshoot. |
| D. Log-frequency moving average (boxcar) | **Selected.** Convex combination ⇒ no overshoot by construction, predictable, deterministic, ~1 ms, one-sentence explanation. |
| E/F. Octave / fractional-octave smoothing | **Selected, same thing:** D with the window specified in octaves — the REW-style family; upstream AutoEq's `smoothen` is octave-window averaging in the same family. |
| G. Psychoacoustic (ERB/bark) weighting | Rejected: complexity without evidence for a preprocessing step. Fanciest ≠ best. |

## Mathematical definition

For output point `f`, with total window `w` octaves:

```
avg of interpolateLog(raw, x) over 32 log-uniform samples x
in [max(fMin, f·2^(−w/2)), min(fMax, f·2^(+w/2))]
```

Output is a 256-point uniform log grid over the input's valid range
(interpolate-then-smooth). Edges clip the window and renormalize —
never extrapolated, range never extended. `w ≤ 0` returns an exact copy
(the Off path stays mathematically identical to unsmoothed fitting).

Frequency-domain properties: the window is constant in octaves (auditory
scaling honored); a 1/12-oct window is ±0.5 semitone; narrow features far
wider than the window pass nearly untouched; boxcar averaging cannot
create values outside the averaged inputs (no overshoot, monotonicity
preserved — both unit-tested).

## Presets

| Preset | Window | Meaning |
|---|---|---|
| Off | 0 | Fit as imported. Reference behavior. Default. |
| Light | 1/12 oct | Tames small fluctuations; keeps narrow features. |
| Moderate | 1/6 oct | Stronger suppression; can soften legitimate narrow features. |

Widths set by benchmark, not invention: 1/48–1/24 oct proved near-no-ops
at corpus density; 1/3 oct destroyed the Q4 resonance (peak 6.92→5.47 dB,
fit 0.019→0.158) and was excluded. 1/12 keeps the Q4 peak within
0.15 dB; 1/6 costs 0.5 dB — the documented price of Moderate.

## Preprocessing order (§17): A wins

- **A (ship): raw → interpolate (256-pt log grid) → smooth.** Behavior is
  density-independent: identical treatment for sparse and dense rigs.
- **B (rejected): raw → smooth at native points → use.** Density-weighted:
  at 20 pts/octave a 1/12-oct window contains zero neighbors (dev 0.000 —
  silent no-op); at dense sampling it over-smooths (dev 0.526 vs A's
  0.441). Same option doing nothing-or-too-much depending on rig density
  is the worse engineering choice. Measured, then rejected.

## Benchmark results

Peak preservation (07 narrow 3 kHz, raw-evaluated): Off 0.0186/3 bands →
Light 0.0223/3 (same structure, main notch −6.6 dB @ same fc) →
Moderate 0.0692/4 (peak −0.5 dB, still working correction, tripwired).

Noise case (18, raw-evaluated): Off 0.6416/7 → Light 0.6382/8 →
Moderate 0.6288/8; maxAbs 1.85→1.72→1.63. RMS flat, count +1: on this
sparse (200-pt) + heavy-noise corner, smoothing reshapes more than it
removes. The wins appear at realistic density — 1000-pt rig exports with
the same feature/noise family: light noise 6→**1** band (single −3.1 dB
@985 Q0.99, truth RMS halved 0.088→0.044); heavy noise 7→5 bands, truth
0.264→0.156. Sparse light-noise: 5→3 bands. Corpus density (20
pts/octave) understates real-world behavior; the decision rests on the
dense evidence with the adversarial corner documented, not hidden.

Synthetic 8 (§8, raw-evaluated): narrow-peak+noise 7→6→3 bands with the
narrow-hot flag cleared; narrow-dip+noise 7→4→3; broad+noise 6→6→4 with
maxAbs improved; smooth-clean identical (3 bands, RMS 0.097→0.095 —
transparency); hf-noise mildly better; lf-noise Light costs +0.03 dB RMS
(within policy, logged honestly); mixed is the second adversarial corner
(Light +1 band, RMS flat).

Guards under Light (raw-evaluated, all within RMS policy): 02/16/20/21/10
identical-or-neutral (16: same 6-band structure to rounding); 19 clamping
identical across presets. Moderate on 16 flips greedy order (0.274→0.771,
key treble band unplaced) — same basin-sensitivity class as range presets,
tripwired (<1.0) and documented, never asserted as success.

Range × smoothing (18, 10): effective ranges identical with/without
smoothing; results compose orthogonally. HF × smoothing: HF averaging
still applies downstream (safeguards intact, treatment recorded).
Truncation (19/20): range preserved exactly, no boundary artifacts.
Sparse (20–1000 pts): finite, deterministic, valid fits throughout.

Performance (§26): 0.67 / 0.82 / 0.95 / 1.32 / 1.65 ms for
100–10k points (fixed output grid ⇒ ~constant). Negligible vs the 15 s
optimizer budget; runs synchronously pre-dispatch, worker flow and
cancellation untouched. No WASM/Worklet/SAB — offline preprocessing.

Quality metrics recorded per case (§11, §27): raw/smoothed RMS deviation
(`smoothingDeviationDb` in `results.json`), extrema counts in study logs.
Descriptive only, never perceptual claims.

## Examples

`tests/autoeq/figures/smoothing-18-noisy-light.svg` (noise tamed, 126→89
extrema), `smoothing-07-narrow-3k-peak-moderate.svg` (peak intact under
the stronger preset), `smoothing-02-bass-deficient-light.svg`
(transparency: dev 0.000). Teal = smoothed fitting input; raw never
replaced. UI preview shows the same raw + smoothed pair.

## Limitations / when NOT to use smoothing

- Clean, dense, accurate measurements: Light is transparent, Moderate is
  pure distortion risk (16 basin flip). Leave it Off.
- IEMs with legitimate narrow features near the correction target:
  prefer Light; Moderate softens them (07 evidence).
- Sparse + very noisy imports: expect reshaping rather than rescue;
  Light stays within policy but adds little.
- Smoothing changes the greedy basin: small input perturbations can
  reorder placements (inherent greedy+local behavior, also true of range
  presets). The preview exists so users see what changed.

## Acceptance (§28) and decision (§36)

1. Off bit-identical to 8C on all 22 cases ✓ (tested, fit + report level)
2. Narrow features usable: Light preserves 07 exactly in structure ✓;
   Moderate degrades-but-works, tripwired ✓
3. Noise complexity reduced where it matters: dense 6→1 / 7→5 bands,
   truth RMS halved; sparse-heavy corner neutral-to-+1-band, logged ✓
4. No pathological filters (bounds/validity asserted everywhere) ✓
5. Runtime ~1 ms ✓ 6. Byte-identical determinism ✓ 7. Cancellation
   unchanged (pre-dispatch sync) ✓ 8. Full suite green, defaults
   untouched ✓ 9. Three-radio UI + raw/smoothed preview + honest copy ✓

**Classification: A — worth shipping, default Off.** The negative corners
(sparse+heavy noise, Moderate on clean data) are documented with
tripwires rather than forced into a false success story.
