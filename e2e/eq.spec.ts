import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openTuning, writeSineWav } from "./fixtures";

async function importOne(
	page: Page,
	stamp: string,
	seconds = 4,
): Promise<void> {
	const path = join(tmpdir(), `eq-${stamp}.wav`);
	writeSineWav(path, 440, seconds);
	await page.goto("./");
	await page.setInputFiles("input[type='file']", [path]);
	await expect(
		page.getByRole("button", { name: /Play eq-/ }).first(),
	).toBeVisible({
		timeout: 15_000,
	});
}

async function elapsed(page: Page): Promise<string> {
	// Read the seek slider's accessible value (footer also shows a preamp
	// readout in tabular numerals, so a bare class query is ambiguous).
	const text = await page
		.getByRole("slider", { name: "Seek" })
		.getAttribute("aria-valuetext");
	return (text ?? "").split(" of ")[0] ?? "";
}

test.describe("EQ flows", () => {
	test("open, enable, add band, graph updates, bypass keeps playing", async ({
		page,
	}) => {
		await importOne(page, `flow-${Date.now()}`, 20);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		await openTuning(page, "EQ");
		await expect(
			page.getByRole("figure", { name: /frequency response/ }),
		).toBeVisible();

		const before = await page
			.getByRole("figure", { name: /frequency response/ })
			.locator("path")
			.first()
			.getAttribute("d");

		await page.getByRole("checkbox", { name: "Enable parametric EQ" }).check();
		await page.getByRole("button", { name: "Add band", exact: true }).click();
		await expect(page.getByText("#1", { exact: true })).toBeVisible();

		// Boost the band hard: the total curve must visibly change.
		const gainInput = page.getByRole("spinbutton", {
			name: "Gain value in dB",
		});
		await gainInput.fill("12");
		const after = await page
			.getByRole("figure", { name: /frequency response/ })
			.locator("path")
			.first()
			.getAttribute("d");
		expect(after).not.toBe(before);

		// §27 regression: the full chain (deck → gain → mix → DSP → master)
		// must be connected — the clock advances with DSP engaged and hot.
		await page.waitForTimeout(1500);
		const t1 = await elapsed(page);
		await page.waitForTimeout(1500);
		const t2 = await elapsed(page);
		expect(t1).not.toBe("0:00");
		expect(t2).not.toBe(t1);

		// Bypass mid-play: audio continues, graph stays honest.
		await page
			.getByRole("checkbox", { name: "Enable parametric EQ" })
			.uncheck();
		await page.waitForTimeout(1500);
		const t3 = await elapsed(page);
		expect(t3).not.toBe(t2);
		await expect(status).toContainText("Playing");
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	test("preset saves, reloads, and survives", async ({ page }) => {
		await importOne(page, `preset-${Date.now()}`);
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{
				timeout: 15_000,
			},
		);
		await openTuning(page, "EQ");
		await page.getByRole("checkbox", { name: "Enable parametric EQ" }).check();
		await page.getByRole("button", { name: "Add band", exact: true }).click();
		await page.getByPlaceholder("Save current EQ as…").fill("Bass Lift");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(
			page.getByRole("button", { name: /Load preset Bass Lift/ }),
		).toBeVisible();

		await page.reload();
		await openTuning(page, "EQ");
		await expect(
			page.getByRole("button", { name: /Load preset Bass Lift/ }),
		).toBeVisible({
			timeout: 10_000,
		});
		// EQ enablement persisted too.
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).toBeChecked();
		await expect(page.getByText("#1", { exact: true })).toBeVisible();
	});

	test("preamp compensation hint appears for hot profiles", async ({
		page,
	}) => {
		await importOne(page, `hot-${Date.now()}`);
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{
				timeout: 15_000,
			},
		);
		await openTuning(page, "EQ");
		await page.getByRole("checkbox", { name: "Enable parametric EQ" }).check();
		await page.getByRole("button", { name: "Add band", exact: true }).click();
		await page.getByRole("spinbutton", { name: "Gain value in dB" }).fill("12");
		await expect(page.getByText(/Suggested preamp/)).toBeVisible();
		await page.getByRole("button", { name: "Apply", exact: true }).click();
		await expect(page.getByText(/Suggested preamp/)).toHaveCount(0);
	});
});
