/**
 * Cloud connection state (zustand). Durable account records mirror the
 * library's cloud LibrarySources; tokens never enter this store.
 *
 * - accounts: connected cloud accounts (persisted to localStorage AND
 *   mirrored as kind:'cloud' library sources for track linkage).
 * - connectionStatus: live per-account status (memory).
 * - trackStatus: transient per-track availability (memory only — a
 *   temporarily offline provider must never corrupt persisted tracks).
 */

import { create } from "zustand";
import { loadPrefs, savePrefs } from "../storage/persistence";
import {
	type CloudAccount,
	type CloudConnectionStatus,
	type CloudProviderId,
	type RemoteTrackStatus,
} from "./model";

export interface CloudBrowserState {
	accountId: string;
	folderId: string;
	folderName: string;
}

interface CloudState {
	accounts: Record<string, CloudAccount>;
	statuses: Record<string, CloudConnectionStatus>;
	trackStatuses: Record<string, RemoteTrackStatus>;
	browser: CloudBrowserState | null;
	/** Failed OAuth-return message from boot (shown in the sources UI). */
	oauthReturnError: string | null;

	upsertAccount: (account: CloudAccount) => void;
	removeAccount: (id: string) => void;
	setStatus: (id: string, status: CloudConnectionStatus) => void;
	setTrackStatus: (trackId: string, status: RemoteTrackStatus) => void;
	clearTrackStatuses: (accountId: string) => void;
	setBrowser: (browser: CloudBrowserState | null) => void;
	setOAuthReturnError: (message: string | null) => void;
	resetForTests: () => void;
}

const STORAGE_KEY = "cloud-accounts";

function loadAccounts(): Record<string, CloudAccount> {
	const raw = loadPrefs<Record<string, CloudAccount>>(STORAGE_KEY, {});
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const out: Record<string, CloudAccount> = {};
	for (const [id, value] of Object.entries(raw)) {
		if (typeof value !== "object" || value === null) continue;
		const account = value as Partial<CloudAccount>;
		if (
			typeof account.provider !== "string" ||
			typeof account.accountId !== "string"
		) {
			continue;
		}
		out[id] = {
			id,
			provider: account.provider as CloudProviderId,
			accountId: account.accountId,
			accountLabel:
				typeof account.accountLabel === "string" ? account.accountLabel : id,
			status: "disconnected",
			scopes: Array.isArray(account.scopes)
				? account.scopes.filter((s): s is string => typeof s === "string")
				: [],
			connectedAt:
				typeof account.connectedAt === "number" ? account.connectedAt : 0,
			lastSyncedAt:
				typeof account.lastSyncedAt === "number" ? account.lastSyncedAt : null,
			lastError: null,
		};
	}
	return out;
}

function persist(accounts: Record<string, CloudAccount>): void {
	const slim: Record<string, CloudAccount> = {};
	for (const [id, account] of Object.entries(accounts)) {
		slim[id] = { ...account, status: "disconnected", lastError: null };
	}
	savePrefs(STORAGE_KEY, slim);
}

const initial = loadAccounts();

export const useCloudStore = create<CloudState>()((set, get) => ({
	accounts: initial,
	statuses: Object.fromEntries(
		Object.keys(initial).map((id) => [
			id,
			"disconnected" as CloudConnectionStatus,
		]),
	),
	trackStatuses: {},
	browser: null,
	oauthReturnError: null,

	upsertAccount: (account) => {
		const accounts = { ...get().accounts, [account.id]: account };
		set({
			accounts,
			statuses: { ...get().statuses, [account.id]: account.status },
		});
		persist(accounts);
	},

	removeAccount: (id) => {
		const accounts = { ...get().accounts };
		delete accounts[id];
		const statuses = { ...get().statuses };
		delete statuses[id];
		set({ accounts, statuses });
		persist(accounts);
	},

	setStatus: (id, status) => {
		set({ statuses: { ...get().statuses, [id]: status } });
		const account = get().accounts[id];
		if (account && account.status !== status) {
			const accounts = { ...get().accounts, [id]: { ...account, status } };
			set({ accounts });
			persist(accounts);
		}
	},

	setTrackStatus: (trackId, status) => {
		if (get().trackStatuses[trackId] === status) return;
		set({ trackStatuses: { ...get().trackStatuses, [trackId]: status } });
	},

	clearTrackStatuses: (accountId) => {
		void accountId;
		// Track→account mapping lives in the library store; the service
		// passes explicit track id lists when clearing after disconnect.
		set({ trackStatuses: {} });
	},

	setBrowser: (browser) => set({ browser }),

	setOAuthReturnError: (message) => set({ oauthReturnError: message }),

	resetForTests: () => {
		set({
			accounts: {},
			statuses: {},
			trackStatuses: {},
			browser: null,
			oauthReturnError: null,
		});
		persist({});
	},
}));

/** Accounts for one provider, most-recently-connected first. */
export function accountsFor(
	accounts: Record<string, CloudAccount>,
	provider: CloudProviderId,
): CloudAccount[] {
	return Object.values(accounts)
		.filter((a) => a.provider === provider)
		.sort((a, b) => b.connectedAt - a.connectedAt);
}
