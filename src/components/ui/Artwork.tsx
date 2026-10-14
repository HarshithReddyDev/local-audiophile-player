interface ArtworkProps {
	url: string | null;
	title: string;
	size?: number;
}

/** Track artwork with a deterministic placeholder. Alt text stays meaningful. */
export function Artwork({ url, title, size = 48 }: ArtworkProps) {
	if (url) {
		return (
			<img
				src={url}
				alt=""
				width={size}
				height={size}
				loading="lazy"
				className="shrink-0 rounded-md object-cover"
				style={{ width: size, height: size }}
			/>
		);
	}
	return (
		<div
			aria-hidden="true"
			className="flex shrink-0 items-center justify-center rounded-md bg-elevated text-muted"
			style={{ width: size, height: size }}
		>
			<svg
				width={size * 0.45}
				height={size * 0.45}
				viewBox="0 0 24 24"
				fill="currentColor"
				role="presentation"
			>
				<rect x="3" y="10" width="3" height="7" rx="1" />
				<rect x="8" y="6" width="3" height="11" rx="1" />
				<rect x="13" y="3" width="3" height="15" rx="1" opacity="0.85" />
				<rect x="18" y="8" width="3" height="9" rx="1" opacity="0.7" />
			</svg>
			<span className="sr-only">{title}</span>
		</div>
	);
}
