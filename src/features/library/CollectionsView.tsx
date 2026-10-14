import { useMemo } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { useLibraryStore } from "../../state/library-store";
import { TrackList } from "./TrackList";

/** Recently added (by import time) and recently played (by play stats). */
export function RecentView() {
	const order = useLibraryStore((s) => s.order);
	const tracksById = useLibraryStore((s) => s.tracks);
	const stats = useLibraryStore((s) => s.stats);

	const added = useMemo(() => {
		const tracks = order.map((id) => tracksById[id]).filter((t) => t != null);
		return [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 100);
	}, [order, tracksById]);

	const played = useMemo(() => {
		return Object.values(stats)
			.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
			.slice(0, 100)
			.map((s) => tracksById[s.trackId])
			.filter((t) => t != null);
	}, [stats, tracksById]);

	return (
		<div className="flex flex-col gap-6">
			<section aria-labelledby="recently-added">
				<h2
					id="recently-added"
					className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase"
				>
					Recently added
				</h2>
				{added.length === 0 ? (
					<p className="text-sm text-muted">Nothing imported yet.</p>
				) : (
					<TrackList tracks={added} />
				)}
			</section>
			<section aria-labelledby="recently-played">
				<h2
					id="recently-played"
					className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase"
				>
					Recently played
				</h2>
				{played.length === 0 ? (
					<p className="text-sm text-muted">Plays you finish show up here.</p>
				) : (
					<TrackList tracks={played} />
				)}
			</section>
		</div>
	);
}

/** Favorite tracks, newest first. */
export function FavoritesView() {
	const favorites = useLibraryStore((s) => s.favorites);
	const tracksById = useLibraryStore((s) => s.tracks);
	const tracks = favorites.map((id) => tracksById[id]).filter((t) => t != null);

	if (tracks.length === 0) {
		return (
			<EmptyState
				title="No favorites yet"
				body="Tap the heart on any track to pin it here. Favorites persist across restarts."
			/>
		);
	}
	return <TrackList tracks={tracks} />;
}
