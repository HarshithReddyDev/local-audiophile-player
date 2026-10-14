/**
 * Cloud music sources: connect cloud-storage accounts and manage them.
 *
 * Honest capability states throughout: unconfigured (no OAuth client id
 * yet), disconnected, auth-required, connected, error. Provider cards
 * show the exact scopes a login will request before anything happens.
 * No audio is ever downloaded here — browsing and importing store
 * metadata references only.
 */

import { useMemo, useState } from "react";
import { cloudService } from "../../cloud/cloud-service";
import { accountsFor, useCloudStore } from "../../cloud/cloud-store";
import type { CloudProviderId } from "../../cloud/model";
import { CLOUD_PROVIDERS, CloudError } from "../../cloud/model";
import { getClientId, setClientId } from "../../cloud/token-store";
import { useLibraryStore } from "../../state/library-store";
import { LearnLink } from "../guides/LearnLink";
import { CloudBrowser } from "./CloudBrowser";

const DRIVE_BROAD_NOTE =
	"Folder browsing needs the restricted Drive read-only scope (Google must verify the app for production use). Per-file access via Browse stays on the narrow scope.";

export function CloudSources() {
	const accounts = useCloudStore((s) => s.accounts);
	const browser = useCloudStore((s) => s.browser);
	const oauthReturnError = useCloudStore((s) => s.oauthReturnError);
	const [setupFor, setSetupFor] = useState<CloudProviderId | null>(null);

	if (browser) {
		return <CloudBrowser accountId={browser.accountId} />;
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-start gap-2">
				<p className="flex-1 text-xs text-muted">
					Play music stored in your own cloud accounts. Only file metadata
					enters the library — audio streams at play time and your local files
					are never uploaded.
				</p>
				<LearnLink guideId="cloud" />
			</div>
			{oauthReturnError ? (
				<p role="alert" className="text-xs text-red-300">
					{oauthReturnError}
				</p>
			) : null}
			{CLOUD_PROVIDERS.map((meta) => (
				<ProviderCard
					key={meta.id}
					providerId={meta.id}
					setupOpen={setupFor === meta.id}
					onToggleSetup={() =>
						setSetupFor((current) => (current === meta.id ? null : meta.id))
					}
				/>
			))}
			{Object.keys(accounts).length === 0 ? (
				<p className="text-xs text-muted">
					No cloud accounts connected. Your library and playlists are
					unaffected.
				</p>
			) : null}
		</div>
	);
}

function ProviderCard({
	providerId,
	setupOpen,
	onToggleSetup,
}: {
	providerId: CloudProviderId;
	setupOpen: boolean;
	onToggleSetup: () => void;
}) {
	const meta = CLOUD_PROVIDERS.find((p) => p.id === providerId);
	const allAccounts = useCloudStore((s) => s.accounts);
	const accounts = useMemo(
		() => accountsFor(allAccounts, providerId),
		[allAccounts, providerId],
	);
	const statuses = useCloudStore((s) => s.statuses);
	const [clientId, setClientIdInput] = useState<string | null>(null);
	const [broadAccess, setBroadAccess] = useState(false);
	const [remember, setRemember] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	if (!meta) return null;
	const configured = getClientId(providerId) !== null;

	const connect = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await cloudService.connect(providerId, {
				broadAccess: providerId === "google-drive" ? broadAccess : undefined,
				remember,
			});
			if (!result.finished) {
				setNotice(
					"Sent to the provider to authorize — complete sign-in there.",
				);
			}
			onToggleSetupClose();
		} catch (e) {
			setError(
				e instanceof CloudError ? e.message : "Could not start authorization.",
			);
		} finally {
			setBusy(false);
		}
	};

	const onToggleSetupClose = () => {
		// Collapse the setup panel after a successful connect start.
		if (setupOpen) onToggleSetup();
	};

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">{meta.label}</span>
					<span className="block text-xs text-muted">{meta.description}</span>
				</span>
				{accounts.length === 0 ? (
					configured ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => void connect()}
							className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
						>
							{busy ? "Connecting…" : "Connect"}
						</button>
					) : (
						<button
							type="button"
							onClick={onToggleSetup}
							className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
						>
							Set up
						</button>
					)
				) : null}
				<button
					type="button"
					onClick={onToggleSetup}
					aria-expanded={setupOpen}
					className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-elevated"
				>
					{setupOpen
						? "Hide setup"
						: configured
							? "App setup"
							: "What’s needed"}
				</button>
			</div>
			{setupOpen ? (
				<ProviderSetup
					providerId={providerId}
					clientId={clientId}
					onClientId={setClientIdInput}
					broadAccess={broadAccess}
					onBroadAccess={setBroadAccess}
					remember={remember}
					onRemember={setRemember}
					busy={busy}
					error={error}
					onConnect={() => void connect()}
				/>
			) : error ? (
				<p role="alert" className="text-xs text-red-300">
					{error}
				</p>
			) : notice ? (
				<p role="status" className="text-xs text-muted">
					{notice}
				</p>
			) : null}
			{accounts.map((account) => (
				<AccountRow
					key={account.id}
					accountId={account.id}
					status={statuses[account.id] ?? "disconnected"}
				/>
			))}
		</div>
	);
}

