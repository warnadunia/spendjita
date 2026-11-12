'use strict';
/**
 * PWA / APK icon generation. Renders real PNG icons from the current brand
 * colours so the installed app always matches the school's theme.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const png = require('./png');

const ICON_DIR = path.join(db.DATA_DIR, 'icons');
const SIZES = [144, 192, 512];

function settings() {
  return db.findOne('settings', (s) => s.id === 'school_default') || db.all('settings')[0] || {};
}

function brandColors() {
  const s = settings();
  const norm = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : fallback);
  return [norm(s.theme_primary, '#4f46e5'), norm(s.theme_accent, '#22d3ee')];
}

function generateIcons() {
  try {
    if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });
    const colors = brandColors();
    SIZES.forEach((sz) => {
      fs.writeFileSync(path.join(ICON_DIR, `icon-${sz}.png`), png.renderIcon(sz, { colors }));
      fs.writeFileSync(path.join(ICON_DIR, `icon-maskable-${sz}.png`), png.renderIcon(sz, { colors, maskable: true }));
    });
    fs.writeFileSync(path.join(ICON_DIR, 'apple-touch-icon.png'), png.renderIcon(180, { colors }));
    fs.writeFileSync(path.join(ICON_DIR, 'favicon.png'), png.renderIcon(64, { colors }));
    return colors;
  } catch (err) {
    // In read-only serverless filesystems (e.g. Vercel), fail silently
    return brandColors();
  }
}

/** Digital Asset Links — lets a Trusted Web Activity verify ownership. */
function assetLinks(origin) {
  const s = settings();
  const pkg = String(s.android_package || '').trim();
  if (!pkg) return null;
  const prints = String(s.sha256_fingerprints || '')
    .split(/[\n,]/)
    // Android Studio copies fingerprints colon-separated — normalise them.
    .map((x) => x.trim().toUpperCase().replace(/[\s:]/g, ''))
    .filter((x) => /^[0-9A-F]{64}$/.test(x));
  if (!prints.length) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: prints,
      },
    },
  ];
}

module.exports = { ICON_DIR, SIZES, generateIcons, brandColors, assetLinks };
