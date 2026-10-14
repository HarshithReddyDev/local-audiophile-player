import { useCallback, useState } from "react";
import { loadPrefs, savePrefs } from "../../storage/persistence";

const KEY = "builtin-preset-favorites";

function readFavorites(): string[] {
	try {
		const raw = loadPrefs<string[]>(KEY, []);
		return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
}

/** Built-in preset favorites: local-only id list, independent of user presets. */
export function useBuiltinFavorites(): {
	favorites: string[];
	isFavorite: (id: string) => boolean;
	toggle: (id: string) => void;
} {
	const [favorites, setFavorites] = useState<string[]>(readFavorites);
	const toggle = useCallback((id: string) => {
		setFavorites((prev) => {
			const next = prev.includes(id)
				? prev.filter((x) => x !== id)
				: [...prev, id];
			try {
				savePrefs(KEY, next);
			} catch {
				// Persistence is best-effort; the toggle still applies.
			}
			return next;
		});
	}, []);
	return {
		favorites,
		isFavorite: (id: string) => favorites.includes(id),
		toggle,
	};
}
