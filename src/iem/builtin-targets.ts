/**
 * Built-in targets: curves this project owns outright — no third-party data.
 * Third-party targets (Harman, JM-1, diffuse-field, …) are deliberately NOT
 * bundled; see docs/measurement-data-licenses.md. Users import them as CSV.
 */
import type { TargetCurve } from "./types";

export const FLAT_TARGET_ID = "builtin-flat";

export function flatTarget(): TargetCurve {
	return {
		id: FLAT_TARGET_ID,
		name: "Flat (0 dB)",
		kind: "builtin-flat",
		frequencies: [20, 20000],
		gains: [0, 0],
		metadata: {
			source: "built-in",
			attribution: "No data: constant zero correction reference.",
			pointCount: 2,
		},
		createdAt: 0,
		updatedAt: 0,
	};
}

/** Built-ins merged ahead of user targets wherever targets are listed. */
export function builtinTargets(): TargetCurve[] {
	return [flatTarget()];
}
