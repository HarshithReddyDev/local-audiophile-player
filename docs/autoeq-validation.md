# AutoEQ validation (Phase 7.5)

Validation only: nothing here tunes the optimizer. Workflow was baseline →
corpus → metrics → inspection → classification → recommendations. No
optimizer code changed for these findings (one harness bug fixed: evaluation
must exclude preamp, which the fit treats separately).

## Corpus

22 cases in `tests/autoeq/` (`results.json` + `figures/*.svg`, all
deterministic): 21 required shapes (§4.1–21) + a tilt-target variant. ALL
user-created synthetic (seeded analytic generator, `src/dsp/synth.ts`) —
zero third-party data, zero license risk (see `docs/autoeq-validation-
corpus.md`, President's rule: code MIT ≠ data licensed). Targets: flat or
parametric-built.

## Methodology

Each case: fit with defaults (8 bands, ±12 dB, Q 0.5–6, 160-pt grid) →
extended metrics + flags + deterministic trio-graph → committed
`results.json` (runtimes excluded for byte-stability; perf asserted in-test).
Report entries additionally carry min Q, minimum adjacent-band distance,
and the case's fitting-options override; figures show the combined
correction curve and residual alongside measurement/target/predicted and
individual bands (legend in `docs/autoeq-validation-corpus.md`).
Regression compares within tolerance (RMS ≤5%+0.03 dB, bands ≤+1, flags
equal). Determinism: every case fit twice, byte-identical.

## Headline numbers

- Avg RMS improvement 1.73 dB, median 1.28 dB; avg 3.36 bands.
- Best: flat→empty, broad shelves→≤0.04 dB residual.
- Worst: extreme-plausible (1.93), truncated-LF edge (1.04), highly-uneven
  (0.89) — all understood below.
- Zero gain-bound hits at defaults → constraints adequate, not limiting.
- Runtimes: corpus fits ~10–60 ms Node; full validation <2 s.

## Observed failure modes → classification → recommendation

1. **Refinement abandons narrow regions for RMSE mass** (cases 13, 15:
   +3.7 dB residuals at 5.9/7 kHz while RMS "improved"). Placement alone
   nails them (rms 0.11); global fc line-search migrates bands across
   regions. Class: **B** (objective). Fix candidates: local-only fc window,
   maxAbs/p95 objective term. Risk of fix: medium (re-tune convergence).
2. **Opposing/overlapping clusters** (07: +1.1 next to −6.7; 18: ± pair at
   985 Hz). Sidelobe cleanup or noise-chasing. Class: **E** (count/pruning).
   Candidate: opposition merge + tighter prune. Risk: low.
3. **Q pinned at ceiling** (9 cases ≥4, 5 at 5.98; wider bounds don't help
   RMS but emit Q≈10 on noise). Class: **D**. Recommendation: KEEP maxQ 6;
   consider sharpness penalty (D) only with evidence.
4. **Tilt approximated by band stacks** (12, 22: 5–8 bands). No tilt filter
   type exists. Class: **E/I**. Candidate: tilt primitive or accept stacks.
   Risk of adding a type: low-moderate (response math + node mapping).
5. **HF averaging leaves treble spikes** (10: −3.5 @12 kHz). By design
   (§22). Class: **G**. No change; optionally expose the 10 kHz knee.
6. **Truncation edges** (20: 4.1 max spike at the 50 Hz edge). Class: **J**.
   Candidate: edge guard in peak picker. Risk: low.
7. **Noise chasing** (18: 7 bands incl. LF narrow-hot). Class: **F**.
   Candidate: optional smoothing input (upstream does this). Risk: low,
   but changes results → version bump.
8. **Non-monotonic band scaling** (16: 8 bands marginally worse than 4).
   Class: **B**. Inherent to greedy+local; tolerance documented.

## High-frequency findings (§11, §22)

20–8 kHz fits avoid treble narrowness entirely (16: maxQ 1.21, rms 0.66 vs
0.78 full-range). The 10 kHz mean treatment works as designed; exposing the
knee + range presets (Full / to 10 k / to 8 k) is the highest-value,
lowest-risk Phase 8 item.

## Low-frequency findings (§12)

Shelves recover cleanly (02/04 residuals ≤0.04); no impossible LF boosts
observed (gain bounds + shelf justification gate hold); shelf+peak
interaction sane (21 excepted by edge artifacts).

## Overfitting (§13, §18-noisy)

Mild: 7 bands on ±1.5 dB noise, one opposing pair. Bounded by Q/gain caps;
smoothing input is the principled fix, not tighter caps (which would hurt
legitimate narrow cases like 07).

## Performance (§24–25)

Node: full 22-case validation ~1.4 s; e2e fits complete in-browser in
seconds on desktop and mobile emu. Heap growth over 20 fit/cancel cycles:
−1.8 MB (bounded). Browser overhead immaterial vs Node timings.

## Limitations (honest)

Synthetic corpus only (no legal real corpus exists to bundle); Math.*
cross-engine float tolerance in committed comparisons; figures use the
evaluation profile without preamp (documented); quality score is an
engineering heuristic, never perceptual truth.

## Phase 8 ranking (impact × risk)

1. **Fit-range presets + HF knee control** (high impact, low risk).
2. **Local fc search window** (high impact on narrow cases, medium risk).
3. **Opposition/overlap merge in pruning** (medium, low).
4. **Optional smoothing input** (medium, low + version bump).
5. **Tilt filter type** (medium, low-moderate).
6. **Residual-weighted objective term** (medium, medium).
7. Sharpness penalty, denser grids, multi-start — NOT recommended now
   (cost without demonstrated need).
