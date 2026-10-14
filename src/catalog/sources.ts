/**
 * Machine-readable source registry: every external source the catalog
 * knows about, with the audit fields the brief requires. Consumed by the
 * legal-safety gate (ingestion refuses anything not approved) — legal
 * statements live HERE, never scattered across components.
 *
 * Classifications: A safe · B conditional · C metadata-only · D link-only
 * · E do-not-use · U unresolved (needs permission/contact).
 * Evidence: docs/catalog-source-audit.md. Re-audit when terms change.
 */

export type SourceClassification = "A" | "B" | "C" | "D" | "E" | "U";

export interface SourceRecord {
	id: string;
	name: string;
	website: string;
	datasetUrl: string | null;
	license: string;
	licenseUrl: string | null;
	dataLicense: string | null;
	redistribution: "full" | "metadata-only" | "none" | "unknown";
	modification: "allowed" | "share-alike" | "unclear" | "forbidden";
	attribution: string;
	shareAlike: boolean;
	status: SourceClassification;
	/** YYYY-MM-DD of last verification. */
	verifiedAt: string;
	/** What primary evidence the classification rests on. */
	evidence: string;
	notes: string;
}

export const SOURCE_REGISTRY: SourceRecord[] = [
	{
		id: "in-repo",
		name: "In-repo authored content",
		website: "",
		datasetUrl: null,
		license: "MIT",
		licenseUrl: null,
		dataLicense: "MIT",
		redistribution: "full",
		modification: "allowed",
		attribution: "This repository (MIT).",
		shareAlike: false,
		status: "A",
		verifiedAt: "2026-09-14",
		evidence: "Own authorship; project license.",
		notes: "Tutorial preset, code, math, docs. The only Tier 1 class.",
	},
	{
		id: "opra",
		name: "OPRA (Open Profiles for Revealing Audio)",
		website: "https://github.com/opra-project/OPRA",
		datasetUrl: "https://github.com/opra-project/OPRA/tree/main/database",
		license: "MIT (code) + CC BY-SA 4.0 (dataset)",
		licenseUrl:
			"https://raw.githubusercontent.com/opra-project/OPRA/main/LICENSE.md",
		dataLicense: "CC BY-SA 4.0 International (manufacturer, product, EQ data)",
		redistribution: "full",
		modification: "share-alike",
		attribution:
			"Browser-level: OPRA logo + description + repository link. Preset-level: creator credited prominently + OPRA link.",
		shareAlike: true,
		status: "B",
		verifiedAt: "2026-09-15",
		evidence:
			"Fetched LICENSE.md (CC BY-SA 4.0, headed 'Dataset:'), README FAQ (code MIT / data CC BY-SA, two-level attribution), THIRD_PARTY_LICENSES.md, schemas/eq_info.json, sample records with author+details. Re-verified live 2026-09-15: posture unchanged.",
		notes:
			"Upstream caveat: many EQ records derive from AutoEq contributor measurements (oratory1990 et al.) whose own grants are undocumented; OPRA asserts redistribution via CC BY-SA. Keep full author+measurer+OPRA chains, re-audit on terms change. Vendor blurbs and logos NOT taken (text/image rights unclear). Product names/types only.",
	},
	{
		id: "autoeq-code",
		name: "AutoEq software",
		website: "https://github.com/jaakkopasanen/AutoEq",
		datasetUrl: null,
		license: "MIT",
		licenseUrl:
			"https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/LICENSE",
		dataLicense: null,
		redistribution: "full",
		modification: "allowed",
		attribution: "Jaakko Pasanen 2018–2022 (MIT notice on reuse).",
		shareAlike: false,
		status: "A",
		verifiedAt: "2026-09-14",
		evidence:
			"Fetched LICENSE (MIT, software + docs). Ideas studied, nothing copied.",
		notes:
			"Algorithms only. Measurement data explicitly excluded (see autoeq-data).",
	},
	{
		id: "autoeq-data",
		name: "AutoEq measurements/results/targets",
		website: "https://github.com/jaakkopasanen/AutoEq",
		datasetUrl:
			"https://github.com/jaakkopasanen/AutoEq/tree/master/measurements",
		license: "MIT (code only)",
		licenseUrl:
			"https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/LICENSE",
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "Per-source; no blanket grant.",
		shareAlike: false,
		status: "E",
		verifiedAt: "2026-09-14",
		evidence:
			"README confirms measurements/ aggregates oratory1990, crinacle, InnerFidelity, Rtings, legacy headphone.com with no redistribution grant for contributed data.",
		notes:
			"MIT-on-code is not MIT-on-data. Bundle nothing; link the repo/app only.",
	},
	{
		id: "oratory1990",
		name: "oratory1990 measurements/presets",
		website: "https://www.reddit.com/r/oratory1990/wiki/index/list_of_presets/",
		datasetUrl: null,
		license: "None stated",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "oratory1990 ( Reddit u/oratory1990 ).",
		shareAlike: false,
		status: "U",
		verifiedAt: "2026-09-14",
		evidence:
			"Community knowledge: public list, no license file to fetch; contact path is Reddit u/oratory1990 (well-known handle, not re-verified here).",
		notes:
			"Tier 3: highest-value permission target. See permission draft in docs/catalog-data-licenses.md §8.",
	},
	{
		id: "crinacle",
		name: "crinacle database",
		website: "https://crinacle.com",
		datasetUrl: null,
		license: "None stated",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "crinacle.",
		shareAlike: false,
		status: "U",
		verifiedAt: "2026-09-14",
		evidence:
			"Publicly viewable database/graph tool; no redistribution grant located.",
		notes:
			"Tier 3: contact via website (unverified here). See permission draft.",
	},
	{
		id: "innerfidelity",
		name: "InnerFidelity measurements",
		website:
			"https://www.stereophile.com/content/innerfidelity-headphone-measurements",
		datasetUrl: null,
		license: "None stated (commercial editorial)",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "InnerFidelity / Stereophile.",
		shareAlike: false,
		status: "E",
		verifiedAt: "2026-09-14",
		evidence: "Commercial editorial archive; no redistribution grant.",
		notes: "Link only.",
	},
	{
		id: "rtings",
		name: "Rtings measurements",
		website: "https://www.rtings.com/headphones/1-5/graph",
		datasetUrl: null,
		license: "Commercial terms (restrictive)",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "Rtings.com.",
		shareAlike: false,
		status: "E",
		verifiedAt: "2026-09-14",
		evidence:
			"Commercial lab; known restrictive terms on scraping/redistribution. Full ToS re-read recommended before any posture change.",
		notes: "Link only.",
	},
	{
		id: "headphonecom-legacy",
		name: "Legacy headphone.com measurements",
		website: "",
		datasetUrl: null,
		license: "None stated",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "Unknown.",
		shareAlike: false,
		status: "E",
		verifiedAt: "2026-09-14",
		evidence:
			"Historical dataset of unclear provenance; company output has since changed.",
		notes: "Do not bundle.",
	},
	{
		id: "squiglink",
		name: "squig.link community databases",
		website: "https://squig.link",
		datasetUrl: null,
		license: "None stated",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "Per-creator rights.",
		shareAlike: false,
		status: "D",
		verifiedAt: "2026-09-14",
		evidence:
			"Homepage is a JS shell; no license/redistribution/API statement discoverable. Individual creators hold separate rights.",
		notes: "Link only. Downloadable CSVs are viewable, not licensed.",
	},
	{
		id: "harman-targets",
		name: "Harman-style target curves",
		website: "",
		datasetUrl: null,
		license: "Research data, no redistribution grant",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "unknown",
		modification: "unclear",
		attribution: "Harman International.",
		shareAlike: false,
		status: "E",
		verifiedAt: "2026-09-14",
		evidence:
			"Published research ≠ licensed numeric files. Digitized/derived forms not cleared.",
		notes: "App keeps parametric built-ins only.",
	},
	{
		id: "manufacturer-metadata",
		name: "Manufacturer product metadata",
		website: "",
		datasetUrl: null,
		license: "Facts (no creative expression copied)",
		licenseUrl: null,
		dataLicense: null,
		redistribution: "metadata-only",
		modification: "allowed",
		attribution: "Per-record manufacturer + official link.",
		shareAlike: false,
		status: "C",
		verifiedAt: "2026-09-14",
		evidence:
			"Facts + outbound links; no descriptions, images, or measurements copied. Per-record provenance in seed.",
		notes: "The only class the seed expands with besides in-repo content.",
	},
];

