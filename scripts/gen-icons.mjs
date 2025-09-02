import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

function drawIcon(size, { maskable = false } = {}) {
  const png = new PNG({ width: size, height: size });
  // helper to set pixel
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const idx = (size * y + x) << 2;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = a;
  };
  const fill = (x0, y0, w, h, r, g, b, a = 255) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, r, g, b, a);
  };

  // background (maskable: add safe padding)
  fill(0, 0, size, size, 0, 0, 0, 255);
  const pad = maskable ? Math.round(size * 0.08) : Math.round(size * 0.12);
  const winX = pad;
  const winY = pad;
  const winW = size - pad * 2;
  const winH = size - pad * 2;
  // window background (deep blue)
  fill(winX, winY, winW, winH, 11, 37, 80, 255);
  // window top gradient strip
  fill(winX, winY, winW, Math.max(1, Math.round(winH * 0.12)), 15, 47, 96, 255);
  // white border
  const bw = Math.max(2, Math.round(size * 0.02));
  fill(winX, winY, winW, bw, 230, 242, 255, 255);
  fill(winX, winY + winH - bw, winW, bw, 230, 242, 255, 255);
  fill(winX, winY, bw, winH, 230, 242, 255, 255);
  fill(winX + winW - bw, winY, bw, winH, 230, 242, 255, 255);

  // Draw pixel letters "C Q" in the middle (pixelated style)
  const grid = Math.max(4, Math.floor(size / 64));
  const gx = winX + Math.round(winW * 0.18);
  const gy = winY + Math.round(winH * 0.28);
  const px = (x, y, w = 1, h = 1) =>
    fill(gx + x * grid, gy + y * grid, w * grid, h * grid, 255, 213, 94, 255);
  // C (5x7 style)
  for (let i = 0; i < 5; i++) px(i, 0);
  for (let i = 0; i < 5; i++) px(i, 6);
  for (let i = 1; i < 6; i++) px(0, i);
  // Q (outline)
  const ox = 9;
  for (let i = 0; i < 5; i++) px(ox + i, 0);
  for (let i = 0; i < 7; i++) {
    px(ox, i);
    px(ox + 4, i);
  }
  for (let i = 0; i < 5; i++) px(ox + i, 6);
  // tail of Q
  px(ox + 3, 5);
  px(ox + 5, 7);

  return png;
}

function savePng(png, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    png.pack().pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function main() {
  const outDir = path.join(process.cwd(), 'icons');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  await savePng(drawIcon(512), path.join(outDir, 'icon-512.png'));
  await savePng(drawIcon(192), path.join(outDir, 'icon-192.png'));
  await savePng(drawIcon(180), path.join(outDir, 'icon-180.png'));
  await savePng(drawIcon(512, { maskable: true }), path.join(outDir, 'maskable-512.png'));
  console.log('Generated icons in icons/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
