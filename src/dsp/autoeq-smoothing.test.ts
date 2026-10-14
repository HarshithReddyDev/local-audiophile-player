import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AutoEQInput } from "../iem/types";
import type { FitResult, FittingOptions } from "./autoeq";
import { fitPEQ } from "./autoeq";
import type { CorpusCase } from "./corpus";
import { buildCorpus } from "./corpus";
import type { ResponseCurve } from "./curves";
import {
	countExtrema,
	type SmoothingPresetId,
	smoothByPreset,
	smoothingDeviation,
} from "./smoothing";
import { mulberry32, synthMeasurement } from "./synth";
import type { PEQProfile } from "./types";
import {
	evaluateCase,
	figureSvg,
	runValidation,
	validateResult,
} from "./validation";

/**
 * Phase 8D evidence suite: optional measurement smoothing. Benchmark/study
 * tests log comparison tables (decisions recorded in
 * docs/autoeq-smoothing.md); guard tests assert hard policy. Nothing here
 * tunes the optimizer or the smoother — it measures them. Raw corpus data
 * is never modified: smoothed inputs are derived per-fit.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function baseInput(case_: CorpusCase): AutoEQInput {
	return {
		measurement: case_.measurement,
		target: case_.target,
		frequencyRange: { min: 20, max: 20000 },
		fittingOptions: { maxBands: 8, maxGainDb: 12, preferParametric: true },
	};
}

function fit(
	case_: CorpusCase,
	smoothing: SmoothingPresetId,
	options: Partial<FittingOptions> = {},
): FitResult {
	const measurement =
		smoothing === "off"
			? case_.measurement
			: smoothByPreset(case_.measurement, smoothing);
	return fitPEQ(baseInput({ ...case_, measurement }), {
		...case_.options,
		...options,
	});
}

/** Response-level evaluation, ALWAYS against the RAW measurement. */
function evalRaw(case_: CorpusCase, result: FitResult) {
	return evaluateCase(
		case_,
		{
			preamp: result.profile.preamp,
			enabled: true,
			bands: result.profile.bands.map((b, i) => ({ ...b, id: `s-${i}` })),
		},
		result.profile.preamp,
		result.metrics.maxBoostDb,
		result.metrics.maxCutDb,
	);
}

function scrubbed(result: FitResult): string {
	return JSON.stringify({
		...result,
		metrics: { ...result.metrics, elapsedMs: 0 },
	});
}

/** Regression policy (§16 lineage): improvement-or-neutral in noise. */
function withinPolicy(after: number, before: number): boolean {
	return after <= before * 1.05 + 0.03;
}

describe("Phase 8D Off identity (§18)", () => {
	it("Off is bit-identical to Phase 8C on all 22 cases", () => {
		const corpus = buildCorpus();
		for (const case_ of corpus) {
			const off = fit(case_, "off");
			const direct = fitPEQ(baseInput(case_), { ...case_.options });
			expect(scrubbed(off), `${case_.id} off vs direct`).toBe(scrubbed(direct));
			// Harness-level: explicit "off" equals default validation path.
			const twice = fit(case_, "off");
			expect(scrubbed(twice), `${case_.id} determinism`).toBe(scrubbed(off));
		}
		// Full-report identity: smoothing fields default, metrics untouched.
		const report = runValidation(corpus, 256, {}, "off");
		expect(report.optimizerVersion).toBe(2);
		for (const entry of report.cases) {
			expect(entry.smoothingPreset).toBe("off");
			expect(entry.smoothingDeviationDb).toBe(0);
		}
	}, 300000);
});

