import type { ReactNode } from "react";

interface EmptyStateProps {
	title: string;
	body: string;
	actions?: ReactNode;
}

/** Centered empty/loading placeholder used across library views. */
export function EmptyState({ title, body, actions }: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
			<svg
				width="56"
				height="56"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				className="text-muted"
				aria-hidden="true"
			>
				<rect
					x="3"
					y="10"
					width="3"
					height="7"
					rx="1"
					fill="currentColor"
					stroke="none"
				/>
				<rect
					x="8"
					y="6"
					width="3"
					height="11"
					rx="1"
					fill="currentColor"
					stroke="none"
				/>
				<rect
					x="13"
					y="3"
					width="3"
					height="15"
					rx="1"
					fill="currentColor"
					stroke="none"
				/>
				<rect
					x="18"
					y="8"
					width="3"
					height="9"
					rx="1"
					fill="currentColor"
					stroke="none"
				/>
			</svg>
			<h2 className="text-lg font-semibold">{title}</h2>
			<p className="max-w-sm text-sm text-muted">{body}</p>
			{actions ? (
				<div className="mt-2 flex flex-wrap justify-center gap-2">
					{actions}
				</div>
			) : null}
		</div>
	);
}
