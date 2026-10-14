/**
 * Incremental scan diffing. Pure function over stable ids + file stats:
 * the scanner enumerates, this decides what changed, the service persists.
 */

export interface Fingerprint {
	id: string;
	size: number;
	lastModified: number;
}

export interface ScanDiff {
	/** Scanned files with no existing record — parse and insert. */
	added: Fingerprint[];
	/** Known ids whose bytes changed — reparse metadata, keep history. */
	changed: Fingerprint[];
	/** Known ids with identical stats — skip entirely. */
	unchanged: Fingerprint[];
	/** Existing ids absent from the scan — mark missing, never auto-delete. */
	removed: string[];
}

export function diffScan(
	scanned: Fingerprint[],
	existing: Map<string, { size: number; lastModified: number }>,
): ScanDiff {
	const diff: ScanDiff = { added: [], changed: [], unchanged: [], removed: [] };
	const seen = new Set<string>();
	for (const file of scanned) {
		seen.add(file.id);
		const known = existing.get(file.id);
		if (!known) diff.added.push(file);
		else if (
			known.size !== file.size ||
			known.lastModified !== file.lastModified
		)
			diff.changed.push(file);
		else diff.unchanged.push(file);
	}
	for (const id of existing.keys()) {
		if (!seen.has(id)) diff.removed.push(id);
	}
	return diff;
}
