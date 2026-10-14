# AutoEQ research (Phase 7)

Sources (fetched 2026-09-12): `autoeq/peq.py`, `autoeq/constants.py`,
`autoeq/README.md` at jaakkopasanen/AutoEq master; W3C audio-eq-cookbook;
Web Audio spec §1.13.5. Code is MIT — ideas studied, nothing copied.

## FACT — upstream pipeline

`read_csv → interpolate (standard log grid) → center → compensate →
smoothen → equalize → optimize_parametric_eq(config, fs)`.

## FACT — upstream optimizer

- `scipy.optimize.fmin_slsqp` (SLSQP), fc optimized in **log10 space**,
  per-parameter bounds. Author comment: "Tested all of the scipy minimize
  methods, this is the best."
- **Greedy residual init**: filters initialized one at a time, biggest peak
  first — `find_peaks` on clipped target, ranked by width × height;
  fc at peak, Q from peak width via `q = sqrt(2^bw)/(2^bw−1)`,
  gain = peak height (clipped); then `remaining_target -= filt.fr`.
  Shelves: fc at max before/after average ratio, gain = weighted average,
  Q fixed 0.7.
- **Loss**: RMSE over [min_f, max_f] + per-filter sharpness penalties; above
  **10 kHz both target and prediction are replaced by their means**
  (average-energy treatment of unreliable treble).
- **Stopping**: max_time, target_loss, min change rate, min loss-std
  (defaults: min_std 0.002–0.01 depending on config).
- **Bounds** (peaking): fc 20–10 kHz, Q 0.18–6, gain ±20 dB. Shelves:
  fc 20–10 kHz, Q 0.4–0.7, gain ±20. Optimizer band 20 Hz–20 kHz.
- Typical configs: 8–10 peaking + fixed low shelf (105 Hz) + high shelf
  (10 kHz); preamp = −(max boost + 0.2 headroom) (`PREAMP_HEADROOM`).

## INFERENCE — why this shape works

SLSQP needs a good start on this non-convex objective; the greedy peak pass
supplies it, so the local optimizer only refines. Log-fc keeps octaves
comparable; the 10 kHz averaging stops treble overfitting; penalties +
bounds keep filters musical.

## DECISION — our optimizer (benchmarked §below)

**Hybrid greedy + coordinate-descent refinement**, zero dependencies:

- Same greedy residual peak init (ported logic, own code): argmax-|r|
  peaks, width from half-height span, upstream Q formula, shelf
  justification by band-average deltas (>3 dB gate, else no shelf).
- Refinement: bounded coordinate descent (log-fc, Q, gain per band) with
  golden-section line search — derivative-free, bounds-trivial,
  deterministic, cancellable between sweeps. Rejected SLSQP port (QP
  machinery, convergence subtleties, no dependency budget); rejected pure
  random multi-start (cost without need — greedy init is already excellent).
- Objective: RMSE on a 160-point log grid + the 10 kHz mean treatment;
  uniform weighting (log spacing = per-octave equal weight, documented).
  No psychoacoustic weighting (unneeded complexity), no sharpness penalty
  (Q bounds 0.5–6 do the work; hooks noted for Phase 8).
- Prune: |gain| < 0.3 dB or near-duplicates removed, RMSE recomputed.
- Preamp: existing `suggestedPreampCompensation` (negated max boost).
- Runs in a Web Worker with generation-ID cancellation; deterministic —
  zero randomness anywhere (stronger than seeded RNG).
- Versioned: `OPTIMIZER_VERSION = 1` stamped on results.

## Benchmarks (Node, desktop; mobile emu in e2e)

- 8-band fit on 160-pt grid: ~50–150 ms (see `autoeq.perf.test.ts` output).
- Grid scaling 64/128/256 and bands 4/8/12 measured in-test with generous
  ceilings. Worst case stays far below the 15 s time budget.
