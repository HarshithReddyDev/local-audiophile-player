import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { writeSineWav } from "./fixtures";

function wavPaths(stamp: number | string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => {
		const path = join(tmpdir(), `adv-${stamp}-${i}.wav`);
		writeSineWav(path, 440 + i * 110, 2);
		return path;
	});
}

async function importFiles(page: Page, paths: string[]): Promise<void> {
	await page.goto("./");
	await page.setInputFiles("input[type='file']", paths);
	await expect(
		page.getByRole("button", { name: /Play adv-/ }).first(),
	).toBeVisible({ timeout: 15_000 });
}

test.describe("advanced transport", () => {
	test("next/previous walk the queue", async ({ page }) => {
		const paths = wavPaths(`np-${Date.now()}`, 2);
		await importFiles(page, paths);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		await page.getByRole("button", { name: "Next track", exact: true }).click();
		await expect(status).toContainText("adv-", { timeout: 10_000 });
		const second = await status.innerText();
		await page
			.getByRole("button", { name: "Previous track", exact: true })
			.click();
		await expect(status).not.toContainText(second.split(",")[0] ?? "###", {
			timeout: 10_000,
		});
	});

	test("shuffle and repeat persist across reload", async ({ page }) => {
		page.on("console", (m) =>
			console.log(`DIAG ${m.type()}: ${m.text().slice(0, 140)}`),
		);
		page.on("pageerror", (e) =>
			console.log(`DIAG PAGEERROR: ${String(e).slice(0, 200)}`),
		);
		await importFiles(page, wavPaths(`sr-${Date.now()}`, 2));
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		await page.getByRole("button", { name: "Shuffle", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Shuffle", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await page.getByRole("button", { name: /Repeat \(off\)/ }).click();
		await expect(
			page.getByRole("button", { name: /Repeat all/ }),
		).toBeVisible();

		await page.reload();
		// Generous budget: reload + restore under shared-runner load.
		await expect(
			page.getByRole("button", { name: "Shuffle", exact: true }),
		).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
		await expect(
			page.getByRole("button", { name: /Repeat all/ }),
		).toBeVisible();
		// Restored queue waits for play instead of auto-starting.
		await expect(status).toContainText("ready", { timeout: 10_000 });
	});

	test("playback rate changes and persists", async ({ page }) => {
		await importFiles(page, wavPaths(`rt-${Date.now()}`, 1));
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{
				timeout: 15_000,
			},
		);
		await page.getByRole("button", { name: /Open now playing/ }).click();
		const speed = page.getByLabel("Speed");
		await speed.selectOption("1.5");
		await page.reload();
		await page.getByRole("button", { name: /Open now playing/ }).click();
		await expect(page.getByLabel("Speed")).toHaveValue("1.5");
	});

	test("playlist plays, shuffles, and queues", async ({ page }) => {
		await importFiles(page, wavPaths(`pl-${Date.now()}`, 2));
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{
				timeout: 15_000,
			},
		);
		await page.getByRole("button", { name: "Playlists" }).click();
		await page
			.getByPlaceholder("New playlist from current queue…")
			.fill("Adv Mix");
		await page.getByRole("button", { name: "Save queue as playlist" }).click();
		await expect(page.getByRole("heading", { name: "Adv Mix" })).toBeVisible({
			timeout: 10_000,
		});
		await page
			.getByRole("button", { name: /Add playlist .* to queue/ })
			.click();
		await page.getByRole("button", { name: /Open now playing/ }).click();
		await page
			.getByRole("region", { name: "Now playing" })
			.getByRole("button", { name: "Queue", exact: true })
			.click();
		const dialog = page.getByRole("dialog", { name: "Play queue" });
		await expect(dialog).toBeVisible();
		// 2 original + 2 appended from the playlist.
		await expect(dialog.locator("li")).toHaveCount(4);
	});

	test("rapid track selections leave the last one authoritative", async ({
		page,
	}) => {
		const paths = wavPaths(`rc-${Date.now()}`, 4);
		await importFiles(page, paths);
		const rows = page.getByRole("button", { name: /Play adv-rc-/ });
		await expect(rows.first()).toBeVisible({ timeout: 15_000 });
		const count = await rows.count();
		const lastName =
			(await rows.nth(count - 1).getAttribute("aria-label")) ?? "";
		const lastTitle = lastName.replace(/^Play /, "").split(" by ")[0] ?? "";
		for (let i = 0; i < count; i++) {
			await rows.nth(i).click({ noWaitAfter: true });
		}
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });
		// No error banner from the superseded loads.
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(status).toContainText(lastTitle, { timeout: 10_000 });
	});

	test("media session metadata is published", async ({ page }) => {
		await importFiles(page, wavPaths(`ms-${Date.now()}`, 1));
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{
				timeout: 15_000,
			},
		);
		const title = await page.evaluate(
			() => navigator.mediaSession?.metadata?.title ?? null,
		);
		expect(title).toMatch(/adv-ms-/);
	});
});
