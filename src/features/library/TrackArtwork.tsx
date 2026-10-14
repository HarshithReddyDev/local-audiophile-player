import { useEffect, useState } from "react";
import { Artwork } from "../../components/ui/Artwork";
import { libraryService } from "../../library/library-service";

/** Resolve an artwork cache id to a runtime object URL (none while loading). */
export function useArtworkUrl(artworkId: string | null): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!artworkId) {
			setUrl(null);
			return;
		}
		let cancelled = false;
		void libraryService.getArtworkUrl(artworkId).then((resolved) => {
			if (!cancelled) setUrl(resolved);
		});
		return () => {
			cancelled = true;
		};
	}, [artworkId]);
	return url;
}

interface TrackArtworkProps {
	artworkId: string | null;
	title: string;
	size?: number;
}

/** Track cover from the persistent artwork cache, placeholder while loading. */
export function TrackArtwork({
	artworkId,
	title,
	size = 48,
}: TrackArtworkProps) {
	const url = useArtworkUrl(artworkId);
	return <Artwork url={url} title={title} size={size} />;
}
