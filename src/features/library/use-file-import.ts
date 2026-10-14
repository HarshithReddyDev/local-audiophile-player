import { useCallback } from "react";
import { libraryService } from "../../library/library-service";
import { pickDirectory, supportsDirectoryPicker } from "../../library/scanner";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { playTrack } from "../player/use-playback";

/**
 * Local file import. Files are read with Blob/tag APIs only and stay on the
 * device. After import, playback starts only when nothing is playing yet —
 * adding to a live session never interrupts it.
 */
export function useFileImport() {
	const importFiles = useCallback(
		async (files: Iterable<File>): Promise<number> => {
			const library = useLibraryStore.getState();
			library.setLoading(true, "Reading audio files…");
			try {
				const { added, updated } = await libraryService.importPickedFiles(
					files,
					(processed, total) => {
						useLibraryStore
							.getState()
							.setLoading(true, `Reading audio files… ${processed}/${total}`);
					},
				);
				const changed = [...added, ...updated];
				if (changed.length === 0) return 0;
				const player = usePlayerStore.getState();
				if (player.queue.length === 0 && added.length > 0) {
					player.setQueue(added, 0);
					await playTrack(added[0] ?? null, true);
				} else {
					player.enqueue(added);
				}
				return changed.length;
			} finally {
				useLibraryStore.getState().setLoading(false);
			}
		},
		[],
	);

	const importDirectory = useCallback(async (): Promise<number | null> => {
		// Returns null when the browser has no directory picker (caller hides
		// the button in that case); the user can still pick files or drop them.
		if (!supportsDirectoryPicker()) return null;
		const dir = await pickDirectory();
		if (!dir) return 0; // user cancelled
		useLibraryStore.getState().setLoading(true, "Scanning folder…");
		try {
			const { added, updated } = await libraryService.importDirectory(
				dir,
				(processed, total) => {
					useLibraryStore
						.getState()
						.setLoading(true, `Reading audio files… ${processed}/${total}`);
				},
			);
			if (added.length === 0 && updated.length === 0) return 0;
			const player = usePlayerStore.getState();
			if (player.queue.length === 0 && added.length > 0) {
				player.setQueue(added, 0);
				await playTrack(added[0] ?? null, true);
			} else {
				player.enqueue(added);
			}
			return added.length + updated.length;
		} finally {
			useLibraryStore.getState().setLoading(false);
		}
	}, []);

	return {
		importFiles,
		importDirectory,
		canPickDirectory: supportsDirectoryPicker(),
	};
}
