# Measurements

Local frequency-response data for IEMs/headphones. Files never leave the
device; only parsed numbers persist in IndexedDB.

## Model

`Measurement {id, name, source, channel, frequencies[], gains[], metadata,
createdAt}` — Hz + dB, sorted ascending, finite only. Raw imports are
preserved as-parsed (no smoothing, ever); every later operation derives.

## Supported layouts

`MeasurementParser` (`src/dsp/curve-io.ts`): `File → detect → parse →
validate → normalize`. Handles AutoEQ `frequency,raw` headers, squiglink/
REW-style headers, comma/tab/semicolon/whitespace delimiters, `# * " // ; !`
comments, sparse/unsorted/duplicate rows (duplicates averaged), and
`frequency,left,right` stereo exports (yielding two measurements). Malformed
input throws `CurveParseError` with line numbers; single bad rows warn.

## Normalization (no smoothing)

Sort, average exact duplicates, drop non-finite/non-positive rows, reject
under 3 usable points or absurd bounds. Narrow resonances and sparse data
are legitimate and kept.

## Interpolation

`interpolateLog`: linear on log-frequency (auditory scaling, no spline
overshoot), binary-searched, clamped outside range. Tested exact on knots.

## Channels

`left | right | average | unknown`, detected from headers. Channel-aware
storage exists; per-channel AutoEQ is Phase 7 scope.

## Import UX

File → parse → preview (stats, range, graph, warnings) → name/source →
save. Invalid files show the reason before anything persists.
