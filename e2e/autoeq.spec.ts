import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openMyDevices, openTuning } from "./fixtures";

function measurementCsv(path: string): void {
	let rows = "frequency,raw\n";
	for (let i = 0; i < 40; i++) {
		const f = Math.round(20 * (20000 / 20) ** (i / 39) * 10) / 10;
		const g =
			Math.round((6 * Math.exp(-((Math.log10(f) - 3) ** 2) / 0.15) - 2) * 100) /
			100;
		rows += `${f},${g}\n`;
	}
	writeFileSync(path, rows);
}

async function setupProfile(page: Page, stamp: string): Promise<void> {
	const csv = join(tmpdir(), `autoeq-${stamp}.csv`);
	measurementCsv(csv);
	await page.goto("./");
	await openMyDevices(page);
	await page.getByRole("tab", { name: "Measurements" }).click();
	await page.locator('input[data-iem-file="measurement"]').setInputFiles(csv);
	await expect(
		page.getByRole("region", { name: "Import preview" }),
	).toBeVisible();
	await page.getByRole("button", { name: /Save( \d+ channels)?/ }).click();
	await expect(page.getByText(/40 points/).first()).toBeVisible({
		timeout: 10_000,
	});
	await page.getByRole("tab", { name: "Profiles" }).click();
	await page.getByPlaceholder("My IEM").fill(`AutoEQ Buds ${stamp}`);
	const selects = page.locator("select");
	await selects.nth(0).selectOption({ index: 1 });
	await selects.nth(1).selectOption({ label: "Flat (0 dB)" });
	await page
		.getByRole("button", { name: "Create profile", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: `AutoEQ Buds ${stamp}` }),
	).toBeVisible({
		timeout: 10_000,
	});
}

