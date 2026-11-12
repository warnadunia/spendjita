'use strict';
/** Server-rendered avatars, logos and QR codes (no client-side libraries). */
const path = require('path');
const U = require('./util');

const PALETTES = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#22d3ee'],
  ['#f43f5e', '#fb923c'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#8b5cf6', '#ec4899'],
  ['#3b82f6', '#6366f1'],
  ['#14b8a6', '#0ea5e9'],
  ['#ef4444', '#f97316'],
  ['#65a30d', '#a3a635'],
];

function hashInt(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic SVG avatar with initials + soft gradient. */
function avatarSVG(name, size) {
  const s = size || 120;
  const [a, b] = PALETTES[hashInt(name || 'x') % PALETTES.length];
  const text = U.escapeHtml(U.initials(name));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 120 120" role="img" aria-label="${U.escapeHtml(name || 'avatar')}">
<defs>
<linearGradient id="g${hashInt(name || 'x')}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
</linearGradient>
</defs>
<rect width="120" height="120" rx="${s / 4}" fill="url(#g${hashInt(name || 'x')})"/>
<circle cx="100" cy="20" r="34" fill="rgba(255,255,255,0.13)"/>
<circle cx="18" cy="104" r="26" fill="rgba(255,255,255,0.10)"/>
<text x="60" y="60" font-family="'Segoe UI',Inter,system-ui,-apple-system,sans-serif" font-size="46" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central">${text}</text>
</svg>`;
}

/** A tileable brand mark used as the default app logo. */
function defaultLogoSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#22d3ee"/>
</linearGradient>
</defs>
<rect width="512" height="512" rx="112" fill="url(#lg)"/>
<path d="M160 300 L256 148 L352 300 L352 372 L292 372 L292 286 L230 286 L230 372 L160 372 Z" fill="#fff"/>
<circle cx="352" cy="176" r="40" fill="#fff" opacity="0.85"/>
</svg>`;
}

function qrSVG(text, opts) {
  const o = opts || {};
  const size = o.size || 320;
  const dark = o.dark || '#0f172a';
  const light = o.light || '#ffffff';
  const qrcode = require('qrcode');
  return qrcode
    .toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark, light },
    })
    .then((raw) => {
      if (o.raw) return raw;
      // The renderer emits its own <svg> wrapper (possibly with trailing
      // whitespace), so strip every svg tag and re-wrap with an explicit
      // viewBox — a stray closing tag would make the image undecodeable.
      const inner = String(raw)
        .replace(/^[\s\S]*?<svg[^>]*>/i, '')
        .replace(/<\/svg>\s*$/i, '')
        .replace(/<\/?svg[^>]*>/gi, '');
      const vbMatch = /viewBox=["']0 0 ([\d.]+)/.exec(String(raw));
      const modules = vbMatch ? parseFloat(vbMatch[1]) : 47;
      const scale = (size * 0.9) / modules;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${size / 10}" fill="${light}"/>
<g transform="translate(${size * 0.05},${size * 0.05}) scale(${scale.toFixed(4)})" shape-rendering="crispEdges">${inner}</g>
</svg>`;
    });
}

module.exports = { avatarSVG, defaultLogoSVG, qrSVG, PALETTES, hashInt };
