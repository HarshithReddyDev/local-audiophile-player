/**
 * Generates PWA icons with zero dependencies (pure Node + zlib).
 * Run: `node scripts/generate-icons.mjs`
 *
 * Design: dark rounded square with five audio bars. The maskable variant
 * is full-bleed with a larger safe-zone padding. Outputs are committed to
 * public/icons/ so the static build and service worker stay base-path safe.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const BG = [11, 14, 20];
const ACCENT = [134, 197, 255];
const DIM = [58, 82, 112];
const BAR_PATTERN = [0.34, 0.58, 0.88, 0.58, 0.34];

function crc32(bytes) {
	let table = crc32.table;
	if (!table) {
		table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c;
		}
		crc32.table = table;
	}
	let crc = 0xffffffff;
	for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function hex([r, g, b]) {
	return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Draws the icon into an RGBA buffer. Returns { pixels, svg }. */
function draw(size, { rounded, pad }) {
	const px = Buffer.alloc(size * size * 4);
	const radius = rounded ? Math.round(size * 0.22) : 0;
	const barArea = size * (1 - pad * 2);
	const barW = barArea / (BAR_PATTERN.length * 2 - 1);
	const gap = barW;
	const startX =
		(size - (barW * BAR_PATTERN.length + gap * (BAR_PATTERN.length - 1))) / 2;

	const inRoundRect = (x, y) => {
		if (radius === 0) return true;
		const cx = Math.min(Math.max(x, radius), size - radius);
		const cy = Math.min(Math.max(y, radius), size - radius);
		const dx = x - cx;
		const dy = y - cy;
		return dx * dx + dy * dy <= radius * radius;
	};

	// Bars geometry (shared with the SVG below).
	const bars = BAR_PATTERN.map((h, i) => {
		const bw = Math.max(1, Math.round(barW));
		const bh = Math.max(1, Math.round(h * barArea));
		const bx = Math.round(startX + i * (barW + gap));
		const by = Math.round((size - bh) / 2);
		return {
			bx,
			by,
			bw,
			bh,
			color: i === 2 ? ACCENT : i % 2 === 0 ? DIM : ACCENT,
		};
	});

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const o = (y * size + x) * 4;
			if (!inRoundRect(x + 0.5, y + 0.5)) {
				px[o + 3] = 0; // transparent corner
				continue;
			}
			let c = BG;
			for (const bar of bars) {
				if (
					x >= bar.bx &&
					x < bar.bx + bar.bw &&
					y >= bar.by &&
					y < bar.by + bar.bh
				) {
					c = bar.color;
					break;
				}
			}
			px[o] = c[0];
			px[o + 1] = c[1];
			px[o + 2] = c[2];
			px[o + 3] = 255;
		}
	}
	return { px, bars };
}

function encodePng(size, px) {
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // filter: none
		px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // truecolor + alpha
	const png = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
	return png;
}

function buildSvg(size, rounded, pad, bars) {
	const r = rounded ? size * 0.22 : 0;
	const rects = bars
		.map(
			(b) =>
				`<rect x="${b.bx}" y="${b.by}" width="${b.bw}" height="${b.bh}" rx="${Math.min(b.bw / 2, 2)}" fill="${hex(b.color)}"/>`,
		)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${hex(BG)}"/>${rects}</svg>\n`;
}

const targets = [
	{ file: "icon-192.png", size: 192, rounded: true, pad: 0.24 },
	{ file: "icon-512.png", size: 512, rounded: true, pad: 0.24 },
	{ file: "icon-maskable-512.png", size: 512, rounded: false, pad: 0.32 },
	{ file: "apple-touch-icon.png", size: 180, rounded: false, pad: 0.24 },
];

for (const t of targets) {
	const { px, bars } = draw(t.size, t);
	writeFileSync(join(outDir, t.file), encodePng(t.size, px));
	if (t.file === "icon-512.png") {
		writeFileSync(join(outDir, "icon.svg"), buildSvg(512, true, t.pad, bars));
	}
	console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
