import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adaptOpraPreset, OPRA_LICENSE } from "./opra";
import { findSource } from "./sources";

/**
 * OPRA proof-of-concept fixtures: hand-verified records from the frozen
 * snapshot inputs (scripts/catalog/opra-poc/). These pin adapter behavior
 * and attribution chains on real records; bulk determinism lives in
 * opra-bulk.test.ts, manifest watch below.
 */

const DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"scripts",
	"catalog",
	"opra-poc",
);

const JOBS: [string, string, string, string][] = [
	[
		"sennheiser",
		"hd_600",
		"autoeq_oratory1990",
		"products_hd_600_eq_autoeq_oratory1990.info.json",
	],
	[
		"sennheiser",
		"hd_600",
		"oratory1990_harman_target",
		"products_hd_600_eq_oratory1990_harman_target.info.json",
	],
	[
		"sennheiser",
		"ie_200",
		"autoeq_oratory1990",
		"products_ie_200_eq_autoeq_oratory1990.info.json",
	],
	[
		"sennheiser",
		"ie_200",
		"oratory1990_harman_target",
		"products_ie_200_eq_oratory1990_harman_target.info.json",
	],
	[
		"sennheiser",
		"hd_650",
		"autoeq_oratory1990",
		"products_hd_650_eq_autoeq_oratory1990.info.json",
	],
	[
		"sennheiser",
		"hd_650",
		"oratory1990_harman_target",
		"products_hd_650_eq_oratory1990_harman_target.info.json",
	],
];

describe("OPRA proof-of-concept fixtures", () => {
	it("adapts frozen inputs with intact attribution chains", () => {
		for (const [v, p, d, f] of JOBS) {
			const info: unknown = JSON.parse(readFileSync(join(DIR, f), "utf-8"));
			const { preset } = adaptOpraPreset(v, p, d, info);
			expect(preset.origin).toBe("community");
			expect(preset.provenance.license).toBe(OPRA_LICENSE);
			expect(preset.provenance.redistribution).toBe("full");
			expect(preset.provenance.shareAlike).toBe(true);
			expect(preset.provenance.attribution).toMatch(/via OPRA/);
			expect(preset.provenance.sourceUrl).toContain(
				"opra-project/OPRA/tree/main",
			);
			expect(preset.peq.bands.length).toBeGreaterThan(0);
			expect(preset.peq.bands.length).toBeLessThanOrEqual(12);
		}
		const autoeq = JOBS.filter(([, , d]) => d.startsWith("autoeq_"));
		expect(autoeq.length).toBe(3);
	});
});

describe("legal watch (Phase 21)", () => {
	it("snapshot manifest matches registry expectations", () => {
		const manifest = JSON.parse(
			readFileSync(join(DIR, "..", "opra-snapshot", "manifest.json"), "utf-8"),
		) as {
			licenseId: string;
			revision: string;
			recordCounts: { vendors: number; products: number; eq: number };
		};
		// If OPRA's license changes, the next refresh MUST update the
		// registry + docs deliberately — this test fails until it does,
		// so stale assumptions can never ship silently.
		expect(manifest.licenseId).toBe("CC BY-SA 4.0");
		const opra = findSource("opra");
		expect(opra?.status).toBe("B");
		expect(opra?.dataLicense).toContain("CC BY-SA 4.0");
		expect(typeof manifest.revision).toBe("string");
		expect(manifest.revision).toHaveLength(40);
		expect(manifest.recordCounts.vendors).toBe(714);
		expect(manifest.recordCounts.products).toBe(6230);
		expect(manifest.recordCounts.eq).toBe(12594);
	});
});