describe("Phase 8D synthetic variants (§8)", () => {
	it("fits raw vs light vs moderate on 8 deterministic noisy shapes", () => {
		const flat = { frequencies: [20, 20000], gains: [0, 0] };
		const heavy = (
			base: ResponseCurve,
			fMin: number,
			fMax: number,
			amp: number,
			seed: number,
		): ResponseCurve => {
			const rand = mulberry32(seed);
			return {
				frequencies: [...base.frequencies],
				gains: base.gains.map((g, i) => {
					const f = base.frequencies[i] ?? 0;
					return f >= fMin && f <= fMax ? g + (rand() * 2 - 1) * amp : g;
				}),
			};
		};
		const smoothBroad = synthMeasurement(
			[
				{ type: "lowshelf", frequency: 100, gain: 5, q: 1 },
				{ type: "peaking", frequency: 800, gain: 3, q: 1 },
			],
			{ points: 500 },
		);
		const variants: { tag: string; measurement: ResponseCurve }[] = [
			{
				tag: "broad+noise",
				measurement: synthMeasurement(
					[{ type: "lowshelf", frequency: 100, gain: 5, q: 1 }],
					{ points: 500, noiseDb: 1, seed: 21 },
				),
			},
			{
				tag: "narrow-peak+noise",
				measurement: synthMeasurement(
					[{ type: "peaking", frequency: 3000, gain: 7, q: 4 }],
					{ points: 500, noiseDb: 1, seed: 22 },
				),
			},
			{
				tag: "narrow-dip+noise",
				measurement: synthMeasurement(
					[{ type: "peaking", frequency: 2500, gain: -8, q: 5 }],
					{ points: 500, noiseDb: 1, seed: 23 },
				),
			},
			{
				tag: "multi-broad+noise",
				measurement: synthMeasurement(
					[
						{ type: "lowshelf", frequency: 100, gain: 5, q: 1 },
						{ type: "peaking", frequency: 800, gain: 3, q: 1 },
						{ type: "highshelf", frequency: 8000, gain: -3, q: 1 },
					],
					{ points: 500, noiseDb: 1, seed: 24 },
				),
			},
			{ tag: "hf-noise", measurement: heavy(smoothBroad, 5000, 20000, 2, 25) },
			{ tag: "lf-noise", measurement: heavy(smoothBroad, 20, 300, 2, 26) },
			{ tag: "smooth-clean", measurement: smoothBroad },
			{
				tag: "mixed",
				measurement: synthMeasurement(
					[
						{ type: "lowshelf", frequency: 120, gain: 4, q: 1 },
						{ type: "peaking", frequency: 3000, gain: 6, q: 4 },
					],
					{ points: 500, noiseDb: 1, seed: 28 },
				),
			},
		];
		for (const variant of variants) {
			const case_: CorpusCase = {
				id: `synth-${variant.tag}`,
				title: variant.tag,
				measurement: variant.measurement,
				target: flat,
				appropriateness: "synthetic 8D probe",
			};
			for (const preset of ["off", "light", "moderate"] as const) {
				const result = fit(case_, preset);
				const evaled = evalRaw(case_, result);
				expect(
					validateResult(result.profile.bands, 12, 12, 12, 0.4, 10),
					`${variant.tag}/${preset} validity`,
				).toEqual([]);
				const dev =
					preset === "off"
						? 0
						: smoothingDeviation(
								variant.measurement,
								smoothByPreset(variant.measurement, preset),
							).rmsDb;
				console.log(
					`smooth/synth ${variant.tag}/${preset}: rms=${evaled.finalRmsDb.toFixed(3)} bands=${evaled.bands} ` +
						`maxQ=${evaled.maxQ.toFixed(2)} maxAbs=${evaled.finalMaxAbsDb.toFixed(2)} flags=[${evaled.flags}] dev=${dev.toFixed(3)}`,
				);
			}
		}
		// Transparency on clean data: smoothing a noise-free curve must not
		// restructure its fit.
		const clean: CorpusCase = {
			id: "synth-clean",
			title: "clean",
			measurement: smoothBroad,
			target: flat,
			appropriateness: "transparency probe",
		};
		const rawBands = fit(clean, "off").profile.bands.length;
		const lightBands = fit(clean, "light").profile.bands.length;
		expect(lightBands).toBe(rawBands);
		expect(
			withinPolicy(
				evalRaw(clean, fit(clean, "light")).finalRmsDb,
				evalRaw(clean, fit(clean, "off")).finalRmsDb,
			),
		).toBe(true);
	}, 300000);

	it("proves complexity reduction at realistic density", () => {
		// 1000-pt rig exports: the density real measurements have. Same
		// feature/noise family as case 18 (seed 7).
		const flat = { frequencies: [20, 20000], gains: [0, 0] };
		for (const noiseDb of [0.5, 1.5]) {
			const meas = synthMeasurement(
				[{ type: "peaking", frequency: 1000, gain: 3, q: 1 }],
				{ points: 1000, noiseDb, seed: 7 },
			);
			const truth = synthMeasurement(
				[{ type: "peaking", frequency: 1000, gain: 3, q: 1 }],
				{ points: 1000 },
			);
			const mkCase = (m: ResponseCurve): CorpusCase => ({
				id: "dense",
				title: "dense",
				measurement: m,
				target: flat,
				appropriateness: "density probe",
			});
			const raw = fitPEQ(baseInput(mkCase(meas)), {});
			const light = fitPEQ(
				baseInput(mkCase(smoothByPreset(meas, "light"))),
				{},
			);
			const bandsOf = (r: FitResult) => r.profile.bands.length;
			const truthRms = (r: FitResult) =>
				evaluateCase(
					mkCase(truth),
					{
						preamp: r.profile.preamp,
						enabled: true,
						bands: r.profile.bands.map((b, i) => ({ ...b, id: `t-${i}` })),
					},
					r.profile.preamp,
					r.metrics.maxBoostDb,
					r.metrics.maxCutDb,
				).finalRmsDb;
			const rawTruth = truthRms(raw);
			const lightTruth = truthRms(light);
			console.log(
				`smooth/dense noise=${noiseDb}: bands ${bandsOf(raw)}→${bandsOf(light)} truthRms ${rawTruth.toFixed(3)}→${lightTruth.toFixed(3)}`,
			);
			expect(bandsOf(light)).toBeLessThan(bandsOf(raw));
			expect(lightTruth).toBeLessThan(rawTruth);
		}
	}, 300000);
});

