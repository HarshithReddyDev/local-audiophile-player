# DSP research (Phase 5)

Primary sources (fetched 2026-09-12, not trusted from memory):

1. **RBJ Audio EQ Cookbook** — W3C Working Group Note
   `https://www.w3.org/TR/audio-eq-cookbook/` (adapted from
   Robert Bristow-Johnson with permission). Authoritative equations below.
2. **BiquadFilterNode** — MDN, Baseline widely available (all browsers since
   July 2015). `frequency`/`Q`/`gain` are **a-rate AudioParams** (sample-
   accurate, zipper-free updates); `getFrequencyResponse()` computes node
   response from current params.

## Transfer function and normalization

```
H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (a0 + a1·z⁻¹ + a2·z⁻²)
```

The cookbook gives 6 raw coefficients; architectures normalize a0 → 1:

```
y[n] = (b0/a0)·x[n] + (b1/a0)·x[n-1] + (b2/a0)·x[n-2]
     − (a1/a0)·y[n-1] − (a2/a0)·y[n-2]            (Direct Form 1)
```

Our `BiquadCoefficients` stores the five normalized values
(b0, b1, b2, a1, a2) with a0 = 1 implied.

## Shared intermediates

```
A     = 10^(dBgain/40)            (peaking + shelving only)
ω0    = 2π·f0/Fs
α     = sin(ω0) / (2·Q)           (Q case)
```

## Peaking EQ

```
b0 = 1 + α·A      b1 = −2·cosω0   b2 = 1 − α·A
a0 = 1 + α/A      a1 = −2·cosω0   a2 = 1 − α/A
```

Cookbook note: the peaking Q uses A·Q internally so that +N dB followed by
−N dB (same Q, f0) sums to a precisely flat wire. Our cascade tests assert
this symmetry.

## Shelving (S = 1, matching BiquadFilterNode)

MDN: Q is **not used** for lowshelf/highshelf — the node fixes the slope.
The cookbook S-case with S = 1 reduces to α = sinω0/2·√2; we implement the
equivalent closed form used by every major implementation:

```
// shared
A, ω0 as above; α = sinω0/2·√2; 2√A·α term as written
lowShelf:
  b0 =    A·((A+1) − (A−1)·cosω0 + 2√A·α)
  b1 =  2·A·((A−1) − (A+1)·cosω0)
  b2 =    A·((A+1) − (A−1)·cosω0 − 2√A·α)
  a0 =        (A+1) + (A−1)·cosω0 + 2√A·α
  a1 = −2·(   (A−1) + (A+1)·cosω0 )
  a2 =        (A+1) + (A−1)·cosω0 − 2√A·α
highShelf: mirror with +cosω0 sign flips per cookbook
```

Because our math uses the identical S = 1 convention as the node, the pure
response engine predicts node behavior exactly — verified in-browser via
`getFrequencyResponse()` (§response verification).

## LPF / HPF / notch / bandpass

Cookbook forms — **except lowpass/highpass**, where the Web Audio spec
(§1.13.5, fetched 2026-09-12) mandates a DIVERGENT convention our e2e suite
caught red-handed:

```
spec lowpass/highpass:  α_QdB = sinω0 / (2·10^(Q/20))   ← NOT sinω0/2Q
```

Measured proof (Chromium getFrequencyResponse, HPF 1 kHz Q 0.7071 @48 kHz):
node reads **+0.71 dB** at cutoff where textbook RBJ predicts −3.01 dB.
Our core implements α_QdB for LPF/HPF so the response engine predicts node
behavior exactly; notch/bandpass/peaking/shelves follow plain RBJ α_Q/α_S
(verified matching). Lesson: the cookbook is the starting point, the
platform spec is the contract — hence the node-equivalence e2e suite.

```
LPF: b0=(1−cosω0)/2  b1=1−cosω0  b2=(1−cosω0)/2
HPF: b0=(1+cosω0)/2  b1=−(1+cosω0) b2=(1+cosω0)/2
notch: b0=1  b1=−2cosω0  b2=1
bandpass (constant 0 dB peak, the EQ-musical variant):
     b0=α  b1=0  b2=−α
LPF/HPF/notch/bandpass denominators: a0=1+α  a1=−2cosω0  a2=1−α
  (α = α_QdB for LPF/HPF, α_Q otherwise)
```

We implement bandpass as constant-0 dB-peak (gain param ignored, like the
node) — documented, not the constant-skirt variant.

## Frequency response (theory)

```
H(e^{jω}) = (b0 + b1·e^{−jω} + b2·e^{−j2ω}) / (1 + a1·e^{−jω} + a2·e^{−j2ω})
|H|dB = 20·log10(|num| / |den|),   ω = 2π·f/Fs
```

Cascaded magnitudes multiply ⇒ dB adds. Our `peqMagnitudeDb` sums per-band
responses; cascade tests assert theory-vs-theory and theory-vs-node.

## Stability

Poles inside the unit circle ⟺ (normalized): |a2| < 1 and |a1| < 1 + a2
(triangle stability test). Every coefficient set is checked at creation;
`isStable()` is exported and asserted. Guards: f0 ∈ (0, Nyquist), Q finite
in [0.025, 40], gain finite in [−60, +60] dB, Fs ∈ [8 kHz, 768 kHz],
non-finite inputs rejected before any division.

## BiquadFilterNode parameter mapping (our convention)

| type | frequency | Q | gain |
|---|---|---|---|
| peaking | f0 | Q | dB |
| lowshelf/highshelf | midpoint | ignored (fixed slope) | dB |
| lowpass/highpass | cutoff | resonance Q | ignored |
| notch | center | Q | ignored |
| bandpass | center | Q | ignored |

Matches MDN semantics exactly, so UI params map 1:1 to node params.

## Native vs AudioWorklet decision (recorded here, summarized in dsp.md)

Native `BiquadFilterNode` chain (Option A) wins on: correctness (same
cookbook both sides), CPU (audio-thread C++), latency (none added),
updates (a-rate, zipper-free), compat (Baseline 2015), testability (pure
math + `getFrequencyResponse` cross-check), AutoEQ future (response engine
already pure; node params trivially settable), mobile (cheapest path),
complexity (no worklet module, no base-path asset, no GC/message bridge).
A custom Worklet would be justified only by non-biquad processing
(FIR/convolution) or sample readback — neither is a Phase 5 requirement.
**Decision: Option A. No Worklet.**
