'use strict';
/** Authentication + account routes (shared by admin web and mobile PWA). */
const express = require('express');
const db = require('../db');
const U = require('../util');
const auth = require('../auth');
const attendance = require('../attendance');
const storage = require('../storage');

const router = express.Router();

const resetTokens = new Map(); // id -> { token, expires }

function loginPayload(user) {
  return {
    token: U.tokenFor(user),
    user: auth.publicUser(user),
    school: db.findOne('schools', (s) => s.id === 'school_default') || null,
    settings: attendance.settings(),
  };
}

router.post('/login', (req, res) => {
  const body = req.body || {};
  const ident = String(body.idNumber || body.id_number || body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!ident || !password) return U.fail(res, 'Masukkan ID pengguna dan kata sandi.');
  const user = db.findOne(
    'users',
    (u) =>
      String(u.id_number || '').toLowerCase() === ident ||
      String(u.email || '').toLowerCase() === ident
  );
  if (!user || !U.verifyPassword(password, user.password)) {
    return U.fail(res, 'ID pengguna atau kata sandi salah.', 401);
  }
  if (user.status !== 'active') return U.fail(res, 'Akun Anda sedang nonaktif. Hubungi administrator sekolah.', 403);
  db.insert('logs', {
    id: U.uid('log'),
    school_id: 'school_default',
    actor: user.name,
    actor_id: user.id,
    action: 'LOGIN',
    target: user.name,
    target_id: user.id,
    detail: `Web / ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    at: new Date().toISOString(),
  });
  return U.ok(res, loginPayload(user));
});

/** Demo helper — returns the demo accounts so the login screen can offer quick access. */
router.get('/demo-accounts', (_req, res) => {
  /* Order matters: the mobile login screen renders these chips top to bottom,
     so `parent` is listed last and therefore sits below the employee chip. */
  const picks = ['admin', 'teacher', 'student', 'employee', 'parent'].map((role) =>
    db.findOne('users', (u) => u.role === role && u.status === 'active')
  ).filter(Boolean);
  return U.ok(res, picks.map((u) => ({ role: u.role, id_number: u.id_number, name: u.name, password: 'demo123' })));
});

router.post('/forgot-password', (req, res) => {
  const body = req.body || {};
  const ident = String(body.idNumber || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  if (!ident) return U.fail(res, 'Masukkan ID pengguna untuk pemulihan kata sandi.');
  const user = db.findOne('users', (u) => String(u.id_number || '').toLowerCase() === ident);
  if (!user) return U.fail(res, 'ID pengguna tidak ditemukan.', 404);
  if (email && String(user.email || '').toLowerCase() !== email) {
    return U.fail(res, 'Email tidak sesuai dengan data sekolah.', 400);
  }
  const token = String(Math.floor(100000 + Math.random() * 900000));
  resetTokens.set(user.id, { token, expires: Date.now() + 30 * 60 * 1000 });
  // In a production deployment this would be emailed. For the demo we return it.
  return U.ok(res, { message: 'Kode pemulihan dihasilkan.', token, hint: `Kode pemulihan: ${token} (berlaku 30 menit)` });
});

router.post('/reset-password', (req, res) => {
  const body = req.body || {};
  const ident = String(body.idNumber || '').trim().toLowerCase();
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!/^\d{6}$/.test(token)) return U.fail(res, 'Kode pemulihan harus terdiri dari 6 angka.');
  if (password.length < 6) return U.fail(res, 'Kata sandi baru minimal 6 karakter.');
  const user = db.findOne('users', (u) => String(u.id_number || '').toLowerCase() === ident);
  if (!user) return U.fail(res, 'ID pengguna tidak ditemukan.', 404);
  const rec = resetTokens.get(user.id);
  if (!rec || rec.token !== token) return U.fail(res, 'Kode pemulihan salah.', 400);
  if (rec.expires < Date.now()) {
    resetTokens.delete(user.id);
    return U.fail(res, 'Kode pemulihan sudah kadaluarsa. Minta kode baru.', 400);
  }
  db.update('users', user.id, { password: U.hashPassword(password) });
  resetTokens.delete(user.id);
  attendance.log('PASSWORD_RESET', user, 'Password diubah melalui pemulihan kata sandi.');
  return U.ok(res, { message: 'Kata sandi berhasil diubah. Silakan login dengan kata sandi baru.' });
});

router.get('/me', auth.requireAuth, (req, res) => {
  return U.ok(res, { user: auth.publicUser(req.user), school: attendance.school(), settings: attendance.settings() });
});

router.post('/change-password', auth.requireAuth, (req, res) => {
  const body = req.body || {};
  if (!U.verifyPassword(String(body.current || ''), req.user.password)) {
    return U.fail(res, 'Kata sandi saat ini salah.');
  }
  const next = String(body.next || body.password || '');
  if (next.length < 6) return U.fail(res, 'Kata sandi baru minimal 6 karakter.');
  db.update('users', req.user.id, { password: U.hashPassword(next) });
  attendance.log('PASSWORD_CHANGE', req.user, 'Password diubah oleh pengguna.');
  return U.ok(res, { message: 'Kata sandi berhasil diperbarui.' });
});

router.put('/profile', auth.requireAuth, async (req, res) => {
  const body = req.body || {};
  const patch = {};
  ['name', 'phone', 'avatar', 'bio', 'gender', 'birth_date', 'home_address', 'guardian', 'guardian_phone'].forEach((k) => {
    if (U.has(body[k])) patch[k] = body[k];
  });
  if (patch.avatar && patch.avatar.startsWith('data:')) {
    patch.avatar = await storage.uploadBase64(patch.avatar, 'avatar');
  }
  db.update('users', req.user.id, patch);
  attendance.log('PROFILE_UPDATE', req.user, 'Biodata diperbarui.');
  return U.ok(res, { user: auth.publicUser(db.findOne('users', (u) => u.id === req.user.id)), message: 'Biodata berhasil diperbarui.' });
});

/**
 * Profile score points — staff and students earn points for attendance,
 * extracurricular participation and approved requests.
 */
router.post('/score', auth.requireAuth, (req, res) => {
  const delta = Number(req.body && req.body.delta) || 0;
  if (!delta) return U.fail(res, 'Perubahan poin harus berupa angka.');
  const cur = Number(req.user.score_points || 0);
  const next = Math.max(0, U.round(cur + delta));
  db.update('users', req.user.id, { score_points: next });
  return U.ok(res, { score_points: next, level: auth.levelFor(next) });
});

router.get('/points-leaderboard', auth.requireAuth, (req, res) => {
  const role = req.query.role || '';
  const rows = db
    .all('users')
    .filter((u) => u.status === 'active' && (!role || u.role === role) && u.role !== 'admin')
    .sort((a, b) => (b.score_points || 0) - (a.score_points || 0))
    .slice(0, 20)
    .map((u, i) => ({ rank: i + 1, name: u.name, role: u.role, score_points: u.score_points || 0, avatar: u.avatar, level: auth.levelFor(u.score_points || 0) }));
  return U.ok(res, rows);
});

module.exports = router;
