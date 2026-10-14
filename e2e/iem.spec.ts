import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openMyDevices } from "./fixtures";

function measurementCsv(path: string): void {
	let rows = "frequency,raw\n";
	for (let i = 0; i < 40; i++) {
		const f = Math.round(20 * (20000 / 20) ** (i / 39) * 10) / 10;
		const g =
			Math.round((5 * Math.exp(-((Math.log10(f) - 3) ** 2 / 0.2)) - 2) * 100) /
			100;
		rows += `${f},${g}\n`;
	}
	writeFileSync(path, rows);
}

async function openIEM(page: Page): Promise<void> {
	await page.goto("./");
	await openMyDevices(page);
	await expect(page.getByRole("tab", { name: "Profiles" })).toBeVisible();
}

test.describe("IEM library", () => {
	test("import measurement, preview, save, reload persists", async ({
		page,
	}) => {
		const csv = join(tmpdir(), `iem-${Date.now()}.csv`);
		measurementCsv(csv);
		await openIEM(page);
		await page.getByRole("tab", { name: "Measurements" }).click();
		await page.locator('input[data-iem-file="measurement"]').setInputFiles(csv);
		await expect(
			page.getByRole("region", { name: "Import preview" }),
		).toBeVisible();
		await expect(page.getByText(/40 points/)).toBeVisible();
		await page.getByRole("button", { name: /Save( \d+ channels)?/ }).click();
		const rowName = csv.split("/").pop()?.replace(".csv", "") ?? "";
		await expect(page.getByText(rowName).first()).toBeVisible({
			timeout: 10_000,
		});

		await page.reload();
		await openMyDevices(page);
		await page.getByRole("tab", { name: "Measurements" }).click();
		// Generous budget: reload + restore under shared-runner load.
		await expect(page.getByText(rowName).first()).toBeVisible({
			timeout: 30_000,
		});
	});

	test("invalid measurement file shows a useful error", async ({ page }) => {
		const bad = join(tmpdir(), `bad-${Date.now()}.csv`);
		writeFileSync(bad, "hello\nworld\n");
		await openIEM(page);
		await page.getByRole("tab", { name: "Measurements" }).click();
		await page.locator('input[data-iem-file="measurement"]').setInputFiles(bad);
		const preview = page.getByRole("region", { name: "Import preview" });
		await expect(preview).toBeVisible();
		await expect(preview.getByRole("alert")).toContainText(
			/header|data rows|usable points|columns/,
		);
	});

	test("parametric target builds, saves, and profiles select it", async ({
		page,
	}) => {
		const csv = join(tmpdir(), `iemp-${Date.now()}.csv`);
		measurementCsv(csv);
		await openIEM(page);
		await page.getByRole("tab", { name: "Measurements" }).click();
		await page.locator('input[data-iem-file="measurement"]').setInputFiles(csv);
		await expect(
			page.getByRole("region", { name: "Import preview" }),
		).toBeVisible();
		await page.getByRole("button", { name: /Save( \d+ channels)?/ }).click();
		await expect(page.getByText(/40 points/).first()).toBeVisible({
			timeout: 10_000,
		});

		// Build a parametric target with bass lift.
		await page.getByRole("tab", { name: "Targets" }).click();
		await page.getByRole("slider", { name: "Bass shelf gain" }).fill("6");
		await page.getByPlaceholder("Target name").fill("Warm Tilt");
		await page
			.getByRole("button", { name: "Save target", exact: true })
			.click();
		await expect(page.getByText("Warm Tilt").first()).toBeVisible({
			timeout: 10_000,
		});

		// Create a profile on measurement + custom target, open it, select it.
		await page.getByRole("tab", { name: "Profiles" }).click();
		await page.getByPlaceholder("My IEM").fill("Test Buds");
		const options = page.locator("select");
		await options.nth(0).selectOption({ index: 1 });
		await options.nth(1).selectOption({ label: "Warm Tilt" });
		await page
			.getByRole("button", { name: "Create profile", exact: true })
			.click();
		await expect(page.getByRole("heading", { name: "Test Buds" })).toBeVisible({
			timeout: 10_000,
		});
		// Measurement + target + correction render.
		await expect(
			page.getByRole("figure", { name: /Frequency response curves/ }),
		).toBeVisible();
		await page.getByRole("button", { name: "Select", exact: true }).click();
		await expect(page.getByText("● Selected")).toBeVisible();

		// Reload: profile, selection, and target survive.
		await page.reload();
		await openMyDevices(page);
		await expect(page.getByText("● Selected").first()).toBeVisible({
			timeout: 10_000,
		});
		await page.getByRole("button", { name: "Settings" }).click();
		await expect(page.getByText("Test Buds").first()).toBeVisible();

		// Delete the profile.
		await openMyDevices(page);
		await page.getByRole("button", { name: /Open profile Test Buds/ }).click();
		await page
			.getByRole("button", { name: /Delete profile Test Buds/ })
			.click();
		await expect(page.getByText("Test Buds")).toHaveCount(0);
	});
});