export function findSource(id: string): SourceRecord | null {
	return SOURCE_REGISTRY.find((s) => s.id === id) ?? null;
}

export interface BundlingVerdict {
	allowed: boolean;
	/** Conditions that must be met (attribution, share-alike, …). */
	conditions: string[];
	/** Why denied, when denied. */
	reasons: string[];
}

/**
 * LEGAL-SAFETY GATE. Decides whether data from a source may be bundled,
 * given what the record claims. Refuses whenever: license missing,
 * redistribution unclear, upstream provenance unclear, attribution
 * unknown, explicit prohibition, or NC/ND conflicting with our
 * normalize-and-convert pipeline. "Unknown" + "bundle" is never allowed.
 */
export function bundlingVerdict(source: SourceRecord): BundlingVerdict {
	const reasons: string[] = [];
	const conditions: string[] = [];
	if (source.status === "E" || source.status === "U") {
		reasons.push(
			`source ${source.id} is classified ${source.status}: not cleared for bundling`,
		);
	}
	if (source.status === "D" || source.status === "C") {
		reasons.push(
			`source ${source.id} is ${source.status === "D" ? "link-only" : "metadata-only"}: no data bundling`,
		);
	}
	if (source.redistribution === "unknown" || source.redistribution === "none") {
		reasons.push(`redistribution ${source.redistribution}: bundling forbidden`);
	}
	if (
		source.modification === "unclear" ||
		source.modification === "forbidden"
	) {
		reasons.push(
			`modification ${source.modification}: pipeline normalizes/transforms`,
		);
	}
	if (!source.attribution.trim()) {
		reasons.push("attribution requirement unknown");
	}
	if (source.status === "B") {
		conditions.push(`attribute per record: ${source.attribution}`);
		if (source.shareAlike) {
			conditions.push(
				"ShareAlike: adapted dataset files carry CC BY-SA 4.0 + notice; code stays separately licensed",
			);
		}
		conditions.push(
			`re-audit cadence applies (last verified ${source.verifiedAt})`,
		);
	}
	if (
		source.status === "A" &&
		source.id !== "in-repo" &&
		source.id !== "autoeq-code"
	) {
		reasons.push(
			`unexpected Tier 1 claim for ${source.id}: allowlist is in-repo + autoeq-code only`,
		);
	}
	return { allowed: reasons.length === 0, conditions, reasons };
}

/** Convenience: may records from this source id be bundled at all? */
export function mayBundleSource(id: string): boolean {
	const source = findSource(id);
	if (!source) return false;
	return bundlingVerdict(source).allowed;
}
