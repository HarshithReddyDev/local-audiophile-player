import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import type { SourceStatus } from "../../types/library";

const STATUS_LABEL: Record<SourceStatus, string> = {
	unsupported: "Not supported in this browser",
	"no-source": "No folder connected",
	"permission-required": "Needs permission",
	"permission-denied": "Permission denied",
	"auth-required": "Needs sign-in",
	ready: "Connected",
	stale: "Needs re-check",
	unavailable: "Unavailable",
};

/** Connected-folder management: permission states, reconnect, background rescan. */
export function SourceManager() {
	const sources = useLibraryStore((s) => s.sources);
	const statuses = useLibraryStore((s) => s.sourceStatuses);
	const restoring = useLibraryStore((s) => s.restoring);
	const loading = useLibraryStore((s) => s.loading);
	const list = Object.values(sources).filter((s) => s.kind === "directory");

	return (
		<div className="flex flex-col gap-2">
			{!libraryService.persistent ? (
				<p
					role="note"
					className="rounded-xl border border-line bg-surface p-3 text-sm text-muted"
				>
					This browser is not keeping a persistent library (storage may be
					blocked). Music still plays, but the library resets on reload.
				</p>
			) : null}
			{restoring ? (
				<p role="status" className="text-sm text-muted">
					Restoring library…
				</p>
			) : null}
			{list.length === 0 ? (
				<p className="text-sm text-muted">
					No folder connected. Use “Choose a folder” to keep a folder in sync
					across restarts (Chromium browsers).
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{list.map((source) => {
						const status = statuses[source.id] ?? "stale";
						const needsAccess =
							status === "permission-required" ||
							status === "permission-denied";
						return (
							<li
								key={source.id}
								className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3"
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{source.name}
									</span>
									<span className="block text-xs text-muted">
										{STATUS_LABEL[status]}
										{source.lastValidatedAt
											? ` • checked ${new Date(source.lastValidatedAt).toLocaleDateString()}`
											: ""}
									</span>
								</span>
								{needsAccess ? (
									<button
										type="button"
										onClick={() =>
											void libraryService.requestSourceAccess(source.id)
										}
										className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
									>
										Reconnect
									</button>
								) : (
									<button
										type="button"
										disabled={loading}
										onClick={() => {
											useLibraryStore
												.getState()
												.setLoading(true, "Checking folder…");
											void libraryService
												.revalidateSource(source.id, (processed, total) => {
													useLibraryStore
														.getState()
														.setLoading(
															true,
															`Checking folder… ${processed}/${total}`,
														);
												})
												.finally(() =>
													useLibraryStore.getState().setLoading(false),
												);
										}}
										className="rounded-full border border-line px-3 py-1 text-xs transition-colors hover:bg-elevated disabled:opacity-50"
									>
										Rescan
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