describe("Phase 8D protected cases (§9, §10, §29)", () => {
	it("Light preserves the narrow 3 kHz peak; Moderate stays usable", () => {
		const corpus = buildCorpus();
		const case_ = corpus.find((c) => c.id === "07-narrow-3k-peak")!;
		const legacy = evalRaw(case_, fit(case_, "off"));
		const light = fit(case_, "light");
		const lightEval = evalRaw(case_, light);
		expect(
			withinPolicy(lightEval.finalRmsDb, legacy.finalRmsDb),
			"07 light RMS",
		).toBe(true);
		expect(lightEval.bands).toBe(legacy.bands);
		const strongest = [...light.profile.bands].sort(
			(a, b) => Math.abs(b.gain) - Math.abs(a.gain),
		)[0]!;
		expect(Math.abs(Math.log2(strongest.frequency / 3000))).toBeLessThan(0.5);
		expect(strongest.gain).toBeLessThan(-3);
		// Moderate softens the protected peak (documented trade-off of the
		// stronger preset): still a working correction, tripwired here.
		const moderateEval = evalRaw(case_, fit(case_, "moderate"));
		expect(moderateEval.finalRmsDb).toBeLessThan(0.5);
		console.log(
			`smooth/protected 07: rms ${legacy.finalRmsDb.toFixed(3)}→${lightEval.finalRmsDb.toFixed(3)}→${moderateEval.finalRmsDb.toFixed(3)} ` +
				`bands ${legacy.bands}→${lightEval.bands}→${moderateEval.bands}`,
		);
	});

	it("noise case: smoothing never harms, complexity shifts logged", () => {
		const corpus = buildCorpus();
		const case_ = corpus.find((c) => c.id === "18-noisy")!;
		const legacy = evalRaw(case_, fit(case_, "off"));
		for (const preset of ["light", "moderate"] as const) {
			const result = fit(case_, preset);
			const evaled = evalRaw(case_, result);
			expect(
				validateResult(result.profile.bands, 12, 12, 12, 0.4, 10),
				`18/${preset} validity`,
			).toEqual([]);
			expect(
				withinPolicy(evaled.finalRmsDb, legacy.finalRmsDb),
				`18/${preset} RMS`,
			).toBe(true);
			expect(evaled.bands).toBeLessThanOrEqual(8);
			console.log(
				`smooth/protected 18/${preset}: rms ${legacy.finalRmsDb.toFixed(3)}→${evaled.finalRmsDb.toFixed(3)} ` +
					`bands ${legacy.bands}→${evaled.bands} maxAbs ${legacy.finalMaxAbsDb.toFixed(2)}→${evaled.finalMaxAbsDb.toFixed(2)} ` +
					`maxQ ${legacy.maxQ.toFixed(2)}→${evaled.maxQ.toFixed(2)} flags [${legacy.flags}]→[${evaled.flags}]`,
			);
		}
	});

	it("guards stay within policy under Light (20/21/10/16/19)", () => {
		const corpus = buildCorpus();
		for (const id of [
			"20-truncated-lf",
			"21-extreme-plausible",
			"10-treble-irregular",
			"16-combined",
			"19-truncated-hf",
		]) {
			const case_ = corpus.find((c) => c.id === id)!;
			const legacy = evalRaw(case_, fit(case_, "off"));
			const light = evalRaw(case_, fit(case_, "light"));
			expect(
				withinPolicy(light.finalRmsDb, legacy.finalRmsDb),
				`${id} light RMS`,
			).toBe(true);
			console.log(
				`smooth/guard ${id}: rms ${legacy.finalRmsDb.toFixed(3)}→${light.finalRmsDb.toFixed(3)} bands ${legacy.bands}→${light.bands}`,
			);
		}
		// Moderate on the treble-complex case flips greedy order (documented
		// basin sensitivity, same class as range presets): tripwire, not policy.
		const sixteen = corpus.find((c) => c.id === "16-combined")!;
		expect(evalRaw(sixteen, fit(sixteen, "moderate")).finalRmsDb).toBeLessThan(
			1.0,
		);
	}, 300000);
});

