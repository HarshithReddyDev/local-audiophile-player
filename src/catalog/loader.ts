/**
 * Async loader for the full catalog. The generated bulk layer is tens of
 * megabytes of static data: it ships as a separate lazily-loaded chunk so
 * listeners who never open Devices never download or parse it. The seed
 * (hand-reviewed records) stays in the main bundle for instant paint.
 */

import { SEED_CATALOG } from "./seed";
import type { DeviceCatalog } from "./types";

let cached: DeviceCatalog | null = null;

/** Load seed + generated bulk layer (memoized). Never hits the network. */
export async function loadFullCatalog(): Promise<{
	catalog: DeviceCatalog;
	offline: boolean;
}> {
	if (cached) return { catalog: cached, offline: false };
	try {
		const { GENERATED_CATALOG } = await import("./generated");
		cached = combine(SEED_CATALOG, GENERATED_CATALOG);
		return { catalog: cached, offline: false };
	} catch {
		// Chunk unavailable (e.g. offline first visit to Devices): the
		// hand-reviewed seed still browses fully offline.
		return { catalog: SEED_CATALOG, offline: true };
	}
}

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

/** Test seam: reset the memoization between tests. */
export function __resetCatalogCache(): void {
	cached = null;
}

/**
 * Already-loaded catalog, if any — for surfaces (e.g. command palette)
 * that must never force the bulk chunk to load.
 */
export function peekCachedCatalog(): DeviceCatalog | null {
	return cached;
}
