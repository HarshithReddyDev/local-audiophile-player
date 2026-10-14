import type { ReactNode } from "react";
import type { Route } from "../../app/routes";
import { MOBILE_NAV, NAV_GROUPS, type NavItem } from "../../app/routes";
import { ImportControls } from "../../features/library/ImportControls";
import { PlayerBar } from "../../features/player/PlayerBar";

interface AppShellProps {
	route: Route;
	onNavigate: (route: Route) => void;
	onOpenNowPlaying: () => void;
	onOpenQueue: () => void;
	showPlayerBar: boolean;
	queueOpen: boolean;
	onToggleQueue: () => void;
	onOpenDevices?: () => void;
	children: ReactNode;
}

function NavIcon({ id }: { id: Route }) {
	const common = {
		width: 18,
		height: 18,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.8,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true,
	} as const;
	switch (id) {
		case "tracks":
			return (
				<svg {...common}>
					<path d="M9 18V6l10-2v12" />
					<circle cx="6.5" cy="18" r="2.5" />
					<circle cx="16.5" cy="16" r="2.5" />
				</svg>
			);
		case "playlists":
			return (
				<svg {...common}>
					<path d="M4 6h12M4 10h12M4 14h7" />
					<path d="m17 14 4 4-4 4" />
					<path d="M21 18h-6" />
				</svg>
			);
		case "devices":
			return (
				<svg {...common}>
					<path d="M4 13a8 8 0 0 1 16 0" />
					<rect x="3" y="13" width="4" height="7" rx="1.5" />
					<rect x="17" y="13" width="4" height="7" rx="1.5" />
				</svg>
			);
		case "eq":
		case "dsp":
			return (
				<svg {...common}>
					<path d="M6 4v16M12 4v16M18 4v16" />
					<circle cx="6" cy="14" r="2" fill="currentColor" stroke="none" />
					<circle cx="12" cy="9" r="2" fill="currentColor" stroke="none" />
					<circle cx="18" cy="16" r="2" fill="currentColor" stroke="none" />
				</svg>
			);
		case "iem":
			return (
				<svg {...common}>
					<circle cx="12" cy="12" r="3" />
					<path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
				</svg>
			);
		default:
			return (
				<svg {...common}>
					<circle cx="12" cy="12" r="3" />
					<path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.07-.4.1-.8.1-1.2Z" />
				</svg>
			);
	}
}

/** Responsive shell: icon sidebar on desktop, compact bottom nav on mobile. */
export function AppShell({
	route,
	onNavigate,
	onOpenNowPlaying,
	onOpenQueue,
	showPlayerBar,
	queueOpen,
	onToggleQueue,
	onOpenDevices,
	children,
}: AppShellProps) {
	return (
		<div className="flex h-dvh flex-col md:flex-row">
			<header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 md:hidden">
				<p className="text-[15px] font-bold tracking-tight">Local IEM Player</p>
				<span className="text-xs text-muted">100% on-device</span>
			</header>

			<nav
				aria-label="Primary"
				className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface px-3 py-4 md:flex"
			>
				<p className="px-2 pb-3 text-[15px] font-bold tracking-tight">
					Local IEM Player
				</p>
				{NAV_GROUPS.map((group) => (
					<div key={group.label} className="flex flex-col">
						<p
							aria-hidden="true"
							className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-widest text-muted uppercase"
						>
							{group.label}
						</p>
						{group.items.map((r) => (
							<SidebarItem
								key={r.id}
								item={r}
								active={r.activeRoutes.includes(route)}
								onNavigate={onNavigate}
							/>
						))}
					</div>
				))}
				<div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
					<p
						aria-hidden="true"
						className="px-3 pt-1 pb-1 text-[11px] font-semibold tracking-widest text-muted uppercase"
					>
						Playing
					</p>
					<button
						type="button"
						onClick={onOpenNowPlaying}
						className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-muted transition-colors hover:bg-elevated hover:text-ink"
					>
						<svg
							width={18}
							height={18}
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M8 5v14l11-7z" />
						</svg>
						Now Playing
					</button>
					<button
						type="button"
						onClick={onOpenQueue}
						aria-expanded={queueOpen}
						className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-muted transition-colors hover:bg-elevated hover:text-ink"
					>
						<svg
							width={18}
							height={18}
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M4 6h12v2H4zm0 5h12v2H4zm0 5h7v2H4zm14-9 4 4-4 4v-3h-3V9h3z" />
						</svg>
						Queue
					</button>
				</div>
				<div className="mt-auto flex flex-col gap-2 px-1 pt-4">
					<ImportControls compact />
				</div>
			</nav>

			<div className="flex min-h-0 flex-1 flex-col">
				<main className="min-h-0 flex-1 overflow-y-auto" aria-label="Content">
					<div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-8 md:py-6">
						{children}
					</div>
				</main>
				{showPlayerBar ? (
					<PlayerBar
						onOpenNowPlaying={onOpenNowPlaying}
						queueOpen={queueOpen}
						onToggleQueue={onToggleQueue}
						{...(onOpenDevices ? { onOpenDevices } : {})}
					/>
				) : null}
				<nav
					aria-label="Primary"
					className="grid shrink-0 grid-cols-5 border-t border-line bg-surface px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
				>
					{MOBILE_NAV.map((r) => {
						const active = r.activeRoutes.includes(route);
						return (
							<button
								key={r.id + r.label}
								type="button"
								onClick={() => onNavigate(r.id)}
								aria-current={active ? "page" : undefined}
								className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] transition-colors ${active ? "font-semibold text-accent" : "text-muted"}`}
							>
								<NavIcon id={r.id} />
								{r.label}
							</button>
						);
					})}
				</nav>
			</div>
		</div>
	);
}

function SidebarItem({
	item,
	active,
	onNavigate,
}: {
	item: NavItem;
	active: boolean;
	onNavigate: (route: Route) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onNavigate(item.id)}
			aria-current={active ? "page" : undefined}
			className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-colors hover:bg-elevated ${
				active
					? "bg-elevated font-semibold text-ink"
					: "text-muted hover:text-ink"
			}`}
		>
			<span aria-hidden="true" className={active ? "text-accent" : undefined}>
				<NavIcon id={item.id} />
			</span>
			{item.label}
		</button>
	);
}
