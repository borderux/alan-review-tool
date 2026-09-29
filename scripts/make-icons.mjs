#!/usr/bin/env node
// Generates the extension icon in the four sizes the manifests list
// (16, 32, 48 and 128 px) from one source image:
//
//     npm run icons -- path/to/source.png
//
// Writes src/icons/icon-16.png ... icon-128.png, which build.js copies into
// dist/chrome and dist/firefox. Commit those four files.
//
// Dependency-free on purpose: a small PNG reader and writer on top of
// Node's built-in zlib, and an area-averaging resize (each output pixel is
// the coverage-weighted average of the source pixels under it, with
// premultiplied alpha so transparent edges don't turn dark).
//
// The source must be a PNG, not interlaced, at 8 or 16 bits per channel
// (greyscale, RGB, palette or with alpha - what image editors export).
// Use a square image of at least 128 px; a non-square one is centred on a
// transparent square.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 128];
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outDir = path.join(rootDir, "src", "icons");
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---------- PNG reading ----------

function readPng(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE))
    throw new Error(`${file} is not a PNG file.`);
  let pos = 8;
  let header;
  let palette;
  let transparency;
  const data = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
  }
  if (!header) throw new Error(`${file} has no PNG header.`);
  const { width, height, bitDepth, colorType, interlace } = header;
  if (interlace !== 0)
    throw new Error("The PNG is interlaced. Re-export it without interlacing.");
  if (bitDepth !== 8 && bitDepth !== 16)
    throw new Error(
      `Unsupported bit depth ${bitDepth}. Export at 8 or 16 bits.`,
    );
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}.`);
  if (colorType === 3 && bitDepth !== 8)
    throw new Error("Palette PNGs must be 8-bit. Export as RGBA instead.");

  const bytesPerSample = bitDepth / 8;
  const bpp = channels * bytesPerSample;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = value & 0xff;
    }
    prev = out;
  }

  // To 8-bit RGBA.
  const rgba = new Uint8Array(width * height * 4);
  const sample = (i, k) => pixels[i * bpp + k * bytesPerSample];
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 0) {
      r = g = b = sample(i, 0);
    } else if (colorType === 2) {
      r = sample(i, 0);
      g = sample(i, 1);
      b = sample(i, 2);
    } else if (colorType === 3) {
      const index = pixels[i];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      if (transparency && index < transparency.length) a = transparency[index];
    } else if (colorType === 4) {
      r = g = b = sample(i, 0);
      a = sample(i, 1);
    } else {
      r = sample(i, 0);
      g = sample(i, 1);
      b = sample(i, 2);
      a = sample(i, 3);
    }
    rgba.set([r, g, b, a], i * 4);
  }
  return { width, height, rgba };
}

// ---------- Resizing ----------

// Centres a non-square image on a transparent square.
function toSquare({ width, height, rgba }) {
  if (width === height) return { size: width, rgba };
  const size = Math.max(width, height);
  const out = new Uint8Array(size * size * 4);
  const ox = Math.floor((size - width) / 2);
  const oy = Math.floor((size - height) / 2);
  for (let y = 0; y < height; y += 1) {
    out.set(
      rgba.subarray(y * width * 4, (y + 1) * width * 4),
      ((y + oy) * size + ox) * 4,
    );
  }
  return { size, rgba: out };
}

function resize({ size: src, rgba }, size) {
  const out = new Uint8Array(size * size * 4);
  const scale = src / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = y * scale;
    const y1 = y0 + scale;
    for (let x = 0; x < size; x += 1) {
      const x0 = x * scale;
      const x1 = x0 + scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;
      for (
        let sy = Math.floor(y0);
        sy < Math.min(src, Math.ceil(y1));
        sy += 1
      ) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (
          let sx = Math.floor(x0);
          sx < Math.min(src, Math.ceil(x1));
          sx += 1
        ) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * src + sx) * 4;
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha * w;
          g += rgba[i + 1] * alpha * w;
          b += rgba[i + 2] * alpha * w;
          a += alpha * w;
          total += w;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / total) * 255);
    }
  }
  return out;
}

// ---------- PNG writing ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function writePng(file, size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  fs.writeFileSync(
    file,
    Buffer.concat([
      SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

// ---------- Main ----------

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run icons -- path/to/source.png");
  process.exit(1);
}
try {
  const square = toSquare(readPng(source));
  if (square.size < 128)
    console.warn(
      `Warning: the source is ${square.size}px; 128px or larger gives a sharper icon.`,
    );
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    const file = path.join(outDir, `icon-${size}.png`);
    writePng(file, size, resize(square, size));
    console.log(`Wrote ${path.relative(rootDir, file)}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
