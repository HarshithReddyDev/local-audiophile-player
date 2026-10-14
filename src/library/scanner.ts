/**
 * LibraryScanner — imports local audio files into in-memory tracks.
 *
 * Local-first guarantees: files are read with Blob/tag APIs only. Nothing is
 * uploaded, copied to OPFS, or persisted yet; persistence arrives in Phase 2
 * behind this same interface (scanDirectory/scanFiles/refresh).
 */

import { parseLrc } from "../dsp/lyrics";
import type { NewTrackInput } from "../state/library-store";
import type { ArtworkPayload } from "../types/library";
import { parseFileMetadata } from "./metadata";

/** Local alias so scanner logs read naturally. */
const parseLrcText = parseLrc;

const SUPPORTED_EXTENSIONS = new Set([
	"mp3",
	"wav",
	"flac",
	"ogg",
	"oga",
	"opus",
	"m4a",
	"aac",
	"webm",
	"mp4",
]);

/** accept attribute for file inputs. */
export const AUDIO_ACCEPT =
	"audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.webm";

export function supportsDirectoryPicker(): boolean {
	return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * Opens the native directory picker. Returns null when the user cancels.
 * Throws for real failures. TS DOM lib omits the API, hence the structural cast.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
	const w = window as unknown as {
		showDirectoryPicker(options?: {
			mode?: string;
		}): Promise<FileSystemDirectoryHandle>;
	};
	try {
		return await w.showDirectoryPicker({ mode: "read" });
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			return null;
		throw error;
	}
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedFile(file: File): boolean {
	if (file.type.startsWith("audio/")) return true;
	return SUPPORTED_EXTENSIONS.has(extensionOf(file.name));
}

export interface ScanProgress {
	processed: number;
	total: number;
}

function yieldToUI(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One scanned file with its identity-relevant path. relativePath is the path
 * inside a picked directory, or the bare file name for loose picked files.
 */
export interface ScannedFile extends NewTrackInput {
	relativePath: string;
	artwork: ArtworkPayload | null;
}

/**
 * Parse files sequentially, yielding to the UI every few files so large
 * imports never block interaction. Unsupported files are skipped silently.
 */
export async function scanFiles(
	files: Iterable<File>,
	onProgress?: (progress: ScanProgress) => void,
): Promise<ScannedFile[]> {
	const list = [...files].filter(isSupportedFile);
	const total = list.length;
	const out: ScannedFile[] = [];
	let processed = 0;
	for (const file of list) {
		const { track, artwork } = await parseFileMetadata(file);
		out.push({ track, file, relativePath: file.name, artwork });
		processed += 1;
		if (processed % 4 === 0) await yieldToUI();
		onProgress?.({ processed, total });
	}
	return out;
}

/** TS DOM lib omits the async-iteration methods, so describe them structurally. */
interface IterableDirectory {
	values(): AsyncIterableIterator<FileSystemHandle>;
}

interface CollectedFile {
	file: File;
	relativePath: string;
}

/** Basename stem (lowercased) for .lrc sidecar matching. */
function stemOf(relativePath: string): string {
	const base = relativePath.split("/").pop() ?? relativePath;
	const dot = base.lastIndexOf(".");
	return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/** Directory key for sidecar matching ("" for the picked root). */
function dirOf(relativePath: string): string {
	const slash = relativePath.lastIndexOf("/");
	return slash >= 0 ? relativePath.slice(0, slash) : "";
}

async function collectFromDirectory(
	dir: FileSystemDirectoryHandle,
	out: CollectedFile[],
	prefix: string = "",
): Promise<void> {
	const iterable = dir as unknown as IterableDirectory;
	for await (const entry of iterable.values()) {
		const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.kind === "file") {
			const fileHandle = entry as FileSystemFileHandle;
			try {
				const file = await fileHandle.getFile();
				if (isSupportedFile(file)) out.push({ file, relativePath });
			} catch {
				// Unreadable entries are skipped; the import continues.
			}
		} else if (entry.kind === "directory") {
			await collectFromDirectory(
				entry as FileSystemDirectoryHandle,
				out,
				relativePath,
			);
		}
	}
}

/** Read tiny .lrc siblings (≤1 MB) keyed by directory + stem. */
async function collectLrcSidecars(
	dir: FileSystemDirectoryHandle,
	out: Map<string, string>,
	prefix: string = "",
): Promise<void> {
	const iterable = dir as unknown as IterableDirectory;
	for await (const entry of iterable.values()) {
		const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".lrc")) {
			try {
				const file = await (entry as FileSystemFileHandle).getFile();
				if (file.size > 1024 * 1024) continue;
				out.set(
					`${dirOf(relativePath)}\n${stemOf(relativePath)}`,
					await file.text(),
				);
			} catch {
				// Unreadable sidecars are skipped; the import continues.
			}
		} else if (entry.kind === "directory") {
			await collectLrcSidecars(
				entry as FileSystemDirectoryHandle,
				out,
				relativePath,
			);
		}
	}
}

/** Recursively enumerate supported files. Caller shows the picker first. */
export async function scanDirectory(
	dir: FileSystemDirectoryHandle,
	onProgress?: (progress: ScanProgress) => void,
): Promise<ScannedFile[]> {
	const collected: CollectedFile[] = [];
	await collectFromDirectory(dir, collected);
	const sidecars = new Map<string, string>();
	await collectLrcSidecars(dir, sidecars);
	const supported = collected.filter(({ file }) => isSupportedFile(file));
	const total = supported.length;
	const out: ScannedFile[] = [];
	let processed = 0;
	for (const { file, relativePath } of supported) {
		const { track, artwork } = await parseFileMetadata(file);
		// Prefer embedded lyrics; fall back to an .lrc sidecar match.
		if (!track.lyrics) {
			const sidecar = sidecars.get(
				`${dirOf(relativePath)}\n${stemOf(relativePath)}`,
			);
			if (sidecar) {
				const parsed = parseLrcText(sidecar);
				if (parsed) {
					track.lyrics = {
						plain: parsed.synced
							? null
							: parsed.lines.map((l) => l.text).join("\n"),
						synced: parsed.synced ? parsed.lines : null,
						source: "lrc",
					};
				}
			}
		}
		out.push({ track, file, relativePath, artwork });
		processed += 1;
		if (processed % 4 === 0) await yieldToUI();
		onProgress?.({ processed, total });
	}
	return out;
}
