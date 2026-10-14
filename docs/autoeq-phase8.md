# AutoEQ Phase 8 experiment report (8A–8C)

Scope: fit-range presets + HF knee control (8A), local center-frequency
refinement (8B), opposition/overlap pruning (8C). Explicitly deferred:
smoothing, tilt filter type, residual-weighted objective, dense grids,
multi-start, sharpness penalties (§31).

Headline: all three shipped as **opt-in / behavior-preserving** changes
under `OPTIMIZER_VERSION = 2`. v2 defaults reproduce v1 bit-identically
(proven by test against `tests/autoeq/phase7-baseline.json`), so every
Phase 7.5 validation guarantee is preserved. New behavior is strictly
additive: no playback/DSP/engine code was touched.

## 8A — Fit-range presets + HF knee

Hypothesis (Phase 7.5 §11/§22): 20–8 kHz refits avoided treble narrowness
entirely; exposing the range and the 10 kHz knee is the highest-value,
lowest-risk item.

Method: `FIT_RANGE_PRESETS` (Full / 20 Hz–10 kHz / 20 Hz–8 kHz / Custom),
`resolvePresetRange`, `HfTreatment = average | fit | exclude` with
`hfKneeHz` (default 10 kHz). Effective range = requested ∩ measured data
(plus knee cap for `exclude`); never extrapolated. The deprecated v1
`hfFlattenFreq` alias keeps its meaning (`0` → `fit`, else knee).

Range-preset study (fit-grid RMS / bands; grids differ per preset, so read
band behavior, not just RMS):

| case | full | 10 kHz | 8 kHz |
|---|---|---|---|
| 02 bass-deficient | 0.033 / 3 | 0.028 / 3 | 0.027 / 3 |
| 07 narrow 3 kHz | 0.019 / 3 | 0.094 / 2 | 0.051 / 1 |
| 10 treble irregular | 0.141 / 2 | 0.014 / 4 | 0.042 / 1 |
| 13 highly uneven | 0.846 / 5 | 0.212 / 7 | 0.852 / 6 |
| 16 combined | 0.776 / 5 | 0.742 / 6 | 0.658 / 4 |
| 19 truncated 12 kHz | 0.026 / 1 | 0.027 / 1 | 0.027 / 1 |

Presets change the objective surface (different grids shift greedy
peak-picking even in-band, e.g. 07), so they are user control, not an
automatic upgrade: 8 kHz avoids treble narrowness (10: maxQ no longer
pinned, 1 band), 10 kHz can spend MORE bands in-band (10: 4, 13: 7).
Truncated data clamps identically under every preset (19: same 1-band
result; effective range stops at 11.88 kHz).

HF-treatment study (eval grid 20 Hz–20 kHz, apples-to-apples):

| case | average | fit | exclude |
|---|---|---|---|
| 10 treble irregular | 0.527 / 2 bands | 0.523 / 3 | 0.525 / 4 |
| 11 multi treble | 0.398 / 3 | **0.303** / 3 | 0.807 / 5 |
| 16 combined | 0.274 / 6 | 0.328 / 6 | 1.486 / 6 |
| 07 narrow 3 kHz | 0.019 / 3 | 0.019 / 3 | 0.094 / 2 |
| 02 bass-deficient | 0.041 / 3 | 0.041 / 3 | 0.030 / 3 |

Reading: with no HF content, `average` ≡ `fit` exactly (averaging is a
no-op on flat treble — the guard costs nothing). On the treble-spike case
(10) all three tie on response while `average` uses the fewest bands, so
the default is justified. When treble features are real (11, synthetic by
construction), `fit` wins — the control is meaningful for trusted rigs.
`exclude` eval numbers include the ignored >10 kHz energy by design;
its fit-grid RMS is computed on a different (shorter) grid and is NOT
comparable across treatments.

Performance: preset/HF changes cost nothing measurable (same grid size
class; study fits run in 1–30 ms).

Regressions: none at defaults (bit-identical). Non-default presets can
move in-band results (07: 0.019 → 0.051/0.094 fit-grid) — user-visible
choice with reported effective range, not a regression.

Decision: ship 8A as the default-visible UI (preset radios + HF select +
effective-range readout). Defaults: Full + average@10 kHz = v1 behavior.

## 8B — Local center-frequency refinement

