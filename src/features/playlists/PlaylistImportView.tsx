/**
 * Playlist import: file → match review → local playlist.
 *
 * Metadata only, matched locally, never uploaded. Unmatched tracks keep
 * their metadata in the import session — they never become fake track
 * ids. Re-imports of the same external playlist offer update/copy/cancel
 * with manual resolutions preserved.
 */

import { useState } from "react";
import {
	PlaylistFileError,
	parsePlaylistFile,
} from "../../import/file-provider";
import type { LocalCandidate } from "../../import/match";
import type { ImportItem, ImportSession } from "../../import/model";
import { summarizeMatches } from "../../import/model";
import { PROVIDERS } from "../../import/providers";
import {
	acceptHighConfidence,
	buildSessionFor,
	diffSessions,
	findExistingSession,
	resolveItem,
	sessionLocalIds,
} from "../../import/session";
import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import { LearnLink } from "../guides/LearnLink";

function libraryCandidates(): LocalCandidate[] {
	const tracks = useLibraryStore.getState().tracks;
	return Object.values(tracks).map((t) => ({
		id: t.id,
		title: t.title,
		artist: t.artist,
		album: t.album,
		durationSec: t.duration,
		isrc: null,
	}));
}

const STATE_LABEL: Record<ImportItem["match"]["state"], string> = {
	matched: "Matched",
	ambiguous: "Needs review",
	unmatched: "Unmatched",
	unavailable: "Unavailable",
	manual: "Resolved by you",
};

export function PlaylistImportView({ onDone }: { onDone: () => void }) {
	const [session, setSession] = useState<ImportSession | null>(null);
	const [existing, setExisting] = useState<ImportSession | null>(null);
	const [mode, setMode] = useState<"update" | "copy" | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [doneId, setDoneId] = useState<string | null>(null);

	const persist = (next: ImportSession) => {
		setSession(next);
		void libraryService.saveImportSession(next).catch(() => {
			// Resolutions live in UI state regardless; persistence retry
			// happens on the next action.
		});
	};

	const onPickFile = (file: File | undefined) => {
		if (!file) return;
		setError(null);
		setNotice(null);
		setDoneId(null);
		void file
			.text()
			.then(async (text) => {
				const external = parsePlaylistFile(text, file.name, Date.now());
				const candidates = libraryCandidates();
				if (candidates.length === 0) {
					setError(
						"Your library is empty — import music files first, then match this playlist against them.",
					);
					return;
				}
				const fresh = buildSessionFor(external, candidates);
				const stored = await libraryService.listImportSessions();
				const dup = findExistingSession(
					stored,
					fresh.provider,
					fresh.externalId,
				);
				setExisting(dup);
				setMode(dup ? null : "copy");
				persist(fresh);
				setName(fresh.name);
			})
			.catch((e: unknown) => {
				setError(
					e instanceof PlaylistFileError
						? e.message
						: "That playlist file could not be read.",
				);
			});
	};

	const applyUpdate = async () => {
		if (!session || !existing?.localPlaylistId) return;
		const previousIds = sessionLocalIds(existing);
		const { merged, diff } = diffSessions(existing, session);
		await libraryService.updatePlaylistFromImport(
			existing.localPlaylistId,
			merged,
			previousIds,
		);
		persist(merged);
		setNotice(
			`Updated: +${diff.added.length} added, −${diff.removed.length} removed` +
				(diff.reordered.length > 0
					? `, ${diff.reordered.length} reordered`
					: "") +
				(diff.changed.length > 0 ? `, ${diff.changed.length} changed` : "") +
				". Your manual picks were kept.",
		);
	};

	const doImport = async (asCopy: boolean) => {
		if (!session) return;
		const label = name.trim() || session.name;
		try {
			if (!asCopy && existing?.localPlaylistId && mode === "update") {
				await applyUpdate();
				return;
			}
			const pid = await libraryService.createPlaylistFromImport(session, label);
			setDoneId(pid);
			setNotice(
				`Created "${label}" with ${sessionLocalIds(session).length} matched tracks. ` +
					"Unmatched tracks stay in the import record — nothing was discarded.",
			);
		} catch (e) {
			setError(
				e instanceof Error ? `Import failed: ${e.message}` : "Import failed.",
			);
		}
	};

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
			<div className="flex items-center gap-2">
				<h3 className="text-sm font-semibold">Import playlist</h3>
				<span className="flex-1" />
				<LearnLink guideId="playlists" />
				<button
					type="button"
					onClick={onDone}
					className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Close
				</button>
			</div>
			<p className="text-[13px] text-muted">
				Matches a playlist file against your local library. Audio is never
				touched and nothing is uploaded.
			</p>
			<div className="flex flex-col gap-2">
				{PROVIDERS.filter((p) => p.status === "available").map((p) => (
					<div
						key={p.id}
						className="flex flex-wrap items-center gap-3 rounded-xl bg-elevated/60 px-3 py-2.5 text-sm"
					>
						<span className="min-w-0 flex-1">
							<span className="block font-medium">{p.label}</span>
							<span className="block text-[13px] text-muted">
								.m3u, .m3u8, .csv, .txt, or .json from your device
							</span>
						</span>
						<label className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02]">
							Choose file
							<input
								type="file"
								accept=".m3u,.m3u8,.csv,.txt,.json"
								className="sr-only"
								aria-label="Choose playlist file"
								onChange={(e) => {
									onPickFile(e.target.files?.[0]);
									e.target.value = "";
								}}
							/>
						</label>
					</div>
				))}
				<details className="rounded-xl px-1 text-[13px] text-muted">
					<summary className="cursor-pointer py-1 font-medium hover:text-ink">
						Other services
					</summary>
					<p className="pt-1 pb-2">
						Export the playlist from the other app as a file, then import it
						here. Direct streaming-service connections are not available in this
						local-first app.
					</p>
				</details>
			</div>
			{error ? (
				<p role="alert" className="text-sm text-red-300">
					{error}
				</p>
			) : null}
			{notice ? (
				<p role="status" className="text-sm text-accent">
					{notice}
				</p>
			) : null}
			{session && !doneId ? (
				<ReviewPanel
					session={session}
					existing={existing}
					mode={mode}
					name={name}
					onMode={setMode}
					onName={setName}
					onChange={persist}
					onImport={doImport}
				/>
			) : null}
			{doneId ? (
				<p role="status" className="text-sm text-accent">
					Playlist ready. Unmatched tracks remain in the import record and can
					be resolved by re-importing the same file.
				</p>
			) : null}
		</div>
	);
}

