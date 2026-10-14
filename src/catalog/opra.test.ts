import { describe, expect, it } from "vitest";
import {
	adaptOpraPreset,
	adaptOpraProduct,
	adaptOpraProductType,
	OPRA_LICENSE,
	OpraAdapterError,
} from "./opra";
import { validateCatalog } from "./validate";

function info(over: Record<string, unknown> = {}) {
	return {
		author: "AutoEQ",
		details: "Measured by oratory1990",
		type: "parametric_eq",
		parameters: {
			gain_db: -6.3,
			bands: [
				{ type: "low_shelf", frequency: 105, gain_db: -0.4, q: 0.7 },
				{ type: "peak_dip", frequency: 7148, gain_db: 2.5, q: 1.39 },
				{ type: "high_shelf", frequency: 10000, gain_db: -1.3, q: 0.7 },
			],
		},
		...over,
	};
}

describe("adaptOpraPreset", () => {
	it("converts band types, preamp, and full attribution", () => {
		const { preset } = adaptOpraPreset(
			"sennheiser",
			"hd_600",
			"autoeq_oratory1990",
			info(),
		);
		expect(preset.id).toBe("opra-sennheiser-hd-600-autoeq-oratory1990");
		expect(preset.origin).toBe("community");
		expect(preset.peq.preamp).toBe(-6.3);
		expect(preset.peq.bands.map((b) => b.type)).toEqual([
			"lowshelf",
			"peaking",
			"highshelf",
		]);
		expect(preset.measurementRef).toBe("Measured by oratory1990");
		expect(preset.provenance).toMatchObject({
			source: "OPRA",
			license: OPRA_LICENSE,
			redistribution: "full",
			shareAlike: true,
		});
		expect(preset.provenance.attribution).toMatch(/AutoEQ/);
		expect(preset.provenance.attribution).toMatch(/oratory1990/);
		expect(preset.provenance.attribution).toMatch(/OPRA/);
		expect(preset.provenance.sourceUrl).toContain(
			"github.com/opra-project/OPRA/tree/main/database/vendors/sennheiser/products/hd_600/eq/autoeq_oratory1990",
		);
	});

	it("maps the full OPRA band vocabulary", () => {
		const { preset } = adaptOpraPreset(
			"v",
			"p",
			"d",
			info({
				parameters: {
					gain_db: 0,
					bands: [
						{ type: "low_pass", frequency: 10000, gain_db: 0, q: 0.7 },
						{ type: "high_pass", frequency: 20, gain_db: 0, q: 0.7 },
						{ type: "band_pass", frequency: 1000, gain_db: 0, q: 1 },
						{ type: "band_stop", frequency: 6000, gain_db: 0, q: 2 },
					],
				},
			}),
		);
		expect(preset.peq.bands.map((b) => b.type)).toEqual([
			"lowpass",
			"highpass",
			"bandpass",
			"notch",
		]);
	});

	it("rejects missing credits, bad types, and malformed bands", () => {
		expect(() =>
			adaptOpraPreset("v", "p", "d", info({ author: " " })),
		).toThrowError(OpraAdapterError);
		expect(() =>
			adaptOpraPreset("v", "p", "d", info({ type: "graphic_eq" })),
		).toThrowError(/unsupported eq type/);
		expect(() =>
			adaptOpraPreset("v", "p", "d", info({ parameters: { bands: [] } })),
		).toThrowError(/bands missing or empty/);
		expect(() =>
			adaptOpraPreset(
				"v",
				"p",
				"d",
				info({
					parameters: {
						bands: [{ type: "laser", frequency: 1, gain_db: 0, q: 1 }],
					},
				}),
			),
		).toThrowError(/unsupported type/);
		expect(() =>
			adaptOpraPreset(
				"v",
				"p",
				"d",
				info({
					parameters: {
						bands: [{ type: "peak_dip", frequency: -5, gain_db: 0, q: 1 }],
					},
				}),
			),
		).toThrowError(/positive/);
		expect(() => adaptOpraPreset("v", "p", "d", null)).toThrowError(
			OpraAdapterError,
		);
	});

	it("converted presets pass the catalog gate", () => {
		const { preset } = adaptOpraPreset(
			"sennheiser",
			"hd_600",
			"autoeq_oratory1990",
			info(),
		);
		expect(
			validateCatalog({
				version: 1,
				devices: [],
				presets: [{ ...preset, deviceId: null }],
			}),
		).toEqual([]);
	});
});

describe("adaptOpraProduct", () => {
	it("maps product types conservatively", () => {
		expect(adaptOpraProductType("headphones", "in_ear")).toBe("iem");
		expect(adaptOpraProductType("headphones", "true_wireless")).toBe("tws");
		expect(adaptOpraProductType("headphones", "over_the_ear")).toBe("other");
		expect(adaptOpraProductType("headphones", "mystery")).toBe("other");
		expect(adaptOpraProductType("speakers", "x")).toBe("other");
	});

	it("keeps names/types only", () => {
		expect(
			adaptOpraProduct("Sennheiser", "HD 600", "headphones", "over_the_ear"),
		).toEqual({
			manufacturer: "Sennheiser",
			model: "HD 600",
			deviceType: "other",
		});
	});
});
