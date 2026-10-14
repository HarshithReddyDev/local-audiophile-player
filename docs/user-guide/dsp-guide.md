# DSP Guide

Actual signal path: Source → ReplayGain + preamp → EQ → tone → dynamics
→ spatial → reverb (parallel) → peak safety limiter → output.

| Module | Use | Avoid |
|---|---|---|
| Preamp | Headroom for boosts | As a volume knob |
| Bass/Treble | Broad ±1–3 dB tilts | Stacking identical boosts |
| Bass Tuner | Controlled low shaping | As device correction |
| Compressor | Gentle leveling, speech | High ratio + fast attack on music |
| Peak safety limiter | Backstop (sample-peak, **not** true-peak) | Relying on it instead of preamp |
| Balance/Mono/Swap/Solo | Imbalance, accessibility, testing | Leaving on for normal listening |
| Width | Subtle widening | Extremes (mono cancellation) |
| Crossfeed | Soften hard-panned headphones | Expecting room simulation |
| Reverb | Tiny ambience (default OFF) | Large mixes for critical listening |
| Loudness | Quiet-level tilt (relative, not SPL-calibrated) | Treating as certified calibration |

Quick tips: start flat, small changes, keep headroom, A/B matched,
don't chase measurement wiggles.
