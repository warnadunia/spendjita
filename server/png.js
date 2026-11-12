'use strict';
/**
 * Minimal PNG encoder + rasteriser (no native deps).
 * Generates real PNG app icons for the PWA manifest / APK packaging.
 */
const zlib = require('zlib');

/* ------------------------------- CRC ------------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode an RGBA pixel buffer into a PNG.
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgba  length w*h*4
 */
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------------------- drawing ------------------------------ */
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mixRGBA(out, i, r, g, b, a) {
  out[i] = Math.round(lerp(out[i], r, a));
  out[i + 1] = Math.round(lerp(out[i + 1], g, a));
  out[i + 2] = Math.round(lerp(out[i + 2], b, a));
  out[i + 3] = Math.round(lerp(out[i + 3], a, a));
}
function setPx(buf, w, h, x, y, r, g, b, a) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  const i = (yi * w + xi) * 4;
  mixRGBA(buf, i, r, g, b, a);
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function roundedRectInside(x, y, w, h, r) {
  const cx = Math.min(x, w - x);
  const cy = Math.min(y, h - y);
  if (cx < r && cy < r) {
    const dx = r - cx;
    const dy = r - cy;
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

/**
 * Rasterise the app icon: gradient background, soft glow circles,
 * a white circular badge and a checkmark (attendance = presence).
 */
function renderIcon(size, opts) {
  const o = opts || {};
  const [c1, c2] = o.colors || ['#6366f1', '#22d3ee'];
  const buf = new Uint8Array(size * size * 4);
  const R = [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];
  const G = [parseInt(c2.slice(1, 3), 16), parseInt(c2.slice(3, 5), 16), parseInt(c2.slice(5, 7), 16)];
  const maskable = !!o.maskable;
  const radius = maskable ? size * 0.22 : size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!roundedRectInside(x + 0.5, y + 0.5, size, size, radius)) {
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        buf[i + 3] = 0;
        continue;
      }
      const t = (x / size + y / size) / 2;
      buf[i] = Math.round(lerp(R[0], G[0], t));
      buf[i + 1] = Math.round(lerp(R[1], G[1], t));
      buf[i + 2] = Math.round(lerp(R[2], G[2], t));
      buf[i + 3] = 255;
    }
  }

  // decorative translucent circles
  const circles = [
    [size * 0.82, size * 0.18, size * 0.30],
    [size * 0.16, size * 0.86, size * 0.24],
  ];
  circles.forEach(([cx, cy, r]) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const a = (1 - d / r) * 0.16;
        const i = (y * size + x) * 4;
        if (i < 0 || i >= buf.length) continue;
        mixRGBA(buf, i, 255, 255, 255, a);
      }
    }
  });

  // white badge
  const bx = size * 0.5;
  const by = size * 0.5;
  const br = size * 0.30;
  for (let y = Math.floor(by - br); y <= by + br; y++) {
    for (let x = Math.floor(bx - br); x <= bx + br; x++) {
      const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by);
      if (d > br) continue;
      const a = Math.min(1, (1 - Math.max(0, (d - br * 0.72) / (br * 0.28))) * 1.6);
      const i = (y * size + x) * 4;
      if (i < 0 || i >= buf.length) continue;
      mixRGBA(buf, i, 255, 255, 255, a);
    }
  }

  // checkmark
  const thickness = size * 0.105;
  const p1 = [size * 0.34, size * 0.52];
  const p2 = [size * 0.465, size * 0.645];
  const p3 = [size * 0.675, size * 0.355];
  const segs = [[p1, p2], [p2, p3]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d = Infinity;
      segs.forEach(([a, b]) => {
        d = Math.min(d, distToSegment(x + 0.5, y + 0.5, a[0], a[1], b[0], b[1]));
      });
      if (d > thickness) continue;
      const a = Math.min(1, (1 - d / thickness) * 1.2);
      const i = (y * size + x) * 4;
      if (i < 0 || i >= buf.length) continue;
      const dark = size * 0.09;
      const shade = Math.min(1, d / thickness);
      mixRGBA(buf, i, lerp(255, 30, shade), lerp(255, 30, shade * 0.9), lerp(255, 30, shade * 0.9), Math.min(1, a * 0.95));
    }
  }

  return encodePNG(size, size, buf);
}

module.exports = { encodePNG, renderIcon };
