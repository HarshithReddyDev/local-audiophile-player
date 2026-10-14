import { useMemo, useState } from "react";
import {
	consumePendingGuide,
	GUIDE_CATEGORIES,
	GUIDES,
	guideById,
} from "./guides-data";

/** In-app Help/Guides browser: categories, search, structured sections. */
export function GuidesView({ initialGuideId }: { initialGuideId?: string }) {
	const [category, setCategory] = useState<string>("All");
	const [query, setQuery] = useState("");
	const [openId, setOpenId] = useState<string | null>(() => {
		if (initialGuideId && guideById(initialGuideId)) return initialGuideId;
		return consumePendingGuide() ?? "getting-started";
	});
	// Controlled disclosure state per guide section (native <details> + React
	// state so re-renders never collapse what the user opened).
	const [manual, setManual] = useState<Record<string, boolean>>({});

	const results = useMemo(() => {
		const q = query.trim().toLowerCase();
		return GUIDES.filter((g) => {
			if (category !== "All" && g.category !== category) return false;
			if (!q) return true;
			return `${g.title} ${g.summary} ${g.sections.map((s) => s.heading).join(" ")}`
				.toLowerCase()
				.includes(q);
		});
	}, [category, query]);

	const open = openId ? (guideById(openId) ?? null) : null;

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-2xl font-bold tracking-tight">Guides</h2>
				<p className="text-sm text-muted">
					Practical audio help, written for listeners — not developer docs.
				</p>
			</div>
			<div className="flex flex-col gap-2 lg:flex-row">
				<nav
					aria-label="Guide categories"
					className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col lg:overflow-visible"
				>
					{["All", ...GUIDE_CATEGORIES].map((c) => (
						<button
							key={c}
							type="button"
							onClick={() => setCategory(c)}
							aria-pressed={category === c}
							className={`shrink-0 rounded-full px-3 py-1.5 text-left text-[13px] lg:rounded-lg ${
								category === c
									? "bg-elevated font-semibold text-ink"
									: "text-muted hover:bg-elevated/60 hover:text-ink"
							}`}
						>
							{c}
						</button>
					))}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col gap-3">
					<label className="sr-only" htmlFor="guide-search">
						Search guides
					</label>
					<input
						id="guide-search"
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search guides…"
						className="w-full rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-muted"
					/>
					<ul className="flex flex-col gap-1.5">
						{results.map((g) => (
							<li key={g.id}>
								<button
									type="button"
									onClick={() => {
										setOpenId(openId === g.id ? null : g.id);
										setManual({});
									}}
									aria-expanded={openId === g.id}
									className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
										openId === g.id
											? "border-accent/50 bg-surface"
											: "border-line bg-surface hover:bg-elevated/60"
									}`}
								>
									<span className="flex items-baseline gap-2">
										<span className="text-sm font-semibold">{g.title}</span>
										<span className="text-[11px] text-muted">{g.category}</span>
									</span>
									<span className="mt-0.5 block text-xs text-muted">
										{g.summary}
									</span>
								</button>
								{openId === g.id && open && open.id === g.id ? (
									<article
										aria-label={`${open.title} guide`}
										className="mt-1.5 flex flex-col gap-2 rounded-xl border border-line bg-abyss p-3"
									>
										{open.sections.map((s, i) => {
											const key = `${open.id}-${i}`;
											const expanded =
												manual[key] ?? (open.sections.length <= 3 || i < 2);
											return (
												<details
													key={key}
													open={expanded}
													onToggle={(e) => {
														// Capture synchronously: the synthetic event is
														// pooled (StrictMode double-invokes updaters).
														const isOpen = e.currentTarget.open;
														setManual((prev) => ({
															...prev,
															[key]: isOpen,
														}));
													}}
													className="rounded-lg border border-line bg-surface px-3 py-2"
												>
													<summary className="cursor-pointer text-sm font-semibold hover:text-accent">
														{s.heading}
													</summary>
													<div className="flex flex-col gap-2 pt-2 pb-1">
														{s.paragraphs?.map((p, j) => (
															<p
																key={j}
																className="text-[13px] leading-relaxed text-ink/90"
															>
																{p}
															</p>
														))}
														{s.bullets ? (
															<ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-ink/90">
																{s.bullets.map((b, j) => (
																	<li key={j}>{b}</li>
																))}
															</ul>
														) : null}
														{s.table ? (
															<div className="overflow-x-auto">
																<table className="w-full text-left text-xs">
																	<thead>
																		<tr className="text-muted">
																			{s.table.head.map((h) => (
																				<th
																					key={h}
																					className="border-b border-line px-2 py-1 font-semibold"
																				>
																					{h}
																				</th>
																			))}
																		</tr>
																	</thead>
																	<tbody>
																		{s.table.rows.map((row, j) => (
																			<tr
																				key={j}
																				className="border-b border-line/50 last:border-0"
																			>
																				{row.map((cell, k) => (
																					<td
																						key={k}
																						className="px-2 py-1 align-top"
																					>
																						{cell}
																					</td>
																				))}
																			</tr>
																		))}
																	</tbody>
																</table>
															</div>
														) : null}
														{s.callout ? (
															<p
																role="note"
																className={`rounded-lg border px-2.5 py-2 text-xs leading-relaxed ${
																	s.callout.kind === "warning"
																		? "border-amber-400/40 bg-amber-400/10"
																		: s.callout.kind === "tip"
																			? "border-accent/40 bg-accent/10"
																			: "border-line bg-elevated/60 text-muted"
																}`}
															>
																{s.callout.text}
															</p>
														) : null}
													</div>
												</details>
											);
										})}
									</article>
								) : null}
							</li>
						))}
					</ul>
					{results.length === 0 ? (
						<p className="rounded-xl border border-line bg-surface p-4 text-center text-sm text-muted">
							No guides match. Try a different search or category.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
