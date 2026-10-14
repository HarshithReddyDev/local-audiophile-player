# Presets: categories, formats, portability

## Categories

Every preset carries its origin — never relabeled, never merged:

- **Factory/Source**: tutorial preset authored in-repo.
- **Device**: catalog presets (6,229 devices / 11,289 OPRA presets —
  see `docs/device-catalog.md`); imports always copy, canonicals never
  mutate.
- **AutoEQ**: fitted corrections with optimizer provenance.
- **Manual**: saved from the editors (parametric or graphic).
- **Community**: imported files (origin recorded as user-supplied).
- **Imported**: parsed from exchange formats below.
- **Favorites**: a flag on any of the above, not a separate copy.

## Operations

Create, edit, duplicate, rename, delete (user presets only), favorite,
export, import, reset — in EQ (parametric), EQ graphic banks, and DSP
behavioral starting points. Duplicates are independent copies.
Validation failures explain themselves and change nothing.

## Exchange formats

| Format | Direction | Fidelity |
|---|---|---|
| Native `.preset.json` (versioned, validated) | both | Lossless |
| GraphicEQ text (`GraphicEQ: f g; …`) | both | Q assumed 1.0 on import (warned); export writes enabled bands |
| Parametric text (`Preamp:` + `Filter N:` lines; Equalizer APO subset, also accepted by Poweramp import) | both | Full for our 7 filter types; unknown lines skipped with warnings |
| Curve CSV (`frequency,gain`) | both | Q assumed 1.0 (warned) |

Loss is never silent: every assumption or skipped line lands in
warnings shown before/with the import, and text exports note that
bypassed bands are excluded. No proprietary binary format is read or
written (no reverse engineering, ever).

## Compatibility notes (honest)

- **Wavelet/AutoEq GraphicEQ**: parses and emits the documented
  `GraphicEQ:` grammar. Compatibility is with the *documented format*;
  exact in-app rendering parity with any third-party app is not
  claimed (their Q conventions are their own).
- **Poweramp text import**: emits the parametric grammar Poweramp's
  importer accepts per community documentation. No affiliation, no
  endorsement, no binary formats.
- **Equalizer APO**: subset grammar (Preamp + ON/OFF PK/LS/HS/LP/HP/
  NO/BP with Fc/Gain/Q). Anything outside the subset warns and skips.

## Backup

Settings → Backup & restore: device profiles (with DSP layers), EQ
backup (profile + parametric presets + graphic banks + presets), safe
app settings. Plain local JSON. Imports validate and skip existing ids
instead of overwriting; reports say exactly what happened.
