import { expect, test } from "@playwright/test";
import { openMyDevices, openTuning } from "./fixtures";

test.describe("device catalog", () => {
	test("browse, search, open device, create profile", async ({ page }) => {
		await page.goto("./");
		await page.getByRole("button", { name: "Devices", exact: true }).click();
		// Seed honesty: no bundled measurement database (one click away).
		await page.getByText("About this catalog").click();
		await expect(
			page.getByText(/No measurement database is bundled/),
		).toBeVisible();

		await page.getByLabel("Search devices").fill("HD600");
		await expect(
			page.getByRole("button", { name: "Sennheiser HD 600", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Sony WF-1000XM5", exact: true }),
		).toHaveCount(0);
		await page.getByLabel("Search devices").fill("");

		// Type filter narrows to TWS entries.
		await page.getByLabel("Filter by device type").selectOption("tws");
		await expect(
			page.getByRole("button", { name: "Sennheiser HD 600", exact: true }),
		).toHaveCount(0);
		await page.getByLabel("Filter by device type").selectOption("all");

		// Sort by manufacturer puts digit-leading makers first ("1Custom"
		// < "Apple" under localeCompare) — bulk catalog, frozen snapshot.
		await page.getByLabel("Sort devices").selectOption("manufacturer");
		const firstRow = page.locator("ul li").first();
		await expect(firstRow).toContainText("1Custom");

		// Device detail: bundled OPRA presets listed with creator credit.
		await page
			.getByRole("button", { name: "Sennheiser HD 600", exact: true })
			.click();
		await expect(
			page.getByText(/EQ by oratory1990 via OPRA/).first(),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Create profile", exact: true })
			.click();
		await expect(
			page.getByText(/Profile created for Sennheiser HD 600/),
		).toBeVisible();

		// Metadata-only devices keep the honest empty state.
		await page.getByLabel("Search devices").fill("QC Earbuds");
		await page
			.getByRole("button", {
				name: "Bose QuietComfort Earbuds II",
				exact: true,
			})
			.click();
		await expect(page.getByText(/No bundled EQ for this device/)).toBeVisible();

		// The copy is independent: it exists as a normal local profile.
		await openMyDevices(page);
		await expect(
			page.getByRole("button", { name: "Open profile Sennheiser HD 600" }),
		).toBeVisible({ timeout: 10_000 });
	});

	test("favorites, sources, and canonical copy-independence", async ({
		page,
	}) => {
		await page.goto("./");
		await page.getByRole("button", { name: "Devices", exact: true }).click();

		// Favorite a device, then filter to favorites only.
		await page
			.getByRole("button", {
				name: "Favorite device Sennheiser HD 600",
				exact: true,
			})
			.click();
		await page.getByLabel("Show favorite devices only").check();
		await expect(
			page.getByRole("button", { name: "Sony WF-1000XM5", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Sennheiser HD 600", exact: true }),
		).toBeVisible();

		// Sources tab states provenance plainly, including the data version.
		await page.getByRole("tab", { name: "Sources & licenses" }).click();
		await expect(page.getByText(/Catalog data version/)).toBeVisible();
		await expect(page.getByText(/Shure official site/)).toBeVisible();

		// Import the standalone tutorial preset, then mutate the user copy:
		// the canonical entry must be unchanged.
		await page.getByRole("tab", { name: "Catalog" }).click();
		await page.getByRole("button", { name: "Import EQ", exact: true }).click();
		await expect(
			page.getByText(/as your own preset and loaded it/),
		).toBeVisible();
		await page.getByRole("tab", { name: "My presets" }).click();
		await expect(
			page.getByText("Tutorial: gentle bass trim (example)"),
		).toBeVisible();
		await page.getByRole("button", { name: /Rename preset Tutorial/ }).click();
		await page
			.getByRole("textbox", { name: "Rename preset" })
			.fill("My edited copy");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByText("My edited copy")).toBeVisible();
		await page.getByRole("tab", { name: "Catalog" }).click();
		await expect(
			page.getByText("Tutorial: gentle bass trim (example)"),
		).toBeVisible();
	});

	test("preset library: save, rename, favorite, export/import roundtrip", async ({
		page,
	}) => {
		await page.goto("./");
		// Seed a user preset from the EQ section.
		await openTuning(page, "EQ");
		await page.getByLabel("Preset name").fill("E2E Preset");
		await page.getByLabel("Preset name").press("Enter");

		await page.getByRole("button", { name: "Devices", exact: true }).click();
		await page.getByRole("tab", { name: "My presets" }).click();
		await expect(page.getByText("E2E Preset")).toBeVisible();

		// Favorite + rename are user-owned operations.
		await page
			.getByRole("button", { name: "Favorite preset E2E Preset" })
			.click();
		await expect(
			page.getByRole("button", { name: "Favorite preset E2E Preset" }),
		).toHaveAttribute("aria-pressed", "true");
		await page
			.getByRole("button", { name: "Rename preset E2E Preset" })
			.click();
		await page
			.getByRole("textbox", { name: "Rename preset" })
			.fill("E2E Renamed");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByText("E2E Renamed")).toBeVisible();

		// Export downloads JSON; importing it back creates a second copy.
		const downloadEvent = page.waitForEvent("download");
		await page
			.getByRole("button", { name: "Export preset E2E Renamed" })
			.click();
		const download = await downloadEvent;
		const path = await download.path();
		expect(path).toBeTruthy();
		await page
			.locator('input[aria-label="Import preset file"]')
			.setInputFiles(path ?? "");
		await expect(page.getByText("E2E Renamed").nth(1)).toBeVisible({
			timeout: 10_000,
		});
	});

	test("OPRA presets show creator credit and import as user copies", async ({
		page,
	}) => {
		await page.goto("./");
		await page.getByRole("button", { name: "Devices", exact: true }).click();
		await page.getByLabel("Search devices").fill("HD 650");
		await page
			.getByRole("button", { name: "Sennheiser HD 650", exact: true })
			.click();
		// Creator + measurer credited on the row (OPRA attribution rule).
		await expect(
			page.getByText(/EQ by oratory1990 via OPRA/).first(),
		).toBeVisible();
		await expect(page.getByText(/CC BY-SA 4.0/).first()).toBeVisible();
		await page
			.getByRole("button", { name: "Import EQ", exact: true })
			.first()
			.click();
		await expect(
			page.getByText(/as your own preset and loaded it/),
		).toBeVisible();
		// ShareAlike notice is visible where the data lives, not buried.
		await page.getByRole("tab", { name: "Sources & licenses" }).click();
		await expect(page.getByText(/Attribution-ShareAlike 4.0/)).toBeVisible();
		await expect(page.getByText("Preset: OPRA")).toBeVisible();
	});
});
