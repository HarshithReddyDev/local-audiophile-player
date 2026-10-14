---
description: Independent numerical verification of DSP/EQ math
agent: dsp-verifier
subtask: true
---

Independently verify the DSP in scope: $ARGUMENTS

Recompute coefficients and expected magnitude/phase from first principles, check stability (pole radius < 1), Q/BW conversions, sample-rate handling, and edge cases. Report PASS/FAIL with values, tolerances, and failing frequencies. Do not modify code.
