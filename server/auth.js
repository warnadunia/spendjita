'use strict';
/** Request authentication + role guards. */
const db = require('./db');
const U = require('./util');

function attachUser(req, _res, next) {
  let token = null;
  const header = req.get('authorization');
  if (header && /^Bearer\s+/i.test(header)) token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token && req.cookies) token = req.cookies.token;
  if (token) {
    const payload = U.verify(token);
    if (payload && payload.sub) {
      const user = db.findOne('users', (u) => u.id === payload.sub);
      if (user) req.user = user;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return U.fail(res, 'Sesi tidak aktif atau telah berakhir. Silakan login kembali.', 401);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return U.fail(res, 'Sesi tidak aktif atau telah berakhir. Silakan login kembali.', 401);
    if (!roles.includes(req.user.role)) return U.fail(res, 'Akses ditolak. Role Anda tidak memiliki izin untuk halaman ini.', 403);
    next();
  };
}

const requireAdmin = requireRole('admin');
const requireMember = requireRole('teacher', 'student', 'employee', 'admin');

/** Strip sensitive fields before sending a user to the client. */
function publicUser(u, opts) {
  if (!u) return null;
  const o = opts || {};
  const out = {
    id: u.id,
    school_id: u.school_id,
    role: u.role,
    name: u.name,
    id_number: u.id_number || '',
    email: u.email || '',
    phone: u.phone || '',
    avatar: u.avatar || '',
    gender: u.gender || '',
    birth_date: u.birth_date || '',
    bio: u.bio || '',
    status: u.status || 'active',
    position: u.position || '',
    subject: u.subject || '',
    class_name: u.class_name || '',
    guardian: u.guardian || '',
    guardian_phone: u.guardian_phone || '',
    home_address: u.home_address || '',
    score_points: u.score_points || 0,
    level: levelFor(u.score_points || 0),
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
  if (o.withScore !== false) out.score_points = u.score_points || 0;
  return out;
}

function levelFor(points) {
  const levels = [
    { name: 'Pemula', min: 0, color: '#94a3b8' },
    { name: 'Berdedikasi', min: 40, color: '#0ea5e9' },
    { name: 'Akuntabel', min: 90, color: '#22c55e' },
    { name: 'Berprestasi', min: 160, color: '#84cc16' },
    { name: 'Unggul', min: 260, color: '#f59e0b' },
    { name: 'Inspiratif', min: 400, color: '#ec4899' },
  ];
  let cur = levels[0];
  levels.forEach((l) => {
    if (points >= l.min) cur = l;
  });
  const next = levels.find((l) => l.min > points) || null;
  const min = next ? next.min : cur.min;
  const max = next ? next.min : cur.min + 200;
  return {
    name: cur.name,
    color: cur.color,
    next: next ? next.name : null,
    progress: Math.round(((points - cur.min) / Math.max(1, max - cur.min)) * 100),
    pointsToNext: next ? next.min - points : 0,
  };
}

module.exports = { attachUser, requireAuth, requireRole, requireAdmin, requireMember, publicUser, levelFor };
