import { useEffect, useRef, useState } from "react";
import { libraryService } from "../../library/library-service";
import { useLibraryStore } from "../../state/library-store";
import { usePlayerStore } from "../../state/player-store";
import { formatTime } from "../../utils/time";
import { SourceBadge } from "../cloud/SourceBadge";
import { TrackArtwork } from "../library/TrackArtwork";
import { playTrack, removeQueueItem, stopPlayback } from "./use-playback";

interface QueuePanelProps {
	open: boolean;
	onClose: () => void;
	onOpenPlaylists?: (() => void) | undefined;
}

/** Queue drawer: now playing, up next, reorder, clear, save as playlist. */
export function QueuePanel({
	open,
	onClose,
	onOpenPlaylists,
}: QueuePanelProps) {
	const panelRef = useRef<HTMLElement>(null);
	const queue = usePlayerStore((s) => s.queue);
	const currentIndex = usePlayerStore((s) => s.currentIndex);
	const [savedNote, setSavedNote] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		panelRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	useEffect(() => {
		if (!open) setSavedNote(null);
	}, [open]);

	if (!open) return null;

	const jumpTo = (index: number, trackId: string) => {
		usePlayerStore.setState({
			currentIndex: index,
			currentTime: 0,
			duration: null,
		});
		void playTrack(trackId, true);
	};

	const saveAsPlaylist = () => {
		const items = usePlayerStore.getState().queue;
		if (items.length === 0) return;
		const label = `Queue · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
		void libraryService
			.createPlaylist(
				label,
				items.map((q) => q.trackId),
			)
			.then(() => {
				setSavedNote(`Saved as “${label}”.`);
				onOpenPlaylists?.();
			});
	};

	const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
	const upNext = queue.filter((_, i) => i !== currentIndex);

	return (
		<aside
			ref={panelRef}
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
			aria-label="Play queue"
			className="fixed right-0 bottom-0 z-40 flex max-h-[75vh] w-full max-w-md flex-col border-t border-l border-line bg-surface shadow-2xl md:top-auto"
		>
			<div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
				<h2 className="text-[15px] font-semibold">Queue</h2>
				<span className="text-xs text-muted">{queue.length}</span>
				<span className="flex-1" />
				{savedNote ? (
					<span role="status" className="text-xs text-accent">
						{savedNote}
					</span>
				) : null}
				<button
					type="button"
					onClick={saveAsPlaylist}
					disabled={queue.length === 0}
					className="rounded-full border border-line px-3 py-1 text-xs font-medium transition-colors hover:bg-elevated disabled:opacity-40"
				>
					Save as playlist
				</button>
				<button
					type="button"
					onClick={() => stopPlayback()}
					disabled={queue.length === 0}
					className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-40"
				>
					Clear
				</button>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close queue"
					className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
				>
					✕
				</button>
			</div>
			<div className="overflow-y-auto px-2 py-1">
				{queue.length === 0 ? (
					<div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
						<p className="text-sm font-medium">Queue is empty</p>
						<p className="text-[13px] text-muted">
							Play any track and what follows will appear here.
						</p>
					</div>
				) : (
					<>
						{current ? (
							<section aria-label="Now playing">
								<h3 className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-widest text-muted uppercase">
									Now playing
								</h3>
								<ol>
									<QueueRow
										key={current.queueId}
										queueId={current.queueId}
										trackId={current.trackId}
										index={currentIndex}
										current
										first
										last={queue.length === 1}
										artwork
										onJump={() => jumpTo(currentIndex, current.trackId)}
									/>
								</ol>
							</section>
						) : null}
						{upNext.length > 0 ? (
							<section aria-label="Up next">
								<h3 className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-widest text-muted uppercase">
									Up next
								</h3>
								<ol>
									{upNext.map((item) => {
										const index = queue.indexOf(item);
										return (
											<QueueRow
												key={item.queueId}
												queueId={item.queueId}
												trackId={item.trackId}
												index={index}
												current={false}
												first={index === 0}
												last={index === queue.length - 1}
												onJump={() => jumpTo(index, item.trackId)}
											/>
										);
									})}
								</ol>
							</section>
						) : null}
					</>
				)}
			</div>
		</aside>
	);
}

function QueueRow({
	queueId,
	trackId,
	index,
	current,
	first,
	last,
	onJump,
	artwork = false,
}: {
	queueId: string;
	trackId: string;
	index: number;
	current: boolean;
	first: boolean;
	last: boolean;
	onJump: () => void;
	artwork?: boolean;
}) {
	const track = useLibraryStore((s) => s.tracks[trackId]);
	const store = usePlayerStore.getState();
	if (!track) return null;
	return (
		<li
			className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${current ? "bg-elevated" : "hover:bg-elevated/60"}`}
			aria-current={current ? "true" : undefined}
		>
			{artwork ? (
				<TrackArtwork
					artworkId={track.artworkId}
					title={track.title}
					size={40}
				/>
			) : null}
			<button
				type="button"
				onClick={onJump}
				className="min-w-0 flex-1 text-left"
				aria-label={`Play ${track.title}`}
			>
				<span className="block truncate text-sm font-medium">
					{current ? (
						<span
							aria-hidden="true"
							className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
						/>
					) : null}
					{track.title}
				</span>
				<span className="block truncate text-xs text-muted">
					{track.artist} • {formatTime(track.duration)}
				</span>
			</button>
			<SourceBadge track={track} />
			<span
				className="flex shrink-0"
				role="group"
				aria-label={`Reorder ${track.title}`}
			>
				<button
					type="button"
					aria-label="Move up"
					disabled={first}
					onClick={() => store.moveInQueue(queueId, index - 1)}
					className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
				>
					↑
				</button>
				<button
					type="button"
					aria-label="Move down"
					disabled={last}
					onClick={() => store.moveInQueue(queueId, index + 1)}
					className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
				>
					↓
				</button>
				<button
					type="button"
					aria-label={`Remove ${track.title} from queue`}
					onClick={() => removeQueueItem(queueId)}
					className="rounded p-1 text-muted hover:text-ink"
				>
					✕
				</button>
			</span>
		</li>
	);
}
