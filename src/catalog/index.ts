/**
 * Full catalog = hand-reviewed seed + generated bulk layer, combined
 * deterministically. The UI reads only this: one sorted, validated shape
 * regardless of how many ingestion batches produced it.
 */

import { GENERATED_CATALOG } from "./generated";
import { buildCatalogData } from "./ingest";
import { SEED_CATALOG } from "./seed";
import type { DeviceCatalog } from "./types";

function combine(base: DeviceCatalog, extra: DeviceCatalog): DeviceCatalog {
	return {
		version: base.version,
		devices: [...base.devices, ...extra.devices].sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		presets: [...base.presets, ...extra.presets].sort((a, b) =>
			a.id.localeCompare(b.id),
		),
	};
}

/** The catalog the app browses. Validated by generation.test.ts. */
export const FULL_CATALOG: DeviceCatalog = combine(
	SEED_CATALOG,
	GENERATED_CATALOG,
);

/** Re-run the merge through the full pipeline (reports + problems). */
export function fullCatalogCheck() {
	return buildCatalogData(SEED_CATALOG, [
		{
			devices: GENERATED_CATALOG.devices,
			presets: GENERATED_CATALOG.presets,
			rejected: [],
			duplicates: [],
			gate: { allowed: true, reasons: [], conditions: [] },
		},
	]);
}
