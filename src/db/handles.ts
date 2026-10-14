/**
 * FileSystemHandle permission model. Grants never survive unconditionally:
 * browsers may require re-request, users may revoke, folders may vanish.
 * Every state below maps to explicit UI (see SourceStatus in types).
 */
import { supportsDirectoryPicker } from "../library/scanner";

export type HandlePermission = "granted" | "denied" | "prompt";

interface QueryableHandle {
	queryPermission?(options?: { mode?: string }): Promise<HandlePermission>;
	requestPermission?(options?: { mode?: string }): Promise<HandlePermission>;
}

/**
 * Current permission without prompting. "prompt" means a user gesture is
 * required before files can be read again.
 */
export async function queryHandlePermission(
	handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): Promise<HandlePermission> {
	const h = handle as unknown as QueryableHandle;
	if (typeof h.queryPermission !== "function") {
		// API present but permission query missing: assume a prompt is needed.
		return "prompt";
	}
	try {
		return await h.queryPermission({ mode: "read" });
	} catch {
		return "prompt";
	}
}

/**
 * Must be called from a user gesture. Resolves true when files may be read.
 */
export async function requestHandlePermission(
	handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): Promise<boolean> {
	const h = handle as unknown as QueryableHandle;
	if (typeof h.requestPermission !== "function") return false;
	try {
		return (await h.requestPermission({ mode: "read" })) === "granted";
	} catch {
		return false;
	}
}

/** True when the handle object itself can still be reached (not revoked). */
export async function isHandleUsable(
	handle: FileSystemDirectoryHandle | null,
): Promise<boolean> {
	if (!supportsDirectoryPicker() || !handle) return false;
	try {
		// A permission query exercises the handle without reading data.
		await queryHandlePermission(handle);
		return true;
	} catch {
		return false;
	}
}
