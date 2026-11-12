'use strict';
/** Public routes: school info, the dynamic location QR codes, and scan flow. */
const express = require('express');
const db = require('../db');
const U = require('../util');
const attendance = require('../attendance');
const assets = require('../assets');
const auth = require('../auth');

const router = express.Router();

/**
 * Kiosk QR rotation. The code is minted from a 60-second time slot and signed
 * with the app secret, so a photo or a screenshot of the screen is worthless
 * one minute later. The previous slot stays valid as a small grace window for
 * a code that was rendered just before the rollover.
 */
const KIOSK_SLOT_MS = 60 * 1000;
const KIOSK_GRACE_SLOTS = 1;

function school() {
  return db.findOne('schools', (s) => s.id === 'school_default') || db.all('schools')[0] || null;
}

function schoolCode() {
  const s = school();
  return String((s && s.code) || 'SCHOOL').toUpperCase();
}

/** The signed, self-expiring credential that the kiosk screen renders. */
/**
 * The payload deliberately omits an issue time so that every kiosk renders
 * the *identical* code for the whole slot, and the code changes exactly on
 * the minute boundary.
 *
 * Two different deadlines matter here:
 *  - `expires_at` is when the screen rotates — purely cosmetic, drives the
 *    countdown on the kiosk.
 *  - the payload's `exp` is how long the code still *scans*. It runs to the
 *    end of the grace window, because `U.verify` rejects on `exp`. Keeping
 *    the two equal silently killed the grace window: a code rendered at
 *    second 58 of a slot stopped working two seconds later, which is exactly
 *    when a slow connection needs that grace.
 */
function kioskToken(now) {
  const t = now || Date.now();
  const slot = Math.floor(t / KIOSK_SLOT_MS);
  const expiresAt = (slot + 1) * KIOSK_SLOT_MS;
  const validUntil = expiresAt + KIOSK_GRACE_SLOTS * KIOSK_SLOT_MS;
  return {
    token: U.sign({ v: 1, k: 'kiosk', s: schoolCode(), slot, exp: validUntil }),
    slot,
    issued_at: new Date(slot * KIOSK_SLOT_MS).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    valid_until: new Date(validUntil).toISOString(),
  };
}

/** Accept the current slot plus a short grace window (clock skew). */
function verifyKioskToken(token) {
  const p = U.verify(token);
  if (!p || p.k !== 'kiosk') return null;
  if (String(p.s || '').toUpperCase() !== schoolCode()) return null;
  const slot = Math.floor(Date.now() / KIOSK_SLOT_MS);
  if (typeof p.slot !== 'number') return null;
  if (p.slot > slot || p.slot < slot - KIOSK_GRACE_SLOTS) return null;
  return p;
}

/** The URL the QR encodes: opens the scan page on any generic camera app. */
function kioskUrl(req, token) {
  const s = school() || {};
  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${host}/scan.html?k=${encodeURIComponent(token)}&school=${encodeURIComponent(s.code || 'SCHOOL')}`;
}

function payload(req, mode) {
  const s = school() || { lat: 0, lng: 0, code: 'SCHOOL' };
  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const origin = `${proto}://${host}`;
  return `${origin}/scan.html?mode=${mode}&school=${encodeURIComponent(s.code)}&name=${encodeURIComponent(s.name)}&lat=${s.lat}&lng=${s.lng}`;
}

router.get('/school', (req, res) => {
  const s = school();
  if (!s) return U.fail(res, 'Sekolah belum dikonfigurasi.', 404);
  return U.ok(res, {
    school: { ...s, logo_url: db.findOne('settings', (x) => x.id === 'school_default')?.logo ? '/api/assets/logo.svg' : '/api/assets/default-logo.svg' },
    settings: attendance.settings(),
    qr: {
      checkin: payload(req, 'checkin'),
      checkout: payload(req, 'checkout'),
    },
  });
});

/**
 * Public live snapshot of today's attendance — powers the kiosk screen and
 * the public landing page. Deliberately contains no personal contact details.
 */
router.get('/live', (req, res) => {
  const today = attendance.today();
  const rows = db.all('attendance').filter((a) => a.date === today);
  const users = db.all('users').filter((u) => u.status === 'active' && u.role !== 'admin');
  const checkedIn = rows.filter((a) => a.check_in_at).length;
  const out = rows.filter((a) => a.check_out_at).length;
  const late = rows.filter((a) => a.status === 'late').length;
  const recent = rows
    .filter((a) => a.check_in_at)
    .sort((a, b) => new Date(b.check_in_at) - new Date(a.check_in_at))
    .slice(0, 6)
    .map((a) => ({ name: a.user_name, role: a.role, at: a.check_in_at, status: a.status }));
  return U.ok(res, {
    date: today,
    checked_in: checkedIn,
    checked_out: out,
    late,
    eligible: users.length,
    rate: users.length ? U.round((checkedIn / users.length) * 100, 1) : 0,
    recent,
    school: school(),
    settings: {
      checkin_radius_m: Number(attendance.settings().checkin_radius_m) || 120,
      work_start: attendance.settings().work_start,
      work_end: attendance.settings().work_end,
    },
  });
});