function ProviderSetup({
	providerId,
	clientId,
	onClientId,
	broadAccess,
	onBroadAccess,
	remember,
	onRemember,
	busy,
	error,
	onConnect,
}: {
	providerId: CloudProviderId;
	clientId: string | null;
	onClientId: (value: string) => void;
	broadAccess: boolean;
	onBroadAccess: (value: boolean) => void;
	remember: boolean;
	onRemember: (value: boolean) => void;
	busy: boolean;
	error: string | null;
	onConnect: () => void;
}) {
	const saved = getClientId(providerId);
	const scopes = cloudService.scopesPreview(providerId, {
		broadAccess: providerId === "google-drive" ? broadAccess : undefined,
	});
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-line bg-abyss/40 p-3 text-xs">
			<p className="text-muted">
				This app has no server, so it cannot ship its own provider credentials.
				Create a free OAuth app with the provider, then paste its public client
				ID here — it stays on this device. No client secrets are ever used or
				stored. See <span className="text-ink">docs/cloud-music.md §setup</span>{" "}
				for exact steps.
			</p>
			<label className="flex flex-col gap-1">
				<span className="font-medium">OAuth client ID</span>
				<input
					type="text"
					value={clientId ?? saved ?? ""}
					placeholder="e.g. 1234….apps.googleusercontent.com"
					onChange={(e) => {
						onClientId(e.target.value);
						setClientId(providerId, e.target.value);
					}}
					className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none"
				/>
			</label>
			{providerId === "google-drive" ? (
				<label className="flex items-start gap-2 text-muted">
					<input
						type="checkbox"
						checked={broadAccess}
						onChange={(e) => onBroadAccess(e.target.checked)}
						className="mt-0.5"
					/>
					<span>
						Browse whole folders (restricted read-only scope).
						<span className="block">{DRIVE_BROAD_NOTE}</span>
					</span>
				</label>
			) : null}
			<label className="flex items-start gap-2 text-muted">
				<input
					type="checkbox"
					checked={remember}
					onChange={(e) => onRemember(e.target.checked)}
					className="mt-0.5"
				/>
				<span>
					Remember this connection on this device (keeps a refresh token locally
					so sign-in survives reloads; access tokens stay in memory only).
				</span>
			</label>
			<div>
				<span className="font-medium">Permissions requested:</span>
				<ul className="list-disc pl-5 text-muted">
					{scopes.map((scope) => (
						<li key={scope}>{scope}</li>
					))}
				</ul>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					disabled={busy || (clientId ?? saved ?? "").trim() === ""}
					onClick={onConnect}
					className="rounded-full bg-accent px-3 py-1 font-semibold text-accent-ink disabled:opacity-50"
				>
					{busy ? "Connecting…" : "Connect"}
				</button>
				{error ? (
					<span role="alert" className="text-red-300">
						{error}
					</span>
				) : null}
			</div>
		</div>
	);
}

