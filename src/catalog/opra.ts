/**
 * OPRA adapter: convert OPRA database records (CC BY-SA 4.0, verified —
 * see docs/catalog-source-audit.md) into catalog records.
 *
 * Scope discipline, per the audit:
 * - EQ presets: converted (parametric_eq only; unknown band types reject
 *   the record). Creator + measurement credit preserved verbatim in
 *   attribution; OPRA directory URL kept as the verifiable source link.
 * - Products/vendors: names + types only (facts). Blurbs, logos, and
 *   artwork are NEVER taken (text/image rights unclear).
 * - Raw measurements: OPRA hosts presets, not measurement CSVs — nothing
 *   to take, nothing fabricated.
 * - Upstream caveat preserved: many records derive from AutoEq
 *   contributor measurements; the attribution chain
 *   (creator + measurer + OPRA) travels intact so the caveat is visible,
 *   never laundered.
 */

import type { FilterType } from "../dsp/types";
import type { CatalogDevice, CatalogPreset, DeviceType } from "./types";

export const OPRA_REPO = "https://github.com/opra-project/OPRA";
export const OPRA_LICENSE = "CC BY-SA 4.0";
export const OPRA_LICENSE_URL =
	"https://raw.githubusercontent.com/opra-project/OPRA/main/LICENSE.md";

const BAND_MAP: Record<string, FilterType> = {
	peak_dip: "peaking",
	low_shelf: "lowshelf",
	high_shelf: "highshelf",
	low_pass: "lowpass",
	high_pass: "highpass",
	band_pass: "bandpass",
	band_stop: "notch",
};

const PRODUCT_TYPE_MAP: Record<string, DeviceType> = {
	in_ear: "iem",
	true_wireless: "tws",
	earbuds: "earbuds",
	over_the_ear: "other",
	on_ear: "other",
};

export interface OpraEqInfo {
	author?: unknown;
	details?: unknown;
	link?: unknown;
	type?: unknown;
	parameters?: {
		gain_db?: unknown;
		bands?: unknown;
	};
}

export interface AdaptedOpraPreset {
	preset: CatalogPreset;
	warnings: string[];
}

/** Convert one OPRA eq/info.json into a catalog preset (or reject). */
export function adaptOpraPreset(
	vendorId: string,
	productId: string,
	dirName: string,
	info: unknown,
): AdaptedOpraPreset {
	const fail = (reason: string): never => {
		throw new OpraAdapterError(reason);
	};
	if (typeof info !== "object" || info === null || Array.isArray(info)) {
		fail("eq info must be an object");
	}
	const v = info as Record<string, unknown>;
	const author = typeof v["author"] === "string" ? v["author"].trim() : "";
	const details = typeof v["details"] === "string" ? v["details"].trim() : "";
	if (!author) fail("eq author missing");
	if (!details) fail("eq details missing");
	if (v["type"] !== "parametric_eq")
		fail(`unsupported eq type ${JSON.stringify(v["type"])}`);
	const params =
		typeof v["parameters"] === "object" && v["parameters"] !== null
			? (v["parameters"] as Record<string, unknown>)
			: null;
	if (params === null) {
		throw new OpraAdapterError("eq parameters missing");
	}
	const rawBands: unknown = params["bands"];
	if (!Array.isArray(rawBands) || rawBands.length === 0) {
		throw new OpraAdapterError("eq parameters.bands missing or empty");
	}
	const link =
		typeof v["link"] === "string" && v["link"].trim() !== ""
			? v["link"].trim()
			: null;
	if (link !== null) {
		try {
			const u = new URL(link);
			if (u.protocol !== "https:" && u.protocol !== "http:")
				fail("eq link must be http(s)");
		} catch {
			fail("eq link malformed");
		}
	}
	const warnings: string[] = [];
	const bands = rawBands.map((raw, i) => {
		if (typeof raw !== "object" || raw === null)
			fail(`band ${i} must be an object`);
		const b = raw as Record<string, unknown>;
		const mapped = BAND_MAP[typeof b["type"] === "string" ? b["type"] : ""];
		if (mapped === undefined) {
			throw new OpraAdapterError(
				`band ${i}: unsupported type ${JSON.stringify(b["type"])}`,
			);
		}
		for (const k of ["frequency", "gain_db", "q"] as const) {
			if (typeof b[k] !== "number" || !Number.isFinite(b[k] as number)) {
				fail(`band ${i}: ${k} must be a finite number`);
			}
		}
		const frequency = b["frequency"] as number;
		const gain = b["gain_db"] as number;
		const q = b["q"] as number;
		if (frequency <= 0 || q <= 0)
			fail(`band ${i}: frequency and q must be positive`);
		// Shelves in OPRA carry q 0.7 like ours; pass-band types ignore gain
		// downstream exactly as our engine does — no silent reinterpretation.
		return { type: mapped, frequency, gain, q, enabled: true };
	});
	const preamp =
		typeof params["gain_db"] === "number" && Number.isFinite(params["gain_db"])
			? params["gain_db"]
			: 0;
	const dir = `${vendorId}/${productId}/${dirName}`;
	return {
		preset: {
			id: `opra-${dir
				.replaceAll(/[^a-z0-9]+/gi, "-")
				.replaceAll(/^-+|-+$/g, "")
				.toLowerCase()}`,
			name: dirName.replaceAll("_", " "),
			deviceId: null, // wired by the caller (seed id or new device)
			origin: "community",
			peq: { version: 1, preamp, enabled: true, bands },
			measurementRef: details,
			targetRef: null,
			provenance: {
				source: "OPRA",
				sourceType: "community",
				sourceUrl: `${OPRA_REPO}/tree/main/database/vendors/${vendorId}/products/${productId}/eq/${dirName}`,
				attribution: `EQ by ${author} via OPRA (${details})`,
				license: OPRA_LICENSE,
				redistribution: "full",
				shareAlike: true,
				importedAt: null,
			},
			createdAt: 0,
		},
		warnings,
	};
}

/** Map an OPRA product type/subtype onto our device taxonomy. */
export function adaptOpraProductType(
	type: unknown,
	subtype: unknown,
): DeviceType {
	if (type === "headphones" && typeof subtype === "string") {
		return PRODUCT_TYPE_MAP[subtype] ?? "other";
	}
	return "other";
}

export class OpraAdapterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OpraAdapterError";
	}
}

/** Minimal OPRA product shell: names + type facts only, never blurbs. */
export function adaptOpraProduct(
	vendorName: string,
	productName: string,
	type: unknown,
	subtype: unknown,
): Pick<CatalogDevice, "manufacturer" | "model" | "deviceType"> {
	return {
		manufacturer: vendorName,
		model: productName,
		deviceType: adaptOpraProductType(type, subtype),
	};
}
