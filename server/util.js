'use strict';
/**
 * Shared utilities: id generation, time helpers, hashing, tokens, validation.
 */
const crypto = require('crypto');

/* ------------------------------------------------------------------ *
 *  IDs
 * ------------------------------------------------------------------ */
let seq = {};
function nextSeq(prefix) {
  seq[prefix] = (seq[prefix] || 0) + 1;
  return seq[prefix];
}
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${nextSeq(prefix).toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}
/** Short, human friendly code for attendance records, e.g. ATT-7F3K9Q */
function code(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/* ------------------------------------------------------------------ *
 *  Time
 * ------------------------------------------------------------------ */
const DAY_MS = 86400000;

function nowISO() {
  return new Date().toISOString();
}
/** Local date string (school timezone) YYYY-MM-DD */
function todayStr(tzOffsetMinutes) {
  const off = tzOffsetMinutes == null ? -480 : tzOffsetMinutes;
  return localDateStr(new Date(), off);
}
function localDateStr(d, off) {
  const shifted = new Date(d.getTime() + off * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/**
 * Minutes to ADD to a UTC instant to obtain the local wall-clock time of the
 * given IANA timezone name. E.g. Asia/Jakarta is UTC+7 -> +420.
 */
function tzMinutes(name) {
  const offsets = {
    'Asia/Jakarta': 420,
    'Asia/Bandung': 420,
    'Asia/Makassar': 300,
    'Asia/Jayapura': 600,
    'Asia/Kuala_Lumpur': 330,
    'Asia/Singapore': 330,
    'UTC': 0,
  };
  if (name && offsets[name] != null) return offsets[name];
  const m = /UTC([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(name || '');
  if (!m) return 420;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return localDateStr(dt, 0);
}
function dateRange(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 800) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}
function fmtDate(d, off) {
  return localDateStr(d, off);
}
function fmtDateTime(iso, off) {
  const o = off == null ? -420 : off;
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const sh = (x) => String(x).padStart(2, '0');
  const shifted = new Date(d.getTime() + o * 60000);
  return `${shifted.getUTCFullYear()}-${sh(shifted.getUTCMonth() + 1)}-${sh(shifted.getUTCDate())} ${sh(shifted.getUTCHours())}:${sh(shifted.getUTCMinutes())}`;
}
function timeAgo(iso, off) {
  if (!iso) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/* ------------------------------------------------------------------ *
 *  Security
 * ------------------------------------------------------------------ */
const SECRET = process.env.APP_SECRET || 'school-attendance-demo-secret-2026';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(String(password), salt, 32).toString('hex');
    const a = Buffer.from(test, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
function tokenFor(user, ttlHours = 24 * 7) {
  return sign({ sub: user.id, role: user.role, school: user.school_id, exp: Date.now() + ttlHours * 3600 * 1000 });
}

/* ------------------------------------------------------------------ *
 *  Validation / misc
 * ------------------------------------------------------------------ */
function ok(res, data, extra) {
  return res.json(Object.assign({ ok: true, data }, extra || {}));
}
function fail(res, message, status) {
  return res.status(status || 400).json({ ok: false, error: message });
}
function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  });
  return out;
}
function round(n, digits) {
  const f = Math.pow(10, digits == null ? 2 : digits);
  return Math.round((n + Number.EPSILON) * f) / f;
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
function has(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}
/** Haversine distance in metres */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function initials(name) {
  if (!name) return '?';
  const parts = String(name).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

module.exports = {
  uid,
  code,
  DAY_MS,
  nowISO,
  todayStr,
  localDateStr,
  tzMinutes,
  addDays,
  dateRange,
  fmtDate,
  fmtDateTime,
  timeAgo,
  hashPassword,
  verifyPassword,
  sign,
  verify,
  tokenFor,
  ok,
  fail,
  pick,
  round,
  clamp,
  has,
  distanceMeters,
  initials,
  escapeHtml,
};