test.describe("AutoEQ workflow", () => {
	test("generate, preview, apply, reload persists", async ({ page }) => {
		const stamp = String(Date.now());
		await setupProfile(page, stamp);

		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({ timeout: 30_000 });
		// Preview: metrics, filter table, predicted graph — before any apply.
		await expect(
			page.getByRole("table", { name: "Generated filters" }),
		).toBeVisible();
		const bandRows = await page.locator("table tbody tr").count();
		expect(bandRows).toBeGreaterThan(0);
		expect(bandRows).toBeLessThanOrEqual(8);

		await page
			.getByRole("button", { name: "Apply to EQ", exact: true })
			.click();
		await expect(page.getByText(/residual RMS/).first()).toBeVisible({
			timeout: 10_000,
		});

		// §39 loop closure: the persisted live EQ carries the generated bands,
		// so the DSP engine consumes exactly what the preview predicted.
		const stored = await page.evaluate(() => {
			const raw = localStorage.getItem("iem-player.eq");
			return raw
				? (JSON.parse(raw) as {
						profile: { bands: unknown[]; preamp: number; enabled: boolean };
					})
				: null;
		});
		expect(stored?.profile.bands.length).toBe(bandRows);
		expect(stored?.profile.enabled).toBe(true);

		// Applied EQ is ordinary editable EQ: bands appear in the EQ section.
		await openTuning(page, "EQ");
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).toBeChecked();
		const eqBands = await page.locator("li", { hasText: "Remove" }).count();
		expect(eqBands).toBe(bandRows);

		// Reload: profile generation record and live EQ both survive.
		await page.reload();
		await openMyDevices(page);
		await page
			.getByRole("button", { name: /Open profile AutoEQ Buds/ })
			.click();
		await expect(page.getByText(/residual RMS/).first()).toBeVisible({
			timeout: 10_000,
		});
		await openTuning(page, "EQ");
		expect(await page.locator("li", { hasText: "Remove" }).count()).toBe(
			bandRows,
		);
	});

	test("discard returns to idle without touching EQ", async ({ page }) => {
		const stamp = String(Date.now());
		await setupProfile(page, stamp);
		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({ timeout: 30_000 });
		await page.getByRole("button", { name: "Discard", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Generate EQ", exact: true }),
		).toBeVisible();
		// Live EQ untouched (still disabled, no bands).
		await openTuning(page, "EQ");
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).not.toBeChecked();
	});

	test("generate requires measurement and target", async ({ page }) => {
		await page.goto("./");
		await openMyDevices(page);
		await page.getByPlaceholder("My IEM").fill("Empty Profile");
		await page
			.getByRole("button", { name: "Create profile", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Empty Profile" }),
		).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			page.getByRole("button", { name: "Generate EQ", exact: true }),
		).toBeDisabled();
		await expect(
			page.getByText("Select a measurement and target above first."),
		).toBeVisible();
	});

	test("fit-range preset and HF treatment are honored and reported", async ({
		page,
	}) => {
		const stamp = String(Date.now());
		await setupProfile(page, stamp);

		// Phase 8A controls: preset radios + HF treatment with explanation.
		await expect(page.getByRole("radio", { name: "Full" })).toBeVisible();
		await expect(
			page.getByRole("radio", { name: "20 Hz – 10 kHz" }),
		).toBeVisible();
		await expect(
			page.getByRole("radio", { name: "20 Hz – 8 kHz" }),
		).toBeVisible();
		await expect(
			page.getByText(/less reliable/, { exact: false }),
		).toBeVisible();

		// Narrow preset → effective range is reported, clamped to the preset.
		await page.getByRole("radio", { name: "20 Hz – 8 kHz" }).check();
		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/20 Hz–8\.0 kHz/)).toBeVisible();

		// Discard → switch HF treatment → regenerate (§19 sequencing: only the
		// newest generation updates the UI).
		await page.getByRole("button", { name: "Discard", exact: true }).click();
		await page
			.getByRole("combobox", { name: "High-frequency treatment" })
			.selectOption("exclude");
		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/HF ignored above 10 kHz/)).toBeVisible();
		await page.getByRole("button", { name: "Discard", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Generate EQ", exact: true }),
		).toBeVisible();
	});

	test("smoothing preset shows raw and smoothed curves, applies cleanly", async ({
		page,
	}) => {
		const stamp = String(Date.now());
		await setupProfile(page, stamp);

		// Phase 8D controls: Off/Light/Moderate with an honest explanation.
		await expect(page.getByRole("radio", { name: "Off" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "Light" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "Moderate" })).toBeVisible();
		await expect(
			page.getByText(/never modified/, { exact: false }),
		).toBeVisible();

		await page.getByRole("radio", { name: "Light" }).check();
		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({ timeout: 30_000 });
		// Both the raw measurement and the derived fitting curve are shown;
		// the raw curve is never replaced.
		await expect(page.getByText("Measurement (raw)")).toBeVisible();
		await expect(page.getByText("Fitting curve (smoothed)")).toBeVisible();
		await expect(page.getByText(/Smoothing: Light/)).toBeVisible();

		await page
			.getByRole("button", { name: "Apply to EQ", exact: true })
			.click();
		await expect(page.getByText(/residual RMS/).first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test("A/B compare toggles live EQ with level estimate", async ({ page }) => {
		const stamp = String(Date.now());
		await setupProfile(page, stamp);
		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({ timeout: 30_000 });
		await page
			.getByRole("button", { name: "Apply to EQ", exact: true })
			.click();
		await expect(page.getByText(/residual RMS/).first()).toBeVisible({
			timeout: 10_000,
		});
		const compare = page.getByRole("button", { name: /Bypass EQ|Enable EQ/ });
		await expect(compare).toBeVisible();
		await expect(page.getByText(/Estimated level vs bypass/)).toBeVisible();
		await compare.click();
		await expect(
			page.getByRole("button", { name: "Enable EQ (hear correction)" }),
		).toBeVisible();
		await compare.click();
		await expect(
			page.getByRole("button", { name: "Bypass EQ (hear original)" }),
		).toBeVisible();
	});
});
