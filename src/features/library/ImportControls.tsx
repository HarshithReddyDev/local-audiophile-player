import { useRef } from "react";
import { AUDIO_ACCEPT } from "../../library/scanner";
import { useLibraryStore } from "../../state/library-store";
import { useFileImport } from "./use-file-import";

/** File picker + folder picker buttons. Hidden input keeps styling native-safe. */
export function ImportControls({ compact = false }: { compact?: boolean }) {
	const fileRef = useRef<HTMLInputElement>(null);
	const { importFiles, importDirectory, canPickDirectory } = useFileImport();
	const loading = useLibraryStore((s) => s.loading);
	const loadingLabel = useLibraryStore((s) => s.loadingLabel);

	return (
		<div
			className={`flex flex-wrap items-center gap-2 ${compact ? "[&_button]:px-3 [&_button]:py-1.5 [&_button]:text-[13px]" : ""}`}
		>
			<input
				ref={fileRef}
				type="file"
				accept={AUDIO_ACCEPT}
				multiple
				className="sr-only"
				aria-hidden="true"
				tabIndex={-1}
				onChange={(e) => {
					const files = e.target.files;
					if (files && files.length > 0) void importFiles(files);
					e.target.value = "";
				}}
			/>
			<button
				type="button"
				disabled={loading}
				onClick={() => fileRef.current?.click()}
				className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:opacity-50"
			>
				Choose audio files
			</button>
			{canPickDirectory ? (
				<button
					type="button"
					disabled={loading}
					onClick={() => void importDirectory()}
					className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-elevated disabled:opacity-50"
				>
					Choose a folder
				</button>
			) : null}
			{loading ? (
				<span role="status" className="text-xs text-muted">
					{loadingLabel ?? "Loading…"}
				</span>
			) : null}
		</div>
	);
}
