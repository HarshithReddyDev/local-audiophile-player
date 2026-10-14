# Device profiles & layers

One device sounds one way at a time: applying a device replaces the
previous device's DSP — profiles never stack.

## Layers

```
GLOBAL DEFAULT (everything live right now)
  → DEVICE PROFILE (a named IEMProfile.dsp snapshot, when applied)
```

There is no per-playlist/per-track override layer (deliberate restraint:
global + device covers the demonstrated UX cases without a precedence
maze). The active layer is always displayed: EQ and DSP views show
"Device layer: {name}" or "Layer: global default", with a one-click
"Back to global / Use global".

## What a device layer holds

`DeviceDspSnapshot` (`src/dsp/snapshot.ts`, versioned): EQ mode +
PEQ bands + graphic banks, bass/treble/tuner, limiter state, full
compressor params, spatial params, reverb params, loudness params,
ReplayGain mode. Applying a snapshot **replaces** all module state
(PEQ travels through the EQ store so persistence stays single-sourced).
Snapshots validate structurally on import; anything malformed is
rejected with reasons, never partially applied.

## Workflows

- **Catalog → device**: Devices → device → "Use device" finds the
  profile for that make/model or creates one, then applies its layer
  (or legacy EQ when no snapshot exists yet).
- **Capture**: IEM → Profiles → "Save current DSP" stores the live
  state into the profile (optimizer, measurement, and target untouched).
- **Apply / deselect**: profile cards Apply/Deselect; selecting a
  profile without a layer falls back to the legacy `eq` field behavior.
- **Clear**: per-profile "Clear DSP layer" (legacy EQ kept) or global
  "Back to global" in EQ/DSP views.
- **AutoEQ**: fitting writes the profile's legacy `eq` + provenance as
  before (optimizer untouched); "Save current DSP" then promotes any
  result — plus surrounding modules — into the device layer.
- **Backup**: device profiles (with layers) export/import as validated
  JSON from Settings → Backup & restore. Existing ids are skipped, never
  overwritten.

## Browser limits (stated in UI, not worked around)

Output-device information is not universally exposed: selection uses
`setSinkId` where supported (Chromium) with an explicit fallback
message elsewhere, and device labels need a prior media permission.
There is no automatic headphone-connection detection — device choice is
manual ("Change device" via profiles/catalog). Nothing here claims
otherwise.
