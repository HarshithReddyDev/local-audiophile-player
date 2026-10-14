import { create } from "zustand";
import { validateCurve } from "../dsp/curves";
import { builtinTargets } from "../iem/builtin-targets";
import type { IEMProfile, Measurement, TargetCurve } from "../iem/types";

interface IEMState {
	measurements: Record<string, Measurement>;
	targets: Record<string, TargetCurve>;
	profiles: Record<string, IEMProfile>;

	hydrate: (data: {
		measurements: Measurement[];
		targets: TargetCurve[];
		profiles: IEMProfile[];
	}) => void;
	upsertMeasurement: (measurement: Measurement) => void;
	removeMeasurement: (id: string) => void;
	upsertTarget: (target: TargetCurve) => void;
	removeTarget: (id: string) => void;
	upsertProfile: (profile: IEMProfile) => void;
	removeProfile: (id: string) => void;
	/** Null references to a deleted measurement (keeps stored EQ). */
	detachMeasurement: (id: string) => void;
	/** Null references to a deleted target (keeps stored EQ). */
	detachTarget: (id: string) => void;
	clearAll: () => void;
}

/** User targets plus built-ins (flat reference). Built-ins always first. */
export function allTargets(
	targets: Record<string, TargetCurve>,
): TargetCurve[] {
	return [...builtinTargets(), ...Object.values(targets)];
}

export function resolveTarget(
	targets: Record<string, TargetCurve>,
	id: string | null,
): TargetCurve | null {
	if (!id) return null;
	if (id === "builtin-flat") return builtinTargets()[0] ?? null;
	return targets[id] ?? null;
}

export const useIEMStore = create<IEMState>()((set) => ({
	measurements: {},
	targets: {},
	profiles: {},

	hydrate: (data) => {
		const measurements: Record<string, Measurement> = {};
		for (const m of data.measurements) {
			// Drop corrupt curves at the boundary so NaN/short data can
			// never reach the graphs or the fitter.
			if (validateCurve(m).length === 0) measurements[m.id] = m;
		}
		const targets: Record<string, TargetCurve> = {};
		for (const t of data.targets) {
			if (validateCurve(t).length === 0) targets[t.id] = t;
		}
		const profiles: Record<string, IEMProfile> = {};
		for (const p of data.profiles) {
			// Heal dangling references: a profile pointing at a deleted or
			// rejected curve falls back to "choose" instead of a ghost id.
			// Stored eq/eqMeta are kept as the historical record.
			profiles[p.id] = {
				...p,
				measurementId:
					p.measurementId && measurements[p.measurementId]
						? p.measurementId
						: null,
				targetId:
					p.targetId === "builtin-flat" || (p.targetId && targets[p.targetId])
						? p.targetId
						: null,
			};
		}
		set({ measurements, targets, profiles });
	},

	upsertMeasurement: (measurement) =>
		set((s) => ({
			measurements: { ...s.measurements, [measurement.id]: measurement },
		})),

	removeMeasurement: (id) =>
		set((s) => {
			const measurements = { ...s.measurements };
			delete measurements[id];
			return { measurements };
		}),

	upsertTarget: (target) =>
		set((s) => ({ targets: { ...s.targets, [target.id]: target } })),

	removeTarget: (id) =>
		set((s) => {
			const targets = { ...s.targets };
			delete targets[id];
			return { targets };
		}),

	upsertProfile: (profile) =>
		set((s) => ({ profiles: { ...s.profiles, [profile.id]: profile } })),

	removeProfile: (id) =>
		set((s) => {
			const profiles = { ...s.profiles };
			delete profiles[id];
			return { profiles };
		}),

	detachMeasurement: (id) =>
		set((s) => {
			const profiles: Record<string, IEMProfile> = {};
			for (const [pid, p] of Object.entries(s.profiles)) {
				profiles[pid] =
					p.measurementId === id
						? { ...p, measurementId: null, updatedAt: Date.now() }
						: p;
			}
			return { profiles };
		}),

	detachTarget: (id) =>
		set((s) => {
			const profiles: Record<string, IEMProfile> = {};
			for (const [pid, p] of Object.entries(s.profiles)) {
				profiles[pid] =
					p.targetId === id
						? { ...p, targetId: null, updatedAt: Date.now() }
						: p;
			}
			return { profiles };
		}),

	clearAll: () => set({ measurements: {}, targets: {}, profiles: {} }),
}));
