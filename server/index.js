'use strict';
/**
 * School Attendance System — application server.
 * Serves the admin web, the mobile PWA, the public kiosk/QR pages and the JSON API.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const U = require('./util');
const attendance = require('./attendance');
const auth = require('./auth');
const assets = require('./assets');
const icons = require('./icons');
const storage = require('./storage');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ICON_DIR = icons.ICON_DIR;

/* ----------------------------- bootstrap ---------------------------- */
db.load();
if (!db.count('users')) {
  console.log('[boot] seeding demo data…');
  const r = require('./seed').build();
  console.log('[boot] demo data ready:', JSON.stringify(r));
}

let ICON_COLORS = icons.generateIcons();

/** Re-render the app icons after a branding change. */
function regenerateIcons() {
  ICON_COLORS = icons.generateIcons();
  return ICON_COLORS;
}

/* ------------------------------ app -------------------------------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(auth.attachUser);

// request logging (keeps the dashboard "real time" feel honest)
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    const ip = req.ip || req.socket.remoteAddress;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${ip}`);
  }
  next();
});

/* ---------------------------- static files -------------------------- */
app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (/sw\.js$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    },
  })
);
app.use('/uploads', express.static(storage.UPLOADS_DIR, { maxAge: '7d' }));

/* ----------------------------- assets ------------------------------ */
app.get('/api/assets/avatar/:name.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(assets.avatarSVG(req.params.name, 120));
});

app.get('/favicon.ico', (_req, res) => {
  const f = path.join(ICON_DIR, 'favicon.png');
  if (fs.existsSync(f)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(f);
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  return res.send(assets.defaultLogoSVG());
});

/** Digital Asset Links — enables "Verified" Trusted Web Activity installs. */
app.get('/.well-known/assetlinks.json', (req, res) => {
  const links = icons.assetLinks();
  if (!links) {
    return res.status(404).json({ ok: false, error: 'TWA belum dikonfigurasi. Isi nama paket Android dan sidik jari SHA-256 pada pengaturan aplikasi.' });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(JSON.stringify(links, null, 2));
});

app.get('/api/assets/default-logo.svg', (_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.send(assets.defaultLogoSVG());
});

app.get('/api/assets/logo.svg', (_req, res) => {
  const s = attendance.settings();
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(s.logo || assets.defaultLogoSVG());
});

app.get('/api/assets/logo.png', (_req, res) => {
  const s = attendance.settings();
  if (s.logo) {
    const data = Buffer.from(s.logo.split(',')[1] || '', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(data);
  }
  res.setHeader('Content-Type', 'image/png');
  res.send(png.renderIcon(192, { colors: ICON_COLORS }));
});

app.use('/icons', express.static(ICON_DIR, { maxAge: '1h' }));
app.get('/api/assets/icon-:size.png', (req, res) => {
  const size = Math.min(512, parseInt(req.params.size, 10) || 192);
  const f = path.join(ICON_DIR, `icon-${size}.png`);
  if (!fs.existsSync(f)) return res.status(404).send('not found');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(f);
});

app.get('/api/assets/splash/:size.png', (req, res) => {
  const size = Math.min(1200, parseInt(req.params.size, 10) || 1240);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(png.renderIcon(size, { colors: ICON_COLORS }));
});

/* ------------------------------- API -------------------------------- */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/mobile', require('./routes/mobile'));
app.use('/api/public', require('./routes/public'));
app.use('/api/parent', require('./routes/parent'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString() });
});

/* ------------------------------ manifest --------------------------- */
app.get('/manifest.webmanifest', (_req, res) => manifestResponse(res));
app.get('/manifest.json', (_req, res) => manifestResponse(res));

function manifestResponse(res) {
  const s = attendance.settings();
  const sc = attendance.school();
  const m = {
    name: s.app_name || sc.name || 'Absensi Sekolah',
    short_name: s.app_short_name || 'Absensi',
    description: s.app_tagline || `Sistem absensi ${sc.name || 'sekolah'}.`,
    start_url: '/mobile',
    scope: '/mobile',
    id: '/mobile',
    dir: 'ltr',
    lang: 'id',
    display: 'standalone',
    display_override: ['standalone', 'fullscreen', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#f1f5f9',
    theme_color: s.theme_primary || '#4f46e5',
    categories: ['education', 'productivity', 'business'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Absen Masuk', url: '/mobile/?action=checkin', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Absen pulang', url: '/mobile/?action=checkout', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Tambah Permohonan', url: '/mobile/#/requests/new', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(JSON.stringify(m, null, 2));
}

/* --------------------------- service worker -------------------------- */
app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});

/* ----------------------------- pages ------------------------------- */
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (_req, res) => res.redirect('/admin/'));
app.get('/admin/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/mobile', (_req, res) => res.redirect('/mobile/'));
app.get('/mobile/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'mobile', 'index.html')));
app.get('/kiosk', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'kiosk', 'index.html')));
app.get('/kiosk/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'kiosk', 'index.html')));

/* ---------------------------- 404 / errors --------------------------- */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: `Endpoint ${req.method} ${req.path} tidak ditemukan.` });
  }
  return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use((err, req, res, _next) => {
  console.error('[error]', err);
  if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Payload terlalu besar.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Body JSON tidak valid.' });
  return res.status(500).json({ ok: false, error: err.message || 'Terjadi kesalahan server.' });
});

/* ------------------------------ listen ----------------------------- */
if (process.env.VERCEL !== '1' && !process.env.NOW_REGION) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    const s = attendance.settings();
    console.log('\n  🎓  School Attendance System');
    console.log(`     ${s.app_name || attendance.school().name}`);
    console.log('     ─────────────────────────────────────────');
    console.log(`     Admin      → http://localhost:${PORT}/admin`);
    console.log(`     Mobile PWA → http://localhost:${PORT}/mobile`);
    console.log(`     Kiosk QR   → http://localhost:${PORT}/kiosk`);
    console.log(`     Public     → http://localhost:${PORT}/scan.html`);
    console.log('     ─────────────────────────────────────────');
    console.log('     Demo login (password: demo123)');
    ['admin', 'teacher', 'student', 'employee', 'parent'].forEach((role) => {
      const u = db.findOne('users', (x) => x.role === role && x.status === 'active');
      if (u) console.log(`       ${role.padEnd(9)} ${String(u.id_number).padEnd(12)} ${u.name}`);
    });
    console.log('\n');
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

module.exports = app;
