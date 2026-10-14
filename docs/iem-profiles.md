# IEM profiles

`IEMProfile {id, name, manufacturer, model, measurementId, targetId,
eq, createdAt, updatedAt}` — references by id, never embedded copies
(except `eq`, which Phase 7 will fill with a standard `PEQProfile`).

## Management

Create (name/make/model + measurement + target selects), rename,
duplicate, delete, select. Selection persists via the existing settings
store. Selecting a profile makes its sound live: a stored generated EQ
loads into the playback EQ, while a profile with no stored EQ bypasses it
— the UI never claims one profile while playing another's correction.
Deleting a measurement/target clears the profile reference (stored EQ is
kept as history); the profile page shows "choose" instead of a ghost id.

## Profile page

Make/model, measurement + target selectors, one graph with three series —
measurement, target, correction (`target − measurement`; positive means
boost there) — using the same log-axis/0 dB conventions as the EQ graph.

## Correction convention

`correction(f) = target(f) − measurement(f)` on a shared grid. Golden
tests: flat+flat → 0; +3 vs 0 → −3; −3 vs 0 → +3; identical → 0.

## Frequency domain

Canonical display/fitting grid is 20 Hz–20 kHz; each curve records its own
valid range. Fitting must clamp to measured data (enforced by the Phase 7
contract's `frequencyRange`). No smoothing in this phase; HF wiggles above
≈8–10 kHz are shown as measured, and the contract carries the limits Phase 7
needs to treat them carefully.

## Phase 7 contract

```ts
AutoEQInput  { measurement, target, frequencyRange, fittingOptions }
AutoEQOutput = SerializedPEQ   // the SAME type manual EQ uses
```

The engine will never learn whether a profile came from editing or fitting —
that architectural invariant is already in place (`docs/dsp.md`).
