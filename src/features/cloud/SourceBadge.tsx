/**
 * Origin badge for library rows: LOCAL for device files, the provider
 * name for cloud tracks. Text badges only (no trademark logos), plus an
 * inline availability note for remote tracks that need attention.
 */

import { useCloudStore } from "../../cloud/cloud-store";
import { cloudProviderLabel } from "../../cloud/model";
import type { Track } from "../../types/library";

export function SourceBadge({ track }: { track: Track }) {
	if (!track.remote) {
		return (
			<span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">
				Local
			</span>
		);
	}
	return (
		<span
			className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-accent"
			title={`Cloud track from ${cloudProviderLabel(track.remote.provider)}`}
		>
			{cloudProviderLabel(track.remote.provider)}
		</span>
	);
}

/** One-line remote availability note (nothing when available). */
export function RemoteStatusNote({ track }: { track: Track }) {
	const status = useCloudStore((s) =>
		track.remote ? s.trackStatuses[track.id] : undefined,
	);
	if (!track.remote || !status || status === "available") return null;
	const text =
		status === "auth-required"
			? "Needs sign-in"
			: status === "not-found"
				? "Removed from cloud"
				: status === "unsupported-format"
					? "Format not supported here"
					: status === "temp-url-expired"
						? "Refreshing link…"
						: "Cloud unavailable";
	return (
		<span className="ml-2 rounded-full border border-line px-1.5 py-0.5 align-middle text-[10px] font-normal text-muted">
			{text}
		</span>
	);
}