Hypothesis (Phase 7.5 failure mode #1): global fc line search migrates
bands across regions, abandoning narrow features (cases 13, 15). A bounded
local window should hold bands near their greedy placement.

Method: `localFcSearch` (default OFF), `localFcWindowOct` (default 0.5),
`localFcCandidates` (default 5 → **3**, see below). Per peaking band per
sweep: N log-spaced candidates across ±window/2 around current fc, each
scored with the EXISTING total-RMSE objective (never local peak height),
then golden-section refine within one discrete step of the winner.
Frequency only — gain/Q keep their coordinate steps (§10). Deterministic
(fixed order, earliest wins ties), bounded by fitting range, cancellable.

Benchmark (§9, fit-grid totals over 22 cases):

| config | avg RMS | worst RMS | bands | maxQ | total ms |
|---|---|---|---|---|---|
| off | 0.298 | 1.855 | 74 | 5.98 | 407 |
| 3 cand / 0.5 oct | 0.146 | 0.937 | 93 | 5.98 | 817 |
| 5 cand / 0.5 oct | 0.147 | 0.950 | 93 | 5.98 | 872 |
| 7 cand / 0.5 oct | 0.147 | 0.956 | 93 | 5.98 | 910 |
| 5 cand / 0.25 oct | 0.149 | 0.982 | 92 | 5.98 | 869 |
| 5 cand / 1.0 oct | 0.144 | 0.886 | 93 | 5.98 | 866 |

3 ≈ 5 ≈ 7 candidates and 0.25 ≈ 0.5 ≈ 1.0 oct windows on both grids, so
per §9 the cheapest wins: **3 candidates** (adjacent ratio ≈ 1.19×,
refine ±1 step) with the middle **0.5-oct window** (bounded migration
risk; the 1.0-oct variant buys +0.002 fit-RMS with wider travel).
`DEFAULT_FITTING_OPTIONS.localFcCandidates` is therefore 3. Cost ≈ 2× fit
time (≈18 → ≈37 ms/case Node) for roughly halved fit-grid RMS.

Eval-grid A/B (legacy → local-only highlights): 13: 0.895 → 0.271,
15: 0.502 → 0.024, 03: 0.429 → 0.086, 17: 0.290 → 0.070,
21: 1.927 → 1.245, 14: 0.180 → 0.066, 06: 0.027 → 0.001.
The Phase 7.5 "abandoned narrow regions" mode is fixed where it mattered.
Price: +15 bands corpus-wide (refinement keeps more bands above the
0.3 dB prune floor) and small noise-basin variance on 18 (0.642 → 0.690,
within policy).

Regressions: none beyond policy in isolation. Decision: ship opt-in
(default OFF per §25 — the wins are large but band growth + noise
variance mean it is not a clearly-superior default). UI exposes nothing
(§24: no user benefit in a "coordinate descent" toggle); API consumers
opt in via `FittingOptions`.

## 8C — Opposition / overlap pruning

Hypothesis (Phase 7.5 #2/#7): opposing/overlapping clusters (07's
+1.1/−6.7 pair, 18's ± pair at 985 Hz) are sidelobe cleanup or
noise-chasing; removing provably-harmless ones cuts complexity.

Method: `findOppositionPair` — deterministic first pair in band order;
peaking-only, |log2| center distance < 1/3 oct (same definition the
harness counts as overlap), gains oppose. Shelves excluded (broad,
deliberate); same-sign overlap stays with the near-duplicate pass.
Strategy **A — remove the weaker** (chosen): B (merge into one equivalent
filter) needs parameter-solving machinery without evidence; C (refit one
filter to replace the pair) turns pruning into a second optimizer.
After each removal total RMSE is recomputed; removal stands only within
BOTH the absolute `pruneToleranceDb` (0.05) AND the relative validation
policy (≤ baseline·1.05 + 0.03). The budget is total across the fixpoint
loop, not per-removal.

The relative term is a real fix found during this phase, not decoration:
with absolute-only tolerance, the 07 post-local solution (fit-RMS 0.012)
accepted removal of its 0.4 dB sidelobe helper (0.012 → 0.058, eval
0.017 → 0.068, maxAbs tripled) — a load-bearing band deleted because it
looked small. The relative term rejects it (budget 0.043); 07-all-on now
keeps all 3 bands at eval 0.0172, better than legacy. Absolute-only
budgets cannot distinguish "tripling an excellent fit" from "5% worse on
a noisy fit"; the min() of both can.

Isolation results (fit-grid): 07: 3→3 unchanged; 18: 7→6 (+0.034,
eval +0.035, within policy — less chasing, the desired direction);
16: 6→6 unchanged; 22: 8→7 (eval 0.096 → 0.128, within policy
0.131 — accepted band/flag trade, documented).

Regressions: the 18 combination (local + prune) stacks two tolerated
steps to +0.09 dB (0.642 → 0.732, policy limit 0.704). Investigated:
both solutions sit 0.38–0.43 dB from smooth truth (noise-chasing
dominates either way on ±1.5 dB noise with 22 residual peaks), bands
drop 7→6, and each feature in isolation is within policy. Genuine fix
needs the deferred smoothing input. Pinned by tripwire asserts, not
silence. Defaults unaffected (byte-identical v1).

Decision: ship opt-in (default OFF). Never merge blindly: response
contribution (total RMSE under dual budget) decides, never gain signs.

## Cross-cutting results (§35)

A. Changed: `src/dsp/autoeq.ts` (presets, HF model, local-fc, opposition
   prune, v2), `src/dsp/validation.ts` (effective range + HF treatment in
   reports), `AutoEQPanel.tsx` (preset radios, HF select, effective-range
   readout), `eqMeta`/`applyAutoEQResult` (additive Phase 8 provenance),
   tests + `results.json` (v2) + figures + docs. No playback/DSP/engine
   changes (§34).
B. Phase 7 vs 8 metrics: v2 defaults are bit-identical to v1 on all 22
   cases (test vs `phase7-baseline.json`, <1e-4 dB). All-on opt-in A/B
   (eval RMS legacy → all-on, bands): 01 0→0 (0→0), 02 .041→.030 (3→3),
   03 .429→.086 (2→4), 04 .002→.002, 05 .031→.029, 06 .027→.001,
   07 .019→.017 (3→3), 08 .023→.022, 09 .050→.027 (2→3),
   10 .527→.522, 11 .398→.381 (3→5), 12 .688→.619, 13 .895→.271 (5→8),
   14 .180→.066 (5→6), 15 .502→.024 (4→6), 16 .274→.141 (6→8),
   17 .290→.070 (4→6), 18 .642→.732 (7→6, documented),
   19 .028→.013, 20 1.043→1.067 (within policy), 21 1.927→1.245 (7→8),
   22 .096→.118 (within policy).
C. Fit-range impact: table above; control, not upgrade. Observable in
   `results.json` via effective `rangeHz` (e.g. 19: 20–11882 Hz,
   20: 51–19318 Hz) and in the preset study logs.
D. HF-knee impact: table above; default `average` justified (fewest bands
   at tied response on treble-spike case; no-op without HF content).
E. Local-fc impact: benchmark table + eval wins above; 3 candidates /
   0.5 oct chosen on measured equivalence (§9).
F. Pruning impact: fires rarely and only when provably harmless (18:
   7→6, 22: 8→7); the dual-budget rule fixed the 07 interaction.
G. Runtime: validation suite min 0 / median 6 / p95 81 / max 97 ms Node
   vs Phase 7 reference 7 / 89 / 108 — unchanged class. Local-fc ≈ 2×
   per-fit ms (tens of ms; budget is 15 s). No perf action needed.
H. Mobile: AutoEQ e2e (incl. new preset/HF test) passes on Pixel 7
   emulation; in-browser fits complete in ~1 s. No mobile-specific
   optimization warranted.
I. Regressions: 07 interaction (fixed by dual budget); 18 combination
   +0.09 (investigated, tripwired, deferred to smoothing); 20/22
   within policy; 16/11 gain flags alongside halved RMS (reported, not
   asserted — flags describe complexity honestly).
J. Protected cases: 01 empty ✓, 04 identical ✓, 07 improved ✓, 18
   documented ✓, 16/09/19/21 within policy ✓ — plus per-feature
   isolation asserts, all green.
K. Determinism: defaults and all-on byte-identical across reruns, all
   22 cases (elapsedMs scrubbed).
L. Cancellation: worker-client unit tests (cancel, wrong-id drop,
   late-message drop) unchanged and green; panel keeps generation-ID
   stale guard; new e2e covers generate → discard → regenerate
   sequencing (only newest generation touches UI state).
M. Backward compatibility: `FittingOptions` additions are optional with
   v1-equivalent defaults; `hfFlattenFreq` alias honored (tested);
   `eqMeta` additions optional — old profiles/records load; PEQProfile
   untouched; worker protocol unchanged (generic options bag).
N. Optimizer version: 2 (`OPTIMIZER_VERSION_NOTES[2]` documents the
   delta; v1 meaning preserved in the map).
O. New defaults: none. Full + average@10 kHz + local-off + prune-off =
   v1 behavior, proven by test.
P. Explicitly deferred (§31): smoothing, tilt filter, residual-weighted
   objective, dense grids, multi-start, sharpness penalties.
Q. Recommendation for Phase 8D: **optional smoothing input** (upstream
   does this; principled fix for the 18-class noise chasing; needs its
   own version bump + evidence). Tilt primitive only if band-stack
   evidence demands it. Do NOT auto-continue: 8A–8C is a complete,
   shippable increment — more control, better local fits, fewer
   redundant bands, zero default drift.

Validation: `tests/autoeq/results.json` (v2, 22 cases incl. effective
range + HF treatment) + `tests/autoeq/figures/*.svg` regenerated
deterministically. Suites: 180 unit tests (29 files, incl. 15 Phase 8
evidence tests), 75 e2e project-runs green on chromium + mobile (+ firefox
core subset).

## Phase 8D outcome (smoothing — DONE, default Off)

Implemented and shipped as classification **A (worth shipping, default
Off)**. Full evidence: `docs/autoeq-smoothing.md`. In brief: Light (1/12
oct) preserves the protected narrow peak in structure and collapses
noise-chasing on realistic-density measurements (6→1 / 7→5 bands, truth
RMS halved); Moderate (1/6) helps heavy noise further but is tripwired on
clean/complex curves (07/16). Off is bit-identical to 8C on all 22 cases
(tested). Optimizer untouched (version stays 2); smoothing is versioned
preprocessing recorded in `eqMeta` and the report.