function ReviewPanel(props: {
	session: ImportSession;
	existing: ImportSession | null;
	mode: "update" | "copy" | null;
	name: string;
	onMode: (m: "update" | "copy") => void;
	onName: (n: string) => void;
	onChange: (s: ImportSession) => void;
	onImport: (asCopy: boolean) => void;
}) {
	const { session, existing, mode } = props;
	const counts = summarizeMatches(session.items);
	const linkable = sessionLocalIds(session).length;

	return (
		<div className="flex flex-col gap-2 border-t border-line pt-2">
			{existing ? (
				<div
					role="group"
					aria-label="Duplicate import"
					className="rounded-md border border-line p-2 text-xs"
				>
					<p className="mb-1 font-medium">
						This playlist was imported before. Update the existing local
						playlist, keeping your manual picks — or import a separate copy.
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							aria-pressed={mode === "update"}
							onClick={() => props.onMode("update")}
							className={`rounded-full border px-3 py-1 ${mode === "update" ? "border-accent font-semibold" : "border-line text-muted"}`}
						>
							Update existing
						</button>
						<button
							type="button"
							aria-pressed={mode === "copy"}
							onClick={() => props.onMode("copy")}
							className={`rounded-full border px-3 py-1 ${mode === "copy" ? "border-accent font-semibold" : "border-line text-muted"}`}
						>
							Create copy
						</button>
					</div>
				</div>
			) : null}
			<p className="text-xs text-muted" role="status">
				Matched: {counts.matched} · Needs review: {counts.ambiguous} ·
				Unmatched: {counts.unmatched} · Resolved by you: {counts.manual} · Will
				import: {linkable} of {session.items.length}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => props.onChange(acceptHighConfidence(session))}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Accept all high-confidence
				</button>
				<label className="flex items-center gap-1 text-xs text-muted">
					Playlist name
					<input
						value={props.name}
						onChange={(e) => props.onName(e.target.value)}
						className="w-44 rounded-md border border-line bg-abyss px-2 py-1 text-sm text-ink"
					/>
				</label>
				<button
					type="button"
					disabled={mode === null}
					onClick={() => props.onImport(mode === "copy")}
					className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
				>
					{existing && mode === "update"
						? "Apply update"
						: "Create local playlist"}
				</button>
			</div>
			<ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
				{session.items.map((item) => (
					<MatchRow
						key={item.key}
						item={item}
						onChange={(next) => {
							const items = session.items.map((i) =>
								i.key === item.key ? next(item) : i,
							);
							props.onChange({ ...session, items, updatedAt: Date.now() });
						}}
					/>
				))}
			</ol>
		</div>
	);
}

