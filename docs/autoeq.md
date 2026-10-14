# AutoEQ (Phase 7, refined in Phase 8)

Client-side PEQ generation: measurement + target → correction → fitted
`SerializedPEQ` → the existing DSP engine. No backend, no uploads, worker-
threaded, deterministic, versioned (`OPTIMIZER_VERSION = 2`; v1 behavior is
reproduced bit-identically by the v2 defaults — see
`docs/autoeq-phase8.md`).

## Input / output

`AutoEQInput {measurement, target, frequencyRange, fittingOptions}` →
`FitResult {profile: SerializedPEQ, metrics}`. The output type is identical
to manual EQ: the engine cannot distinguish fitted from hand-made profiles.

## Preprocessing

Raw measurement → optional smoothing (Phase 8D: Off/Light/Moderate
fractional-octave averaging, default Off; raw never modified, target never
smoothed — see `docs/autoeq-smoothing.md`) → clamp fit range to measured
data (never extrapolate silently) → 160-point
log grid → compensation via the shared Phase 6 math → HF treatment above the
10 kHz knee: `average` collapses compensation to its mean (default;
upstream-proven guard against treble overfitting), `fit` fits the grid as
measured (trusted rigs), `exclude` stops the grid at the knee. The UI exposes
fit-range presets (Full / 20 Hz–10 kHz / 20 Hz–8 kHz / Custom) and the HF
treatment; the effective (clamped) range is always reported back.

## Objective

RMSE between predicted cascade response and compensation over the grid.
Uniform weighting — log spacing already weights per-octave equally, the
simplest defensible choice (no psychoacoustic weighting; documented).

## Optimizer

Hybrid greedy + coordinate descent (see `docs/autoeq-research.md` for the
upstream comparison that selected it):

1. **Justified shelves**: low shelf when 20–200 Hz vs 500–2 kHz means differ
   > 3 dB (split point by max contrast); high shelf analogously above 5 kHz.
2. **Greedy peaks**: argmax-|residual| in 20 Hz–10 kHz, width from
   half-height span → `q = sqrt(2^bw)/(2^bw−1)`, gain = peak height;
   subtract and repeat until `maxBands` or residual < 0.5 dB.
3. **Refinement**: bounded coordinate descent (log-fc, Q, gain) with
   golden-section line search, ≤6 sweeps, stops below 1e-4 dB improvement,
   15 s budget, or cancellation. Opt-in `localFcSearch` replaces the global
   fc line search with a bounded log-frequency window (default ±0.25 oct,
   3 discrete candidates scored with the same total-RMSE objective, then a
   one-step refine) — frequency only; gain/Q keep their global steps.
4. **Prune**: |gain| < 0.3 dB or near-duplicates dropped; RMSE recomputed.
   Opt-in `oppositionPrune` additionally drops the weaker of two
   strongly-overlapping opposing peaking bands only while total RMSE stays
   within both the absolute `pruneToleranceDb` (0.05) and the relative
   validation policy (≤ baseline·1.05 + 0.03 dB).
5. **Preamp**: negated max boost (existing compensation helper).

Constraints: fc 20 Hz–10 kHz, gain ±12 dB (configurable ±6), Q 0.5–6,
band cap, finite-only, stability re-verified per emitted band.

## Convergence / local minima

Sweep-improvement tolerance, sweep cap, time budget, cooperative cancel.
Greedy residual init lands near the global structure, so single-start
refinement suffices — no expensive restarts (benchmarked).

## Pruning, preamp, metrics

Reported: RMS before→after, max abs, p95, bands, boost/cut, preamp,
grid/range/sweeps/version/timing. Preamp guarantees
max-boost + preamp ≤ 0 (limiter remains backstop; no true-peak claims).

## Limitations

Fits smooth musical deviations well; pathological combs need more bands
than offered; >10 kHz treated as mean energy by design; shelved/peak
recovery judged on response error, not parameter identity (equivalent
solutions exist).

## Versioning

Results stamp `optimizerVersion`; profiles store it with fit time and RMS.
Future algorithm changes bump the constant — outputs are never claimed
identical across versions. v2 adds explicit HF treatment, the local-fc
window, and opposition pruning; all three are opt-in or
behavior-preserving, so v2 defaults reproduce v1 bit-identically
(proven by test against the committed Phase 7 baseline). Phase 8D adds
optional measurement smoothing as *preprocessing* (optimizer untouched,
version stays 2): Off is bit-identical to 8C, preset recorded in
`eqMeta.smoothingPreset` and the validation report.

## Validation (Phase 7.5)

Real-world fitness is evidenced, not assumed: a 22-case legal synthetic
corpus (seeded analytic generator, zero third-party data), extended
metrics, variation studies, failure classification, and ranked Phase 8
candidates. Entry points: `docs/autoeq-validation.md` (findings),
`docs/autoeq-validation-corpus.md` (corpus + report/figure reference),
`tests/autoeq/` (`results.json` + `figures/*.svg`). Validation never
tunes the optimizer — and no numerical RMS result is presented as
perceptual truth.
