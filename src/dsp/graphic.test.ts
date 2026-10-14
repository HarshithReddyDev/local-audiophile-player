import { describe, expect, it } from "vitest";
import {
	defaultGraphic,
	GRAPHIC_GAIN_DB,
	GRAPHIC_LAYOUTS,
	GRAPHIC_Q,
	graphicLayout,
	graphicToBands,
	sampleToGraphic,
	sanitizeGraphic,
} from "./graphic";

describe("graphic layouts", () => {
	it("offers 5/10/15/20/31/32 ascending layouts", () => {
		expect(GRAPHIC_LAYOUTS.map((l) => l.id)).toEqual([
			"5",
			"10",
			"15",
			"20",
			"31",
			"32",
		]);
		for (const layout of GRAPHIC_LAYOUTS) {
			const sorted = [...layout.centers].sort((a, b) => a - b);
			expect(layout.centers).toEqual(sorted);
			expect(layout.centers.every((f) => f >= 10 && f <= 24000)).toBe(true);
		}
		expect(graphicLayout("10")?.centers).toHaveLength(10);
		expect(graphicLayout("31")?.centers).toHaveLength(31);
		expect(graphicLayout("nope")).toBeNull();
	});

	it("sanitizes length and range deterministically", () => {
		const clean = sanitizeGraphic({
			layoutId: "5",
			gains: [99, -99, Number.NaN],
			enabled: true,
		});
		expect(clean.gains).toEqual([
			GRAPHIC_GAIN_DB.max,
			GRAPHIC_GAIN_DB.min,
			0,
			0,
			0,
		]);
		expect(
			sanitizeGraphic({ layoutId: "bogus", gains: [], enabled: false })
				.layoutId,
		).toBe("10");
	});

	it("converts gains to constant-Q peaking bands", () => {
		const bands = graphicToBands({
			...defaultGraphic("5"),
			gains: [3, 0, -2, 0, 0],
			enabled: true,
		});
		expect(bands).toHaveLength(5);
		expect(bands[0]).toMatchObject({
			type: "peaking",
			frequency: 60,
			gain: 3,
			q: GRAPHIC_Q,
			enabled: true,
		});
	});

	it("samples a response back to gains (documented interpolation)", () => {
		const graphic = sampleToGraphic("5", (f) => (f < 500 ? 6 : -6));
		expect(graphic.gains[0]).toBe(6);
		expect(graphic.gains[4]).toBe(-6);
		const clamped = sampleToGraphic("5", () => 99);
		expect(clamped.gains[0]).toBe(GRAPHIC_GAIN_DB.max);
	});
});