function AccountRow({
	accountId,
	status,
}: {
	accountId: string;
	status: string;
}) {
	const account = useCloudStore((s) => s.accounts[accountId]);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshInfo, setRefreshInfo] = useState<string | null>(null);
	if (!account) return null;

	const run = async (label: string, task: () => Promise<unknown>) => {
		setBusy(label);
		setError(null);
		try {
			await task();
		} catch (e) {
			setError(
				e instanceof CloudError ? e.message : "That didn’t work. Try again.",
			);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="flex flex-col gap-1 rounded-lg border border-line bg-abyss/40 p-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="block truncate text-xs font-medium">
						{account.accountLabel}
					</span>
					<span className="block truncate text-[11px] text-muted">
						{statusLabel(status)}
						{account.lastSyncedAt
							? ` • synced ${new Date(account.lastSyncedAt).toLocaleDateString()}`
							: ""}
					</span>
				</span>
				<button
					type="button"
					disabled={busy !== null}
					onClick={() =>
						useCloudStore.getState().setBrowser({
							accountId,
							folderId: "",
							folderName: "",
						})
					}
					className="rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-ink disabled:opacity-50"
				>
					Browse
				</button>
				<button
					type="button"
					disabled={busy !== null}
					onClick={() =>
						void run("Refreshing…", async () => {
							const result = await cloudService.refreshSource(
								accountId,
								() => undefined,
							);
							setRefreshInfo(
								`Checked ${result.checked}: ${result.updated} updated, ${result.missing} removed.`,
							);
						})
					}
					className="rounded-full border border-line px-3 py-1 text-[11px] hover:bg-elevated disabled:opacity-50"
				>
					Refresh
				</button>
				<button
					type="button"
					disabled={busy !== null}
					onClick={() =>
						void run("Disconnecting…", () => cloudService.disconnect(accountId))
					}
					className="rounded-full border border-line px-3 py-1 text-[11px] hover:bg-elevated disabled:opacity-50"
				>
					Disconnect
				</button>
				{status === "disconnected" ||
				status === "auth-required" ||
				status === "error" ? (
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							void run("Connecting…", () =>
								cloudService.connect(account.provider, {
									broadAccess:
										account.provider === "google-drive"
											? account.scopes.some((s) => s.includes("drive.readonly"))
											: undefined,
									remember: true,
								}),
							)
						}
						className="rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-ink disabled:opacity-50"
					>
						Reconnect
					</button>
				) : null}
				<button
					type="button"
					disabled={busy !== null}
					onClick={() => {
						if (
							window.confirm(
								"Remove this cloud source? Playlists, history, and ratings stay; its tracks become unavailable until you reconnect.",
							)
						) {
							void run("Removing…", () => cloudService.removeSource(accountId));
						}
					}}
					className="rounded-full border border-line px-3 py-1 text-[11px] text-muted hover:bg-elevated disabled:opacity-50"
				>
					Remove
				</button>
			</div>
			{busy ? (
				<span role="status" className="text-[11px] text-muted">
					{busy}
				</span>
			) : null}
			{refreshInfo && !busy ? (
				<span role="status" className="text-[11px] text-accent">
					{refreshInfo}
				</span>
			) : null}
			{error ? (
				<span role="alert" className="text-[11px] text-red-300">
					{error}
				</span>
			) : null}
			<CloudTrackCount accountId={accountId} />
		</div>
	);
}

function CloudTrackCount({ accountId }: { accountId: string }) {
	const tracks = useLibraryStore((s) => s.tracks);
	const { count, missing } = useMemo(() => {
		let count = 0;
		let missing = 0;
		for (const t of Object.values(tracks)) {
			if (t.remote?.accountId !== accountId) continue;
			if (t.missing) missing += 1;
			else count += 1;
		}
		return { count, missing };
	}, [tracks, accountId]);
	if (count === 0 && missing === 0) {
		return (
			<span className="text-[11px] text-muted">
				No files added yet — Browse and add audio to build this source’s
				library.
			</span>
		);
	}
	return (
		<span className="text-[11px] text-muted">
			{count} track{count === 1 ? "" : "s"} in library
			{missing > 0 ? ` • ${missing} unavailable` : ""} (metadata only — nothing
			downloaded)
		</span>
	);
}

function statusLabel(status: string): string {
	switch (status) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting…";
		case "auth-required":
			return "Needs sign-in";
		case "disconnected":
			return "Disconnected";
		case "unconfigured":
			return "Needs setup";
		case "error":
			return "Attention needed";
		default:
			return status;
	}
}
