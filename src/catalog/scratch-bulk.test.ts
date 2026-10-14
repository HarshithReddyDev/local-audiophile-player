import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeIdentity } from "./ingest";
import { ingestOpraSnapshot } from "./opra-bulk";
import { SEED_CATALOG } from "./seed";

const SNAP = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"scripts",
	"catalog",
	"opra-snapshot",
	"database_v1.jsonl",
);

describe("scratch opra bulk", () => {
	it("ingests the frozen snapshot", () => {
		const text = readFileSync(SNAP, "utf-8");
		const seedMap = new Map(
			SEED_CATALOG.devices.map((d) => [
				normalizeIdentity(d.manufacturer, d.model),
				d.id,
			]),
		);
		const t0 = performance.now();
		const out = ingestOpraSnapshot(text, seedMap);
		const ms = performance.now() - t0;
		console.log(`BULK ms=${ms.toFixed(0)}`, JSON.stringify(out.stats));
		console.log(`BULK review notes: ${out.review.length}`);
		console.log(
			`BULK devices=${out.devices.length} presets=${out.presets.length}`,
		);
		const bytes =
			JSON.stringify(out.devices).length + JSON.stringify(out.presets).length;
		console.log(`BULK json bytes=${bytes}`);
		expect(true).toBe(true);
	}, 300000);
});
