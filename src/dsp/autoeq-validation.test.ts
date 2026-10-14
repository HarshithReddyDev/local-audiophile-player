import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fitPEQ } from "./autoeq";
import { buildCorpus } from "./corpus";
import type { EQBand, PEQProfile } from "./types";
import type { ValidationReport } from "./validation";
import { figureSvg, runValidation, validateResult } from "./validation";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESULTS_PATH = join(ROOT, "tests", "autoeq", "results.json");
const FIGURES_DIR = join(ROOT, "tests", "autoeq", "figures");

/** Round floats for byte-stable committed artifacts. */
function roundReport(report: ValidationReport): ValidationReport {
	const round = (v: number) => Math.round(v * 10000) / 10000;
	return {
		...report,
		cases: report.cases.map((c) => ({
			...c,
			initialRmsDb: round(c.initialRmsDb),
			finalRmsDb: round(c.finalRmsDb),
			rmsImprovementDb: round(c.rmsImprovementDb),
			initialMaxAbsDb: round(c.initialMaxAbsDb),
			finalMaxAbsDb: round(c.finalMaxAbsDb),
			p95AfterDb: round(c.p95AfterDb),
			avgAbsGainDb: round(c.avgAbsGainDb),
			maxBoostDb: round(c.maxBoostDb),
			maxCutDb: round(c.maxCutDb),
			preampDb: round(c.preampDb),
			maxQ: round(c.maxQ),
			minQ: round(c.minQ),
			minBandwidthOct: round(c.minBandwidthOct),
			freqSpanOct: round(c.freqSpanOct),
			minAdjacentOct: round(c.minAdjacentOct),
			excursionDb: round(c.excursionDb),
			qualityScore: round(c.qualityScore),
			largestResidualPeak: c.largestResidualPeak
				? {
						frequency: round(c.largestResidualPeak.frequency),
						db: round(c.largestResidualPeak.db),
					}
				: null,
			bandSummary: c.bandSummary.map((b) => ({
				...b,
				frequency: round(b.frequency),
				gain: round(b.gain),
				q: round(b.q),
			})),
		})),
	};
}

describe("AutoEQ validation corpus", () => {
	it("covers all 21 required shapes plus a target variant", () => {
		const corpus = buildCorpus();
		expect(corpus.length).toBeGreaterThanOrEqual(21);
		expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length);
	});

	it("fits every case validly, deterministically, and without regression", () => {
		const corpus = buildCorpus();
		const report = roundReport(runValidation(corpus));
		const timings: number[] = [];

		for (const case_ of corpus) {
			const first = performance.now();
			const once = fitPEQ(
				{
					measurement: case_.measurement,
					target: case_.target,
					frequencyRange: { min: 20, max: 20000 },
					fittingOptions: {
						maxBands: 8,
						maxGainDb: 12,
						preferParametric: true,
					},
				},
				case_.options ?? {},
			);
			const elapsed = performance.now() - first;
			timings.push(elapsed);
			// Determinism: identical scrubbed output on rerun.
			const twice = fitPEQ(
				{
					measurement: case_.measurement,
					target: case_.target,
					frequencyRange: { min: 20, max: 20000 },
					fittingOptions: {
						maxBands: 8,
						maxGainDb: 12,
						preferParametric: true,
					},
				},
				case_.options ?? {},
			);
			const scrub = (r: typeof once) => ({
				...r,
				metrics: { ...r.metrics, elapsedMs: 0 },
			});
			expect(JSON.stringify(scrub(twice))).toBe(JSON.stringify(scrub(once)));
			// Validity invariants (no baseline needed).
			expect(validateResult(once.profile.bands, 12, 12, 12, 0.4, 10)).toEqual(
				[],
			);
			const entry = report.cases.find((c) => c.caseId === case_.id);
			expect(entry).toBeDefined();
			if (entry) {
				expect(entry.finalRmsDb).toBeLessThanOrEqual(entry.initialRmsDb + 0.05);
			}
			expect(elapsed).toBeLessThan(15000);
		}

		const sorted = [...timings].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
		const p95 =
			sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ??
			0;
		console.log(
			`validation/corpus runtime ms: min=${Math.round(sorted[0] ?? 0)} ` +
				`median=${Math.round(median)} p95=${Math.round(p95)} max=${Math.round(sorted[sorted.length - 1] ?? 0)}`,
		);

		// Compare against the committed baseline (tolerances, not exact floats).
		if (!existsSync(RESULTS_PATH)) {
			mkdirSync(dirname(RESULTS_PATH), { recursive: true });
			writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`);
			console.warn("validation baseline written — review and commit it");
		} else {
			const committed = JSON.parse(
				readFileSync(RESULTS_PATH, "utf-8"),
			) as ValidationReport;
			expect(committed.corpusVersion).toBe(report.corpusVersion);
			expect(committed.optimizerVersion).toBe(report.optimizerVersion);
			expect(committed.cases).toHaveLength(report.cases.length);
			for (const entry of report.cases) {
				const baseline = committed.cases.find((c) => c.caseId === entry.caseId);
				expect(baseline, `missing baseline for ${entry.caseId}`).toBeDefined();
				if (!baseline) continue;
				expect(entry.finalRmsDb).toBeLessThanOrEqual(
					baseline.finalRmsDb * 1.05 + 0.03,
				);
				expect(entry.bands).toBeLessThanOrEqual(baseline.bands + 1);
				expect(entry.flags.slice().sort()).toEqual(
					baseline.flags.slice().sort(),
				);
			}
			writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`);
		}

		// Deterministic figures for every case.
		mkdirSync(FIGURES_DIR, { recursive: true });
		for (const case_ of corpus) {
			const summary = report.cases.find((c) => c.caseId === case_.id);
			const profile: PEQProfile = {
				preamp: 0,
				enabled: true,
				bands: (summary?.bandSummary ?? []).map((b, i) => ({
					id: `fig-${i}`,
					type: b.type as EQBand["type"],
					frequency: b.frequency,
					gain: b.gain,
					q: b.q,
					enabled: true,
				})),
			};
			writeFileSync(
				join(FIGURES_DIR, `${case_.id}.svg`),
				figureSvg(case_, profile),
			);
		}
	}, 300000);
});
