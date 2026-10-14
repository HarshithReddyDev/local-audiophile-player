import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { DevicesView } from "../features/devices/DevicesView";
import { AudioTuningView } from "../features/eq/AudioTuningView";
import { GuidesView } from "../features/guides/GuidesView";
import { requestGuide } from "../features/guides/guides-data";
import { IEMView } from "../features/iem/IEMView";
import { MusicView, musicTabForRoute } from "../features/library/MusicView";
import { useFileImport } from "../features/library/use-file-import";
import type { NowPlayingTab } from "../features/now-playing/NowPlayingView";
import { NowPlayingView } from "../features/now-playing/NowPlayingView";
import { CommandPalette } from "../features/player/CommandPalette";
import { QueuePanel } from "../features/player/QueuePanel";
import {
	nextTrack,
	previousTrack,
	seekBySeconds,
	togglePlayback,
	usePlaybackController,
} from "../features/player/use-playback";
import { PlaylistsView } from "../features/playlists/PlaylistsView";
import { SettingsView } from "../features/settings/SettingsView";
import { libraryService } from "../library/library-service";
import { usePlayerStore } from "../state/player-store";
import type { Route } from "./routes";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.isContentEditable
	);
}

/**
 * Targets where global transport keys must not fire: native controls that
 * already handle the key (a focused Play button + Space would toggle twice)
 * and custom sliders (EQ graph points use arrows to retune).
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.tagName === "BUTTON" ||
		target.getAttribute("role") === "slider" ||
		target.closest('button, [role="slider"]') !== null
	);
}

/** Root component: routes views, drag-and-drop import, keyboard transport. */
export function App() {
	const [route, setRoute] = useState<Route>("tracks");
	const [nowPlaying, setNowPlaying] = useState(false);
	const [nowPlayingTab, setNowPlayingTab] = useState<NowPlayingTab>("info");
	const [queueOpen, setQueueOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [pendingPlaylistId, setPendingPlaylistId] = useState<string | null>(
		null,
	);
	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);
	const { importFiles } = useFileImport();
	usePlaybackController();

	const navigate = useCallback((r: Route) => {
		setNowPlaying(false);
		setRoute(r);
	}, []);

	// Contextual "Learn" links jump straight to the relevant guide. The nonce
	// remounts GuidesView so the pending guide applies even when already there.
	const [guideNonce, setGuideNonce] = useState(0);
	const openGuide = useCallback(
		(id: string) => {
			requestGuide(id);
			setGuideNonce((n) => n + 1);
			navigate("guides");
		},
		[navigate],
	);

	useEffect(() => {
		const onOpenGuide = (e: Event) => {
			const id = (e as CustomEvent<string>).detail;
			if (typeof id === "string" && id) openGuide(id);
		};
		window.addEventListener("app:open-guide", onOpenGuide);
		return () => window.removeEventListener("app:open-guide", onOpenGuide);
	}, [openGuide]);

	// Restore the persistent library without blocking the player shell.
	useEffect(() => {
		void libraryService.initialize().then(async () => {
			// Finish a cloud OAuth redirect round-trip (?oauth=callback),
			// if the provider sent the browser back here.
			try {
				const { cloudService } = await import("../cloud/cloud-service");
				await cloudService.handleOAuthReturn(window.location.href);
			} catch (error) {
				const { useCloudStore } = await import("../cloud/cloud-store");
				const { CloudError } = await import("../cloud/model");
				useCloudStore
					.getState()
					.setOAuthReturnError(
						error instanceof CloudError
							? error.message
							: "Cloud authorization did not complete. Try connecting again.",
					);
			}
		});
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// Command palette toggle works everywhere except while typing.
			if (
				(e.ctrlKey || e.metaKey) &&
				!e.altKey &&
				e.key.toLowerCase() === "k"
			) {
				if (isTypingTarget(e.target)) return;
				e.preventDefault();
				setPaletteOpen((v) => !v);
				return;
			}
			// While the palette is open it owns the keyboard.
			if (paletteOpen) return;
			if ((e.ctrlKey || e.metaKey) && !e.altKey) {
				if (e.key === "ArrowLeft" && !isTypingTarget(e.target)) {
					e.preventDefault();
					previousTrack();
					return;
				}
				if (e.key === "ArrowRight" && !isTypingTarget(e.target)) {
					e.preventDefault();
					nextTrack();
					return;
				}
				return;
			}
			if (
				isTypingTarget(e.target) ||
				isInteractiveTarget(e.target) ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey
			)
				return;
			switch (e.key) {
				case " ":
				case "k":
					e.preventDefault();
					togglePlayback();
					break;
				case "ArrowLeft":
					e.preventDefault();
					seekBySeconds(-5);
					break;
				case "ArrowRight":
					e.preventDefault();
					seekBySeconds(5);
					break;
				case "m":
					usePlayerStore.getState().toggleMute();
					break;
				case "q":
					setQueueOpen((v) => !v);
					break;
				case "e":
					navigate("eq");
					break;
				case "f":
					navigate("tracks");
					break;
				case "l":
					setNowPlayingTab("lyrics");
					setNowPlaying(true);
					break;
				case "v":
					setNowPlayingTab("visuals");
					setNowPlaying(true);
					break;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate, paletteOpen]);

	return (
		<div
			onDragEnter={(e) => {
				if (!e.dataTransfer?.types.includes("Files")) return;
				e.preventDefault();
				dragDepth.current += 1;
				setDragging(true);
			}}
			onDragOver={(e) => e.preventDefault()}
			onDragLeave={(e) => {
				e.preventDefault();
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) setDragging(false);
			}}
			onDrop={(e) => {
				e.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				if (e.dataTransfer?.files.length)
					void importFiles(e.dataTransfer.files);
			}}
			className="h-dvh"
		>
			<AppShell
				route={route}
				onNavigate={navigate}
				onOpenNowPlaying={() => setNowPlaying(true)}
				onOpenQueue={() => setQueueOpen(true)}
				showPlayerBar={!nowPlaying}
				queueOpen={queueOpen}
				onToggleQueue={() => setQueueOpen((v) => !v)}
				onOpenDevices={() => navigate("devices")}
			>
				{nowPlaying ? (
					<NowPlayingView
						onClose={() => setNowPlaying(false)}
						onOpenQueue={() => setQueueOpen(true)}
						onOpenDsp={() => navigate("dsp")}
						onOpenDevices={() => navigate("devices")}
						initialTab={nowPlayingTab}
					/>
				) : route === "tracks" ||
					route === "albums" ||
					route === "artists" ||
					route === "genres" ||
					route === "recent" ||
					route === "favorites" ? (
					<MusicView
						key={route}
						initialTab={musicTabForRoute(route)}
						onOpenPlaylist={(id) => {
							setPendingPlaylistId(id);
							navigate("playlists");
						}}
						onOpenCloudSources={() => navigate("settings")}
					/>
				) : route === "playlists" ? (
					<PlaylistsView
						externalOpenId={pendingPlaylistId}
						onExternalOpenConsumed={() => setPendingPlaylistId(null)}
					/>
				) : route === "eq" || route === "dsp" ? (
					<AudioTuningView
						tab={route === "dsp" ? "dsp" : "eq"}
						onTab={(t) => navigate(t === "dsp" ? "dsp" : "eq")}
						onOpenDevices={() => navigate("devices")}
						onOpenGuide={openGuide}
					/>
				) : route === "iem" ? (
					<IEMView />
				) : route === "devices" ? (
					<DevicesView onOpenGuide={openGuide} />
				) : route === "guides" ? (
					<GuidesView key={guideNonce} />
				) : (
					<SettingsView
						onOpenMusic={() => navigate("tracks")}
						onOpenTuning={(t: "eq" | "dsp") =>
							navigate(t === "dsp" ? "dsp" : "eq")
						}
						onOpenDevices={() => navigate("iem")}
						onOpenPlaylists={() => navigate("playlists")}
						onOpenGuides={() => navigate("guides")}
					/>
				)}
			</AppShell>
			<QueuePanel
				open={queueOpen}
				onClose={() => setQueueOpen(false)}
				onOpenPlaylists={() => {
					setQueueOpen(false);
					navigate("playlists");
				}}
			/>
			<CommandPalette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				onNavigate={navigate}
				onOpenQueue={() => setQueueOpen(true)}
				onOpenNowPlaying={() => setNowPlaying(true)}
			/>
			{dragging ? (
				<div
					aria-hidden="true"
					className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-accent bg-abyss/80"
				>
					<p className="rounded-full bg-elevated px-6 py-3 text-lg font-semibold">
						Drop to add music
					</p>
				</div>
			) : null}
		</div>
	);
}