function MatchRow(props: {
	item: ImportItem;
	onChange: (fn: (item: ImportItem) => ImportItem) => void;
}) {
	const { item } = props;
	const tracks = useLibraryStore((s) => s.tracks);
	const [query, setQuery] = useState("");
	const ext = item.external;
	const byline = [ext.artists.join(", ") || "Unknown artist", ext.album ?? null]
		.filter(Boolean)
		.join(" · ");

	const candidates = item.match.candidates
		.map((id) => tracks[id])
		.filter((t) => t != null);
	const searchHits = query.trim()
		? Object.values(tracks)
				.filter(
					(t) =>
						t.title.toLowerCase().includes(query.toLowerCase()) ||
						t.artist.toLowerCase().includes(query.toLowerCase()),
				)
				.slice(0, 8)
		: [];

	return (
		<li className="flex flex-col gap-1 rounded-md border border-line px-2 py-1.5 text-xs">
			<span className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium">{ext.title}</span>
					<span className="block truncate text-muted">{byline}</span>
				</span>
				<span
					className={`shrink-0 rounded-full border px-2 py-0.5 ${
						item.match.state === "matched" || item.match.state === "manual"
							? "border-accent text-accent"
							: item.match.state === "ambiguous"
								? "border-line text-ink"
								: "text-muted"
					}`}
				>
					{STATE_LABEL[item.match.state]}
					{item.skipped ? " · skipped" : ""}
				</span>
			</span>
			{item.match.state === "ambiguous" && candidates.length > 0 ? (
				<label className="flex items-center gap-1 text-muted">
					Candidate
					<select
						aria-label={`Choose match for ${ext.title}`}
						defaultValue=""
						onChange={(e) => {
							if (e.target.value) applyResolve(e.target.value, false);
						}}
						className="rounded-md border border-line bg-abyss px-2 py-1 text-ink"
					>
						<option value="">Choose…</option>
						{candidates.map((c) => (
							<option key={c.id} value={c.id}>
								{c.title} — {c.artist}
							</option>
						))}
					</select>
				</label>
			) : null}
			<span className="flex flex-wrap items-center gap-1">
				<label className="sr-only" htmlFor={`search-${item.key}`}>
					Search library for {ext.title}
				</label>
				<input
					id={`search-${item.key}`}
					type="search"
					value={query}
					placeholder="Search library…"
					onChange={(e) => setQuery(e.target.value)}
					className="w-36 rounded-md border border-line bg-abyss px-2 py-1 text-ink"
				/>
				<button
					type="button"
					onClick={() => applyResolve(null, true)}
					className="rounded-md px-2 py-1 text-muted hover:bg-elevated hover:text-ink"
				>
					Skip
				</button>
				<button
					type="button"
					onClick={() => applyResolve(null, false)}
					className="rounded-md px-2 py-1 text-muted hover:bg-elevated hover:text-ink"
				>
					Keep unresolved
				</button>
			</span>
			{searchHits.length > 0 ? (
				<ul className="flex flex-col gap-0.5">
					{searchHits.map((t) => (
						<li key={t.id} className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate text-muted">
								{t.title} — {t.artist}
							</span>
							<button
								type="button"
								aria-label={`Use ${t.title} for ${ext.title}`}
								onClick={() => {
									applyResolve(t.id, false);
									setQuery("");
								}}
								className="rounded-md px-2 py-0.5 text-accent hover:bg-elevated"
							>
								Use
							</button>
						</li>
					))}
				</ul>
			) : null}
		</li>
	);

	function applyResolve(localTrackId: string | null, skipped: boolean) {
		const single: ImportSession = {
			id: "row",
			provider: item.external.provider,
			externalId: "row",
			name: "",
			description: null,
			sourceUrl: null,
			importedAt: 0,
			updatedAt: 0,
			localPlaylistId: null,
			items: [{ ...item, skipped: false }],
		};
		const next = resolveItem(single, item.key, localTrackId, skipped);
		const updated = next.items[0];
		if (updated) props.onChange(() => updated);
	}
}