/** Dynamic QR code (school location) — rendered as inline SVG. */
router.get('/qr', async (req, res) => {
  try {
    const mode = String(req.query.mode || 'checkin').toLowerCase();
    if (!['checkin', 'checkout'].includes(mode)) return U.fail(res, 'Mode QR tidak valid.', 400);
    const text = payload(req, mode);
    const svg = await assets.qrSVG(text, { size: Math.min(900, parseInt(req.query.size, 10) || 420) });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(svg);
  } catch (err) {
    return U.fail(res, 'Gagal menghasilkan kode QR: ' + err.message, 500);
  }
});

router.get('/qr/:mode.svg', async (req, res) => {
  try {
    const mode = String(req.params.mode || 'checkin').toLowerCase();
    if (!['checkin', 'checkout'].includes(mode)) return U.fail(res, 'Mode QR tidak valid.', 400);
    const svg = await assets.qrSVG(payload(req, mode), { size: Math.min(900, parseInt(req.query.size, 10) || 420) });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(svg);
  } catch (err) {
    return U.fail(res, 'Gagal menghasilkan kode QR: ' + err.message, 500);
  }
});

/**
 * The single rotating kiosk credential. The kiosk screen polls this once a
 * second and re-renders the QR whenever the slot rolls over.
 */
router.get('/kiosk/token', (req, res) => {
  const s = school();
  if (!s) return U.fail(res, 'Sekolah belum dikonfigurasi.', 404);
  const k = kioskToken();
  const st = attendance.settings();
  return U.ok(res, {
    token: k.token,
    slot: k.slot,
    issued_at: k.issued_at,
    expires_at: k.expires_at,
    ttl: Math.max(1, Math.ceil((new Date(k.expires_at).getTime() - Date.now()) / 1000)),
    valid_until: k.valid_until,
    rotate_seconds: KIOSK_SLOT_MS / 1000,
    url: kioskUrl(req, k.token),
    school: { id: s.id, name: s.name, code: s.code, lat: s.lat, lng: s.lng },
    location: { lat: s.lat, lng: s.lng },
    radius: Number(st.checkin_radius_m) || 120,
    require_gps: st.require_gps !== false,
    settings: st,
  });
});

/**
 * The one QR the kiosk displays — an SVG of the rotating credential.
 * `GET /api/public/kiosk/qr.svg`
 */
router.get('/kiosk/qr.svg', async (req, res) => {
  try {
    const k = kioskToken();
    const svg = await assets.qrSVG(kioskUrl(req, k.token), { size: Math.min(1200, parseInt(req.query.size, 10) || 640) });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Kiosk-Expires', k.expires_at);
    return res.send(svg);
  } catch (err) {
    return U.fail(res, 'Gagal menghasilkan kode QR: ' + err.message, 500);
  }
});

/** Resolve a scanned code into what it means (for the mobile app). */
router.post('/scan/resolve', (req, res) => {
  const body = req.body || {};
  const mode = String(body.mode || 'checkin').toLowerCase();
  if (!['checkin', 'checkout'].includes(mode)) return U.fail(res, 'Mode tidak valid.');
  const s = school();
  const code = String(body.code || '').trim().toUpperCase();
  const schoolCode = s && s.code ? String(s.code).toUpperCase() : '';
  if (code && schoolCode && code !== schoolCode) {
    return U.fail(res, `Kode "${code}" tidak terdaftar untuk ${s.name}.`, 400);
  }
  return U.ok(res, {
    mode,
    school: s,
    settings: attendance.settings(),
    location: { lat: s ? s.lat : 0, lng: s ? s.lng : 0 },
    radius: Number(attendance.settings().checkin_radius_m) || 120,
    distance:
      body.lat != null && body.lng != null
        ? U.round(U.distanceMeters(Number(body.lat), Number(body.lng), s ? s.lat : 0, s ? s.lng : 0), 1)
        : null,
    message: `Kode valid untuk ${mode === 'checkin' ? 'absen masuk' : 'absen pulang'} di ${s ? s.name : 'sekolah'}.`,
  });
});

