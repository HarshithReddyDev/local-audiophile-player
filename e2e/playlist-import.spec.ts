import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeSineWav } from "./fixtures";

function fixtureCsv(dir: string, name: string, rows: string): string {
	const path = join(dir, name);
	writeFileSync(path, rows);
	return path;
}

async function importLibrary(
	page: Page,
	names: string[],
	dir: string,
): Promise<void> {
	for (const [i, name] of names.entries()) {
		writeSineWav(join(dir, `${name}.wav`), 440 + i * 110, 2);
	}
	await page.goto("./");
	await page.setInputFiles(
		"input[type='file']",
		names.map((n) => join(dir, `${n}.wav`)),
	);
	await expect(
		page.getByRole("button", { name: new RegExp(`Play ${names[0]}`) }).first(),
	).toBeVisible({ timeout: 15_000 });
}

test.describe("playlist import", () => {
	test("import CSV, review matches, create playlist, re-import", async ({
		page,
	}) => {
		const dir = tmpdir();
		const stamp = Date.now();
		await importLibrary(page, ["pl-blue-sky", "pl-red-sky"], dir);
		const csv = fixtureCsv(
			dir,
			`pl-fixture-${stamp}.csv`,
			"title,artist,album\npl-blue-sky,Unknown artist,Unknown album\npl-red-sky,Unknown artist\nNo Such Song,Nobody Ever\n",
		);

		await page.getByRole("button", { name: "Playlists" }).first().click();
		await page.getByRole("button", { name: "Import playlist" }).click();
		await page
			.locator('input[aria-label="Choose playlist file"]')
			.setInputFiles(csv);

		// Honest counts: 1 auto-matched, 1 to review, 1 unmatched.
		await expect(page.getByText(/Matched: 1/)).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText(/Needs review: 1/)).toBeVisible();
		await expect(page.getByText(/Unmatched: 1/)).toBeVisible();

		// Resolve the ambiguous row via its candidate dropdown.
		await page
			.getByLabel("Choose match for pl-red-sky")
			.selectOption({ label: "pl-red-sky — Unknown artist" });
		await expect(page.getByText(/Resolved by you: 1/)).toBeVisible();

		// Unmatched track is kept, never faked: create with 2 linked tracks.
		await page.getByRole("button", { name: "Create local playlist" }).click();
		await expect(page.getByText(/Created "pl-fixture/)).toBeVisible({
			timeout: 10_000,
		});
		await page.getByRole("button", { name: "Close" }).click();
		await page
			.getByRole("button", {
				name: new RegExp(`Open playlist pl-fixture-${stamp}`),
			})
			.click();
		await expect(page.getByText("Imported from file")).toBeVisible();
		const items = page.locator("li", { hasText: "pl-" });
		await expect(items.first()).toBeVisible();

		// Re-import offers update/copy instead of silently duplicating.
		await page.getByRole("button", { name: "← Playlists" }).click();
		await page.getByRole("button", { name: "Import playlist" }).click();
		await page
			.locator('input[aria-label="Choose playlist file"]')
			.setInputFiles(csv);
		await expect(page.getByText(/was imported before/)).toBeVisible({
			timeout: 10_000,
		});
		await page.getByRole("button", { name: "Create copy" }).click();
		await page.getByRole("button", { name: "Create local playlist" }).click();
		await expect(page.getByText(/Created "pl-fixture/)).toBeVisible({
			timeout: 10_000,
		});
	});

	test("malformed playlist file fails loudly without side effects", async ({
		page,
	}) => {
		await page.goto("./");
		await page.getByRole("button", { name: "Playlists" }).first().click();
		await page.getByRole("button", { name: "Import playlist" }).click();
		const bad = fixtureCsv(tmpdir(), `bad-${Date.now()}.csv`, "foo,bar\n1,2\n");
		await page
			.locator('input[aria-label="Choose playlist file"]')
			.setInputFiles(bad);
		await expect(
			page.getByText(/needs at least a title or artist column/),
		).toBeVisible({ timeout: 10_000 });
		// No review panel, no playlist created.
		await expect(page.getByText(/Matched:/)).toHaveCount(0);
		await expect(page.getByRole("button", { name: "← Playlists" })).toHaveCount(
			0,
		);
	});
});
