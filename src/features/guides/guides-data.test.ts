import { describe, expect, it } from "vitest";
import { GUIDE_CATEGORIES, GUIDES, guideById } from "./guides-data";

describe("in-app guides", () => {
	it("covers every required category", () => {
		const covered = new Set(GUIDES.map((g) => g.category));
		for (const category of GUIDE_CATEGORIES) {
			expect(covered.has(category), category).toBe(true);
		}
	});

	it("has unique ids and non-empty structured sections", () => {
		const ids = GUIDES.map((g) => g.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const guide of GUIDES) {
			expect(guide.title.length, guide.id).toBeGreaterThan(0);
			expect(guide.summary.length, guide.id).toBeGreaterThan(0);
			expect(guide.sections.length, guide.id).toBeGreaterThan(0);
			for (const section of guide.sections) {
				expect(section.heading.length, guide.id).toBeGreaterThan(0);
				const hasContent =
					(section.paragraphs?.length ?? 0) > 0 ||
					(section.bullets?.length ?? 0) > 0 ||
					(section.table?.rows.length ?? 0) > 0;
				expect(hasContent, `${guide.id}/${section.heading}`).toBe(true);
			}
		}
	});

	it("documents the real signal path (reverb parallel, limiter last)", () => {
		const dsp = guideById("dsp");
		expect(dsp).not.toBeNull();
		const path = dsp?.sections.find((s) =>
			s.heading.toLowerCase().includes("signal path"),
		);
		expect(path).toBeDefined();
		const text = (path?.paragraphs ?? []).join(" ");
		expect(text).toMatch(/parallel/);
		expect(text).toMatch(/limiter/);
	});

	it("never claims true-peak limiting, SPL calibration, or bit-perfect", () => {
		for (const guide of GUIDES) {
			const text = JSON.stringify(guide);
			expect(text, `${guide.id} claims bit-perfect`).not.toMatch(
				/bit-?perfect/i,
			);
			expect(text, `${guide.id} claims SPL calibration`).not.toMatch(
				/SPL-calibrated/i,
			);
			expect(text, `${guide.id} claims ISO certification`).not.toMatch(
				/ISO-certified/i,
			);
			// "true-peak" may only appear inside an explicit disclaimer.
			const lower = text.toLowerCase();
			let from = 0;
			for (;;) {
				const at = lower.indexOf("true-peak", from);
				if (at === -1) break;
				const windowText = lower.slice(Math.max(0, at - 80), at + 80);
				expect(
					/not\b|no oversampling|never|sample-peak/.test(windowText),
					`${guide.id} unqualified true-peak claim`,
				).toBe(true);
				from = at + 1;
			}
		}
	});

	it("limiter guide calls it peak safety limiter, not true peak", () => {
		const dsp = guideById("dsp");
		const limiter = dsp?.sections.find((s) =>
			s.heading.toLowerCase().includes("limiter"),
		);
		expect(limiter).toBeDefined();
		const text = [
			...(limiter?.paragraphs ?? []),
			...(limiter?.bullets ?? []),
		].join(" ");
		expect(text).toMatch(/NOT a true-peak limiter/);
		expect(text).toMatch(/peak safety limiter/i);
	});

	it("looks up by id", () => {
		expect(guideById("getting-started")?.title).toBe("Getting Started");
		expect(guideById("troubleshooting")?.category).toBe("Troubleshooting");
		expect(guideById("nope")).toBeNull();
	});
});