/**
 * One QR for both directions. The server looks at today's record and decides
 * whether this scan is a check-in or a check-out.
 *
 * Accepts either the rotating `token` (preferred — expires after a minute) or
 * a static `code` (the school code) as an admin-controlled manual fallback.
 */
router.post('/scan-attend', auth.requireAuth, (req, res) => {
  const body = req.body || {};
  const token = String(body.token || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  const s = school();

  let source = 'qr';
  if (token) {
    if (!verifyKioskToken(token)) {
      return U.fail(res, 'Kode QR kiosk sudah kedaluwarsa. Pindai ulang kode yang tampil di layar.', 410);
    }
  } else if (code) {
    if (code !== schoolCode()) return U.fail(res, `Kode "${code}" tidak terdaftar untuk ${s ? s.name : 'sekolah'}.`, 400);
    if ((attendance.settings().allow_manual_code) === false) {
      return U.fail(res, 'Masuk dengan kode manual tidak diizinkan. Pindai kode QR kiosk.', 403);
    }
    source = 'manual';
  } else {
    return U.fail(res, 'Kode QR tidak dikenali.');
  }

  const user = req.user;
  const date = attendance.today();
  const st = attendance.settings();
  const radius = Number(st.checkin_radius_m) || 120;

  /**
   * The kiosk code is only ever shown at school, so the radius configured in
   * Settings is always enforced here — scanning from outside the geofence is
   * refused even when "allow outside confirm" is enabled for other methods.
   */
  let geo = null;
  if (body.lat != null && body.lng != null) geo = attendance.geofence(Number(body.lat), Number(body.lng), radius);
  if (st.require_gps !== false && !geo) {
    return U.fail(res, 'Posisi GPS tidak terdeteksi. Izinkan lokasi lalu pindai ulang.');
  }
  if (geo && !geo.inside) {
    return U.fail(res, `Anda berada ${U.round(geo.dist, 0)} m dari titik kiosk. Batas yang diizinkan: ${radius} m.`);
  }

  const rec = attendance.recordFor(user.id, date);
  const mode = rec && rec.check_in_at && !rec.check_out_at ? 'checkout' : 'checkin';

  const payloadObj = Object.assign({}, body, {
    method: source === 'qr' ? 'qr' : 'manual',
    kiosk: source === 'qr',
    kiosk_radius: radius,
    date,
  });
  const result = mode === 'checkin' ? attendance.checkIn(user, payloadObj) : attendance.checkOut(user, payloadObj);
  if (!result.ok) {
    return U.fail(res, result.message || 'Gagal mencatat kehadiran.', result.reason === 'already_checked_in' ? 409 : 400);
  }

  let points = 0;
  let level = null;
  if (mode === 'checkin') {
    const u = db.findOne('users', (x) => x.id === user.id);
    points = result.record.status === 'present' ? 3 : result.record.status === 'late' ? 1 : 0;
    if (points) db.update('users', u.id, { score_points: U.round((u.score_points || 0) + points) });
    level = auth.levelFor((u.score_points || 0) + points);
  }

  return U.ok(res, {
    mode,
    source,
    record: result.record,
    geo: result.geo || geo,
    radius,
    points,
    level,
    message: mode === 'checkin'
      ? (result.record.status === 'late' ? 'Absen masuk tercatat — Anda terlambat.' : 'Absen masuk berhasil.')
      : 'Absen pulang berhasil.',
  });
});

/** Public scan page auth (used by a shared tablet / TWA kiosk). */
router.post('/scan/login', (req, res) => {
  const body = req.body || {};
  const ident = String(body.idNumber || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = db.findOne('users', (u) => String(u.id_number || '').toLowerCase() === ident);
  if (!user || !U.verifyPassword(password, user.password)) return U.fail(res, 'ID pengguna atau kata sandi salah.', 401);
  if (user.status !== 'active') return U.fail(res, 'Akun tidak aktif.', 403);
  return U.ok(res, { token: U.tokenFor(user), user: { id: user.id, name: user.name, role: user.role } });
});

router.post('/scan/confirm', (req, res) => {
  const body = req.body || {};
  const token = String(body.token || '');
  const payloadObj = U.verify(token);
  if (!payloadObj) return U.fail(res, 'Sesi scan tidak valid.', 401);
  const user = db.findOne('users', (u) => u.id === payloadObj.sub);
  if (!user) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  const mode = String(body.mode || 'checkin').toLowerCase();
  const result = mode === 'checkin' ? attendance.checkIn(user, body) : attendance.checkOut(user, body);
  if (!result.ok) return U.fail(res, result.message || 'Gagal mencatat kehadiran.', 400);
  return U.ok(res, { record: result.record, geo: result.geo, message: result.message });
});

module.exports = router;
