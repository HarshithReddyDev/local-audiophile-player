/**
 * Contextual "Learn" link that jumps to a specific in-app guide.
 * With onOpenGuide it calls back directly; otherwise it dispatches the
 * app:open-guide event the App root listens for (avoids prop drilling).
 */
export function LearnLink({
	guideId,
	onOpenGuide,
	label = "Learn",
}: {
	guideId: string;
	onOpenGuide?: ((guideId: string) => void) | undefined;
	label?: string;
}) {
	return (
		<button
			type="button"
			onClick={() => {
				if (onOpenGuide) {
					onOpenGuide(guideId);
					return;
				}
				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent<string>("app:open-guide", { detail: guideId }),
					);
				}
			}}
			className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-accent"
		>
			{label} →
		</button>
	);
}
