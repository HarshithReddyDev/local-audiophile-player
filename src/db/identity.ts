/**
 * Stable track identity without hashing file contents.
 *
 * Identity = FNV-1a hash of (sourceId + normalized relative path). File size
 * and mtime are stored alongside for change detection (reparse when they
 * differ) but excluded from the id so replacing a file keeps its history,
 * favorites, and playlist membership. Renames/moves yield new ids; the old
 * record is marked missing during revalidation instead of silently dropped.
 *
 * Loose picked files have no source path: identity falls back to
 * name + size + mtime (same dedupe semantics as the Phase 1 session).
 */

/** 32-bit FNV-1a over UTF-16 code units; hex output. Fast (~GB/s). */
export function fnv1aHex(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** Deterministic track id for a file inside a library source. */
export function stableTrackId(sourceId: string, relativePath: string): string {
	return `trk-${fnv1aHex(`${sourceId}\n${normalizePath(relativePath)}`)}`;
}

/**
 * Deterministic id for a CUE virtual track: source + parent audio track +
 * cue track number. Re-importing the same sheet updates instead of
 * duplicating; virtual tracks never nest (enforced at resolve time).
 */
export function cueTrackId(
	sourceId: string,
	audioTrackId: string,
	cueTrackNumber: number,
): string {
	return `trk-${fnv1aHex(`cue\n${sourceId}\n${audioTrackId}\n${cueTrackNumber}`)}`;
}

/** Deterministic track id for loose picked files (no source). */
export function looseFileTrackId(
	name: string,
	size: number,
	lastModified: number,
): string {
	return `trk-${fnv1aHex(`file\n${name.toLowerCase()}\n${size}\n${lastModified}`)}`;
}

/**
 * Deterministic source id for a picked directory. Re-picking the same folder
 * reuses its identity (the service also matches by name), so re-imports
 * update records instead of duplicating the library. Two different folders
 * sharing a name merge under one source — documented, and relative paths
 * keep their tracks distinct via collision suffixes.
 */
export function directorySourceId(rootName: string): string {
	return `src-${fnv1aHex(`dir\n${rootName.toLowerCase()}`)}`;
}

/**
 * Resolve a hash collision (different identity, same id) by suffixing.
 * Collisions are astronomically unlikely with distinct inputs, but the
 * behavior is defined and tested rather than assumed.
 */
export function resolveCollision(baseId: string, taken: Set<string>): string {
	if (!taken.has(baseId)) return baseId;
	let n = 2;
	while (taken.has(`${baseId}-${n}`)) n += 1;
	return `${baseId}-${n}`;
}