describe("Phase 8D interactions (§13, §14) and sparse inputs (§16)", () => {
	it("crosses smoothing with range presets and HF treatments", () => {
		const corpus = buildCorpus();
		for (const id of ["18-noisy", "10-treble-irregular"]) {
			const case_ = corpus.find((c) => c.id === id)!;
			for (const range of [
				{ tag: "full", min: 20, max: 20000 },
				{ tag: "10k", min: 20, max: 10000 },
				{ tag: "8k", min: 20, max: 8000 },
			]) {
				for (const preset of ["off", "light"] as const) {
					const result = fit(case_, preset, {
						minFrequency: range.min,
						maxFrequency: range.max,
					});
					const evaled = evalRaw(case_, result);
					expect(
						validateResult(result.profile.bands, 12, 12, 12, 0.4, 10),
						`${id}/${range.tag}/${preset} validity`,
					).toEqual([]);
					const twice = fit(case_, preset, {
						minFrequency: range.min,
						maxFrequency: range.max,
					});
					expect(scrubbed(twice), `${id}/${range.tag}/${preset} deter`).toBe(
						scrubbed(result),
					);
					console.log(
						`smooth/range ${id}/${range.tag}/${preset}: rms=${evaled.finalRmsDb.toFixed(3)} bands=${evaled.bands} range=${result.metrics.rangeHz.map((v) => Math.round(v)).join("-")}`,
					);
				}
			}
			for (const hf of ["average", "fit"] as const) {
				const result = fit(case_, "light", { hfTreatment: hf });
				const evaled = evalRaw(case_, result);
				expect(
					validateResult(result.profile.bands, 12, 12, 12, 0.4, 10),
					`${id}/hf-${hf}/light validity`,
				).toEqual([]);
				expect(result.metrics.hfTreatment).toBe(hf);
				console.log(
					`smooth/hf ${id}/${hf}/light: rms=${evaled.finalRmsDb.toFixed(3)} bands=${evaled.bands}`,
				);
			}
		}
		// Smoothing preserves valid range ⇒ identical clamping on truncation.
		const t19 = corpus.find((c) => c.id === "19-truncated-hf")!;
		const ranges = (["off", "light", "moderate"] as const).map((p) =>
			fit(t19, p).metrics.rangeHz.join("-"),
		);
		expect(new Set(ranges).size).toBe(1);
	}, 300000);

	it("fits smoothed sparse inputs validly at every density", () => {
		for (const pts of [20, 50, 100, 500, 1000]) {
			const meas = synthMeasurement(
				[{ type: "peaking", frequency: 1000, gain: 3, q: 1 }],
				{ points: pts, noiseDb: 1, seed: 11 },
			);
			const case_: CorpusCase = {
				id: `sparse-${pts}`,
				title: `sparse ${pts}`,
				measurement: meas,
				target: { frequencies: [20, 20000], gains: [0, 0] },
				appropriateness: "density probe",
			};
			for (const preset of ["light", "moderate"] as const) {
				const result = fit(case_, preset);
				expect(
					validateResult(result.profile.bands, 12, 12, 12, 0.4, 10),
					`sparse-${pts}/${preset} validity`,
				).toEqual([]);
				expect(scrubbed(fit(case_, preset)), `sparse-${pts} deter`).toBe(
					scrubbed(result),
				);
			}
		}
	}, 300000);
});

describe("Phase 8D figures (§33)", () => {
	it("writes raw+smoothed overlay figures for representative cases", () => {
		const corpus = buildCorpus();
		const jobs: { id: string; preset: SmoothingPresetId }[] = [
			{ id: "18-noisy", preset: "light" },
			{ id: "07-narrow-3k-peak", preset: "moderate" },
			{ id: "02-bass-deficient", preset: "light" },
		];
		const dir = join(ROOT, "tests", "autoeq", "figures");
		mkdirSync(dir, { recursive: true });
		for (const job of jobs) {
			const case_ = corpus.find((c) => c.id === job.id)!;
			const smoothed = smoothByPreset(case_.measurement, job.preset);
			const result = fit(case_, job.preset);
			const profile: PEQProfile = {
				preamp: 0,
				enabled: true,
				bands: result.profile.bands.map((b, i) => ({
					...b,
					id: `fig-${i}`,
				})),
			};
			const svg = figureSvg(case_, profile, 128, smoothed);
			expect(svg).toContain("teal=smoothed-fitting-input");
			const file = join(dir, `smoothing-${job.id}-${job.preset}.svg`);
			if (!existsSync(file)) {
				writeFileSync(file, `${svg}\n`);
				console.warn(`smoothing figure written — review it: ${file}`);
			} else {
				writeFileSync(file, `${svg}\n`);
			}
			// Extrema audit for the report (§11): raw vs smoothed counts.
			console.log(
				`smooth/figure ${job.id}/${job.preset}: extrema ${countExtrema(case_.measurement.gains)}→${countExtrema(smoothed.gains)} ` +
					`dev=${smoothingDeviation(case_.measurement, smoothed).rmsDb.toFixed(3)}dB`,
			);
		}
	}, 300000);
});
