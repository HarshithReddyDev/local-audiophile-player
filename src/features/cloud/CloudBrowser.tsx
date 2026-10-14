/**
 * Cloud file browser: roots → folders → audio files for one connected
 * account. Bounded pages ("Load more"), server search where offered,
 * audio-only filter, and explicit actions — nothing is scanned
 * automatically, nothing downloads except playback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isAudioFile } from "../../cloud/audio-formats";
import { cloudService } from "../../cloud/cloud-service";
import { useCloudStore } from "../../cloud/cloud-store";
import { CloudError, cloudProviderLabel } from "../../cloud/model";
import type { CloudItem } from "../../cloud/providers";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { playTrack } from "../player/use-playback";

function itemKey(item: CloudItem): string {
	return `${item.kind}:${item.id}`;
}

export function CloudBrowser({ accountId }: { accountId: string }) {
	const account = useCloudStore((s) => s.accounts[accountId]);
	const [stack, setStack] = useState<{ id: string; name: string }[]>([]);
	const [items, setItems] = useState<CloudItem[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [audioOnly, setAudioOnly] = useState(true);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState<string | null>(null);
	const [progress, setProgress] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const tracks = useLibraryStore((s) => s.tracks);

	const current = stack.length > 0 ? stack[stack.length - 1] : null;

	const loadRoots = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const roots = await cloudService.listRoots(accountId);
			setItems(roots);
			setCursor(null);
			setStack([]);
		} catch (e) {
			setError(e instanceof CloudError ? e.message : "Could not list folders.");
		} finally {
			setLoading(false);
		}
	}, [accountId]);

	useEffect(() => {
		setSelected(new Set());
		setQuery("");
		setSearching(false);
		void loadRoots();
	}, [loadRoots]);

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	if (!account) return null;

	const openFolder = async (folder: { id: string; name: string }) => {
		setLoading(true);
		setError(null);
		setSelected(new Set());
		try {
			const listing = await cloudService.listChildren(
				accountId,
				folder.id,
				null,
			);
			setItems(listing.items);
			setCursor(listing.nextCursor);
			setStack((s) => [...s, folder]);
		} catch (e) {
			setError(e instanceof CloudError ? e.message : "Could not list folders.");
		} finally {
			setLoading(false);
		}
	};

	const goBack = async () => {
		const parent = stack.slice(0, -1);
		setLoading(true);
		setError(null);
		setSelected(new Set());
		try {
			if (parent.length === 0) {
				await loadRoots();
			} else {
				const folder = parent[parent.length - 1];
				if (!folder) return;
				const listing = await cloudService.listChildren(
					accountId,
					folder.id,
					null,
				);
				setItems(listing.items);
				setCursor(listing.nextCursor);
				setStack(parent);
			}
		} catch (e) {
			setError(e instanceof CloudError ? e.message : "Could not list folders.");
		} finally {
			setLoading(false);
		}
	};

	const loadMore = async () => {
		if (!current || !cursor) return;
		setLoadingMore(true);
		try {
			const listing = await cloudService.listChildren(
				accountId,
				current.id,
				cursor,
			);
			setItems((prev) => [...prev, ...listing.items]);
			setCursor(listing.nextCursor);
		} catch (e) {
			setError(e instanceof CloudError ? e.message : "Could not list folders.");
		} finally {
			setLoadingMore(false);
		}
	};

	const runSearch = async () => {
		const q = query.trim();
		if (!q) {
			setSearching(false);
			void loadRoots();
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const listing = await cloudService.searchRemote(accountId, q, null);
			setItems(listing?.items ?? []);
			setCursor(listing?.nextCursor ?? null);
			setSearching(true);
		} catch (e) {
			setError(e instanceof CloudError ? e.message : "Search failed.");
		} finally {
			setLoading(false);
		}
	};

	const visible = audioOnly
		? items.filter(
				(i) => i.kind === "folder" || isAudioFile(i.name, i.mimeType),
			)
		: items;

	const toggleSelect = (item: CloudItem) => {
		setSelected((prev) => {
			const next = new Set(prev);
			const key = itemKey(item);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const selectedItems = visible.filter((i) => selected.has(itemKey(i)));

	const addToLibrary = async (toImport: CloudItem[]) => {
		if (toImport.length === 0) return;
		setBusy("Adding…");
		setError(null);
		try {
			const files = toImport.filter((i) => i.kind === "file");
			const result = await cloudService.importRemoteItems(accountId, files);
			setProgress(
				`Added ${result.added.length}, updated ${result.updated.length}` +
					(result.skippedUnsupported > 0
						? `, skipped ${result.skippedUnsupported} unsupported`
						: "") +
					". Nothing downloaded.",
			);
			setSelected(new Set());
		} catch (e) {
			setError(
				e instanceof CloudError ? e.message : "Could not add to library.",
			);
		} finally {
			setBusy(null);
		}
	};

	const addFolder = async (folder: CloudItem) => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setBusy(`Adding folder “${folder.name}”…`);
		setError(null);
		setProgress(null);
		try {
			const collected = await cloudService.collectFolderAudio(
				accountId,
				folder.id,
				folder.name,
				(n) => setProgress(`Found ${n} audio files…`),
				controller.signal,
			);
			if (controller.signal.aborted) {
				setProgress("Cancelled.");
				return;
			}
			const result = await cloudService.importRemoteItems(
				accountId,
				collected.items,
			);
			setProgress(
				`Folder “${folder.name}”: added ${result.added.length}, updated ${result.updated.length}` +
					(collected.truncated ? " (stopped at 5,000 files)" : "") +
					". Nothing downloaded.",
			);
		} catch (e) {
			if (controller.signal.aborted) setProgress("Cancelled.");
			else
				setError(e instanceof CloudError ? e.message : "Could not add folder.");
		} finally {
			setBusy(null);
			if (abortRef.current === controller) abortRef.current = null;
		}
	};

	const playNow = async (item: CloudItem) => {
		setBusy("Loading…");
		setError(null);
		try {
			await cloudService.importRemoteItems(accountId, [item]);
			const id = Object.values(useLibraryStore.getState().tracks).find(
				(t) =>
					t.remote?.accountId === accountId &&
					t.remote.providerFileId === item.id,
			)?.id;
			if (!id) throw new Error("import failed");
			usePlayerStore.getState().setQueue([id], 0);
			await playTrack(id, true);
		} catch (e) {
			setError(
				e instanceof CloudError ? e.message : "Could not play this file.",
			);
		} finally {
			setBusy(null);
		}
	};

	const queueItems = async (toQueue: CloudItem[]) => {
		const files = toQueue.filter((i) => i.kind === "file");
		if (files.length === 0) return;
		setBusy("Queueing…");
		try {
			await cloudService.importRemoteItems(accountId, files);
			const state = useLibraryStore.getState().tracks;
			const ids = files.flatMap((item) => {
				const id = Object.values(state).find(
					(t) =>
						t.remote?.accountId === accountId &&
						t.remote.providerFileId === item.id,
				)?.id;
				// Re-read after import: importRemoteItems updated the store.
				const fresh = useLibraryStore.getState().tracks[id ?? ""];
				return fresh ? [fresh.id] : [];
			});
			if (ids.length > 0) {
				usePlayerStore.getState().enqueue(ids);
				setProgress(`Queued ${ids.length}.`);
			}
			setSelected(new Set());
		} catch (e) {
			setError(e instanceof CloudError ? e.message : "Could not queue files.");
		} finally {
			setBusy(null);
		}
	};

	const inLibrary = (item: CloudItem): boolean =>
		Object.values(tracks).some(
			(t) =>
				t.remote?.accountId === accountId &&
				t.remote.providerFileId === item.id,
		);

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => useCloudStore.getState().setBrowser(null)}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					← Sources
				</button>
				<span className="text-sm font-semibold">
					{cloudProviderLabel(account.provider)} — {account.accountLabel}
				</span>
				<span className="flex-1" />
				<label className="flex items-center gap-1 text-xs text-muted">
					<input
						type="checkbox"
						checked={audioOnly}
						onChange={(e) => setAudioOnly(e.target.checked)}
					/>
					Audio only
				</label>
			</div>
			<div className="flex items-center gap-2 text-xs text-muted">
				<button
					type="button"
					onClick={() => void loadRoots()}
					className="hover:text-ink hover:underline"
				>
					{cloudProviderLabel(account.provider)}
				</button>
				{stack.map((f, i) => (
					<span key={`${f.id}-${i}`} className="flex items-center gap-2">
						<span aria-hidden="true">/</span>
						<span className={i === stack.length - 1 ? "text-ink" : ""}>
							{f.name}
						</span>
					</span>
				))}
				{stack.length > 0 ? (
					<button
						type="button"
						onClick={() => void goBack()}
						className="ml-2 rounded-full border border-line px-2 py-0.5 hover:bg-elevated"
					>
						Up
					</button>
				) : null}
			</div>
			<form
				className="flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					void runSearch();
				}}
			>
				<label className="sr-only" htmlFor="cloud-search">
					Search cloud files
				</label>
				<input
					id="cloud-search"
					type="search"
					value={query}
					placeholder="Search files…"
					onChange={(e) => setQuery(e.target.value)}
					className="min-w-0 flex-1 rounded-full border border-line bg-abyss px-3 py-1.5 text-sm outline-none placeholder:text-muted"
				/>
				<button
					type="submit"
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Search
				</button>
			</form>
			{error ? (
				<p role="alert" className="text-xs text-red-300">
					{error}
				</p>
			) : null}
			{progress ? (
				<p role="status" className="text-xs text-accent">
					{progress}
					{busy ? (
						<button
							type="button"
							onClick={() => abortRef.current?.abort()}
							className="ml-2 rounded-full border border-line px-2 py-0.5 text-muted hover:bg-elevated"
						>
							Cancel
						</button>
					) : null}
				</p>
			) : null}
			{loading ? (
				<p role="status" className="text-xs text-muted">
					Loading…
				</p>
			) : visible.length === 0 ? (
				<p className="px-2 py-6 text-center text-xs text-muted">
					{searching ? "No files match." : "This folder is empty."}
				</p>
			) : (
				<ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
					{visible.map((item) => {
						const key = itemKey(item);
						const checked = selected.has(key);
						return (
							<li
								key={key}
								className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-elevated/60"
							>
								<input
									type="checkbox"
									checked={checked}
									onChange={() => toggleSelect(item)}
									aria-label={`Select ${item.name}`}
								/>
								<button
									type="button"
									onClick={() =>
										item.kind === "folder"
											? void openFolder({ id: item.id, name: item.name })
											: void playNow(item)
									}
									className="min-w-0 flex-1 text-left"
									aria-label={
										item.kind === "folder"
											? `Open ${item.name}`
											: `Play ${item.name}`
									}
								>
									<span className="block truncate text-sm">
										{item.kind === "folder" ? "📁 " : "♪ "}
										{item.name}
									</span>
									<span className="block truncate text-[11px] text-muted">
										{item.kind === "folder"
											? "Folder"
											: `${formatSize(item.size)}${inLibrary(item) ? " • in library" : ""}`}
									</span>
								</button>
								{item.kind === "folder" ? (
									<button
										type="button"
										disabled={busy !== null}
										onClick={() => void addFolder(item)}
										className="shrink-0 rounded-full border border-line px-2 py-1 text-[11px] hover:bg-elevated disabled:opacity-50"
									>
										Add folder
									</button>
								) : (
									<button
										type="button"
										disabled={busy !== null}
										onClick={() => void playNow(item)}
										className="shrink-0 rounded-full border border-line px-2 py-1 text-[11px] hover:bg-elevated disabled:opacity-50"
									>
										Play
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{current && cursor ? (
				<button
					type="button"
					disabled={loadingMore}
					onClick={() => void loadMore()}
					className="self-center rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated disabled:opacity-50"
				>
					{loadingMore ? "Loading…" : "Load more"}
				</button>
			) : null}
			{selectedItems.length > 0 ? (
				<div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
					<span className="text-xs text-muted">
						{selectedItems.length} selected
					</span>
					<button
						type="button"
						disabled={busy !== null}
						onClick={() => void addToLibrary(selectedItems)}
						className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
					>
						Add to library
					</button>
					<button
						type="button"
						disabled={busy !== null}
						onClick={() => void queueItems(selectedItems)}
						className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated disabled:opacity-50"
					>
						Add to queue
					</button>
					{busy ? (
						<span role="status" className="text-xs text-muted">
							{busy}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function formatSize(size: number | null): string {
	if (size === null) return "File";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
	if (size < 1024 * 1024 * 1024) return `${(size / 1048576).toFixed(1)} MB`;
	return `${(size / 1073741824).toFixed(2)} GB`;
}
