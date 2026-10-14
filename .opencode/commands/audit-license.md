---
description: License audit for dependencies, data, and assets
agent: license-auditor
subtask: true
---

Audit licenses for: $ARGUMENTS

Return a table: package/data/asset, version, license, use, risk, action. Flag GPL/AGPL and unverified measurement redistribution. Default to permissive licenses only; escalate anything else for deliberate review. Do not modify code.
