# AutoEQ validation corpus

Location: `tests/autoeq/` — `results.json` (machine-readable report, 22
cases) + `figures/*.svg` (deterministic before/after graphs). Generator:
`src/dsp/synth.ts` (seeded analytic curves from our own biquad math);
definitions: `src/dsp/corpus.ts` (v1); metrics/figures:
`src/dsp/validation.ts` (measurement only, never tunes the optimizer).

## Provenance rule

Every curve is generated in-repo from a seed. No third-party measurement or
target data is bundled, sampled, or transcribed — not even "a few points for
testing" (see `docs/measurement-data-licenses.md`: code MIT ≠ data
licensed). Real-world shapes are represented by analytic analogues (e.g. a
+7 dB Q4 peak at 3 kHz stands in for ear-canal resonance behavior).

## Case list (22)

01 flat · 02 bass-deficient · 03 bass-boosted · 04 broad bass shelf ·
05 mid dip · 06 mid elevation · 07 narrow 3 kHz peak · 08 narrow 2.5 kHz dip ·
09 6.5 kHz peak · 10 treble irregularity · 11 multi treble · 12 downward
slope · 13 highly uneven · 14 multi broad · 15 multi narrow · 16 combined
bass+mid+treble · 17 sparse · 18 noisy (±1.5 dB, seed 7) · 19 truncated 12 kHz ·
20 truncated 50 Hz · 21 extreme-but-plausible · 22 tilt-target variant.

Targets: flat except 22 (parametric tilt). Appropriateness notes live on
each case (`appropriateness` field) — not every shape deserves aggressive
correction (deep narrow dips, HF wiggles, noise).

## Report fields

Each `results.json` entry carries the §7/§8/§9 metrics: initial/final RMS,
RMS improvement, initial/final max-abs, p95, band count, average |gain|,
max boost/cut, preamp, min/max Q, minimum effective bandwidth
(`minBandwidthOct`), frequency span, minimum adjacent-band distance
(`minAdjacentOct`, 0 when fewer than 2 bands), overlapping-pair count,
total correction excursion, fitting range, residual peak count + largest
residual peak, flags, deterministic complexity class, the engineering
quality score (heuristic, not perceptual truth), per-band summary, and the
case's fitting `options` override ({} at defaults).

## Figure legend

Every `figures/<case>.svg` uses the app's log-axis/0 dB conventions
(preamp excluded, same as the metrics): light solid = measurement, light
dashed = target, blue = predicted corrected response, amber solid =
combined correction curve, red dashed = residual (predicted − target),
thin gray = individual PEQ bands. Series key is also embedded in the
SVG `<desc>` element.

## Regenerating

Run the validation suite; `results.json` + figures rewrite byte-identically
(runtimes excluded). Review diffs before committing — any change means the
optimizer or corpus moved.
