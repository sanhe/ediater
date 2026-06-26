// Generates a placeholder 1024x1024 app-icon.png (no external deps).
// Run `pnpm tauri icon app-icon.png` afterwards to populate src-tauri/icons.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;
const stride = W * 4;

// Raw image buffer: each scanline is prefixed with a filter byte (0 = none).
const raw = Buffer.alloc((stride + 1) * H);

const ACCENT = [0x2f, 0x7d, 0xd1, 0xff];
const PAGE = [0xf4, 0xf4, 0xf4, 0xff];
const LINE = [0x9a, 0xbf, 0xe6, 0xff];

function px(x, y, c) {
  const o = y * (stride + 1) + 1 + x * 4;
  raw[o] = c[0];
  raw[o + 1] = c[1];
  raw[o + 2] = c[2];
  raw[o + 3] = c[3];
}

// Background.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) px(x, y, ACCENT);
}

// Rounded "page" rectangle.
const x0 = 232;
const y0 = 192;
const x1 = 792;
const y1 = 832;
const rad = 56;
function inRoundRect(x, y) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const inX = x >= x0 + rad && x <= x1 - rad;
  const inY = y >= y0 + rad && y <= y1 - rad;
  if (inX || inY) return true;
  const cx = x < x0 + rad ? x0 + rad : x1 - rad;
  const cy = y < y0 + rad ? y0 + rad : y1 - rad;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) if (inRoundRect(x, y)) px(x, y, PAGE);
}

// "Text" lines on the page.
const lx0 = 304;
const lx1 = 720;
for (let i = 0; i < 5; i++) {
  const ly = 300 + i * 92;
  const right = i % 2 === 0 ? lx1 : lx1 - 132;
  for (let y = ly; y < ly + 36; y++) {
    for (let x = lx0; x <= right; x++) px(x, y, LINE);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = new URL("../app-icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote app-icon.png (${png.length} bytes)`);
