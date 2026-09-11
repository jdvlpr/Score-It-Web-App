// Renders the app icon to PNG at a few sizes, with no dependencies.
// Run: node tools/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const DOTS = ["#ff3b30", "#ffe814", "#35e63a", "#45e6ff", "#0a3cff", "#ff3fdd"];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function crc32(buf) {
  let c, table = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
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

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const ringR = size * 0.335, ringW = size * 0.155, dotR = size * 0.085, dotOrbit = ringR;
  const put = (x, y, [r, g, b], a) => {
    const i = (y * size + x) * 4;
    const ia = 1 - a;
    px[i] = px[i] * ia + r * a;
    px[i + 1] = px[i + 1] * ia + g * a;
    px[i + 2] = px[i + 2] * ia + b * a;
    px[i + 3] = Math.min(255, px[i + 3] * ia + 255 * a);
  };
  const cover = (d, edge) => Math.max(0, Math.min(1, (edge - d) / 1.5)); // 1.5px feather

  const track = hex("#232327"), bg = hex("#000000");
  const centers = DOTS.map((col, i) => {
    const a = (-90 - 180 / DOTS.length + (i * 360) / DOTS.length) * Math.PI / 180;
    return { col: hex(col), x: c + Math.cos(a) * dotOrbit, y: c + Math.sin(a) * dotOrbit };
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      put(x, y, bg, 1);
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const ring = Math.max(0, Math.min(1, Math.min((ringR + ringW / 2 - d) / 1.5, (d - (ringR - ringW / 2)) / 1.5)));
      if (ring > 0) put(x, y, track, ring);
      for (const dot of centers) {
        const dd = Math.hypot(x + 0.5 - dot.x, y + 0.5 - dot.y);
        const da = cover(dd, dotR);
        if (da > 0) put(x, y, dot.col, da);
      }
    }
  }

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const s of [180, 192, 512]) {
  writeFileSync(new URL(`../icon-${s}.png`, import.meta.url), png(s));
  console.log("icon-" + s + ".png");
}
