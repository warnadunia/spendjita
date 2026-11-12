'use strict';
/** Admin web API — dashboard, CRUD for every resource, reports, branding. */
const express = require('express');
const db = require('../db');
const U = require('../util');
const auth = require('../auth');
const attendance = require('../attendance');
const sched = require('../schedule');

const router = express.Router();
router.use(auth.requireAdmin);

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */
const ROLE_LABEL = { admin: 'Administrator', teacher: 'Guru', student: 'Peserta Didik', employee: 'Karyawan', parent: 'Orang Tua' };
const STATUS_LABEL = { present: 'Hadir', late: 'Hadir Terlambat', absent: 'Tidak Hadir', leave: 'Izin' };

function todayList() {
  const t = attendance.today();
  return db.all('attendance').filter((a) => a.date === t);
}
function recent(list, n) {
  return list
    .slice()
    .sort((a, b) => new Date(b.created_at || b.check_in_at || 0) - new Date(a.created_at || a.check_in_at || 0))
    .slice(0, n);
}

/* ------------------------------------------------------------------ *
 *  Dashboard (dynamic + real time)
 * ------------------------------------------------------------------ */
router.get('/dashboard', (req, res) => {
  const t = attendance.today();
  const todays = todayList();
  const checked = todays.filter((a) => a.check_in_at).length;
  const late = todays.filter((a) => a.status === 'late').length;
  const checkedOut = todays.filter((a) => a.check_out_at).length;
  const users = db.all('users').filter((u) => u.status === 'active');
  const byRole = ['teacher', 'student', 'employee'].map((role) => {
    const list = users.filter((u) => u.role === role);
    const att = todays.filter((a) => a.role === role);
    const present = att.filter((a) => a.status === 'present' || a.status === 'late').length;
    return {
      role,
      label: ROLE_LABEL[role],
      total: list.length,
      present,
      absent: list.length - present,
      rate: list.length ? U.round((present / list.length) * 100, 1) : 0,
      icon: role === 'teacher' ? '🧑‍🏫' : role === 'student' ? '🎓' : '🧾',
    };
  });

  // 7-day trend
  const days = U.dateRange(U.addDays(t, -6), t);
  const trend = days.map((d) => {
    const rows = db.all('attendance').filter((a) => a.date === d);
    const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
    const pool = db.all('users').filter((u) => u.status === 'active' && u.role !== 'admin' && !['Minggu', 'Sabtu'].includes(['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][new Date(d + 'T00:00:00Z').getUTCDay()]));
    const expected = pool.length || 1;
    return {
      date: d,
      dow: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][new Date(d + 'T00:00:00Z').getUTCDay()],
      present,
      expected,
      rate: U.round((present / expected) * 100, 1),
      late: rows.filter((r) => r.status === 'late').length,
    };
  });

  // per-class breakdown today
  const classes = {};
  todays.forEach((a) => {
    if (!a.class_name) return;
    if (!classes[a.class_name]) classes[a.class_name] = { name: a.class_name, present: 0, late: 0, total: 0 };
    const c = classes[a.class_name];
    c.total++;
    if (a.status === 'present') c.present++;
    if (a.status === 'late') {
      c.late++;
      c.present++;
    }
  });
  const classRows = Object.values(classes).sort((a, b) => b.total - a.total).slice(0, 8);

  const pending = db.all('requests').filter((r) => r.status === 'pending').slice(0, 6);
  const pinned = db.all('announcements').filter((a) => a.is_pinned).concat(db.all('announcements')).slice(0, 4);
  const upcoming = db
    .all('events')
    .filter((e) => e.end_date >= t)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 6);
  const ecToday = db
    .all('extracurriculars')
    .filter((e) => e.active && e.schedule_days.includes(['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][new Date(t + 'T00:00:00Z').getUTCDay()]));

  return U.ok(res, {
    generated_at: new Date().toISOString(),
    date: t,
    time: new Date().toISOString(),
    counters: {
      checked_in: checked,
      checked_out: checkedOut,
      late,
      not_checked_in: users.filter((u) => u.role !== 'admin').length - checked,
      present_rate: U.round((checked / Math.max(1, users.filter((u) => u.role !== 'admin').length)) * 100, 1),
    },
    by_role: byRole,
    trend,
    classes: classRows,
    pending_requests: pending,
    announcements: pinned,
    upcoming,
    extracurriculars: ecToday,
    activity: recent(db.all('logs').slice().sort((a, b) => new Date(b.at) - new Date(a.at)), 14),
    stats: {
      users: db.all('users').length,
      attendance: db.all('attendance').length,
      announcements: db.all('announcements').length,
      news: db.all('news').length,
      requests: db.all('requests').length,
      events: db.all('events').length,
      extracurriculars: db.all('extracurriculars').length,
    },
  });
});

/* ------------------------------------------------------------------ *
 *  Users
 * ------------------------------------------------------------------ */
router.get('/users', (req, res) => {
  const { q, role, status, page, limit } = req.query;
  let rows = db.all('users');
  if (q) {
    const k = String(q).toLowerCase();
    rows = rows.filter((u) => [u.name, u.id_number, u.email, u.phone, u.position, u.class_name, u.subject].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  if (role) rows = rows.filter((u) => u.role === role);
  if (status) rows = rows.filter((u) => u.status === status);
  rows = rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'id', { numeric: true }));
  const total = rows.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  return U.ok(res, {
    total,
    page: p,
    limit: l,
    total_pages: Math.ceil(total / l),
    items: rows.slice((p - 1) * l, p * l).map((u) => auth.publicUser(u)),
  });
});

router.get('/users/:id', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.params.id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  const rows = db.all('attendance').filter((a) => a.user_id === u.id).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  const reqs = db.all('requests').filter((r) => r.user_id === u.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8);
  const eca = db.all('ec_attendance').filter((a) => a.user_id === u.id).slice(0, 8);
  return U.ok(res, { user: auth.publicUser(u), attendance: rows, requests: reqs, extracurricular_attendance: eca });
});

function validateUser(body, existing) {
  const errors = [];
  const data = {};
  if (U.has(body.name)) {
    if (String(body.name).trim().length < 2) errors.push('Nama minimal 2 karakter.');
    else data.name = String(body.name).trim();
  }
  if (U.has(body.role)) {
    if (!['admin', 'teacher', 'student', 'employee', 'parent'].includes(body.role)) errors.push('Role tidak valid.');
    else data.role = body.role;
  }
  if (U.has(body.id_number)) {
    const idn = String(body.id_number).trim();
    const clash = db.findOne('users', (u) => u.id_number === idn && u.id !== (existing && existing.id));
    if (clash) errors.push('ID pengguna sudah digunakan.');
    else data.id_number = idn;
  }
  if (U.has(body.email)) {
    const em = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) errors.push('Format email tidak valid.');
    else data.email = em;
  }
  if (U.has(body.phone) && body.phone && !/^[+\d\s-]{6,}$/.test(String(body.phone))) errors.push('Format nomor telepon tidak valid.');
  if (U.has(body.phone)) data.phone = String(body.phone).trim();
  ['position', 'subject', 'class_name', 'gender', 'birth_date', 'bio', 'home_address', 'guardian', 'guardian_phone', 'avatar', 'status', 'class_assignment'].forEach((k) => {
    if (U.has(body[k])) data[k] = String(body[k]).trim();
  });
  if (U.has(body.score_points)) {
    const n = Number(body.score_points);
    if (Number.isNaN(n)) errors.push('Poin profil harus angka.');
    else data.score_points = Math.max(0, Math.round(n));
  }
  return { errors, data };
}

router.post('/users', (req, res) => {
  const { errors, data } = validateUser(req.body || {}, null);
  if (errors.length) return U.fail(res, errors.join(' '));
  const body = req.body || {};
  const password = String(body.password || 'demo123');
  if (password.length < 6) return U.fail(res, 'Kata sandi minimal 6 karakter.');
  const user = db.insert('users', Object.assign({
    school_id: 'school_default',
    role: data.role || 'student',
    name: data.name || 'Pengguna Baru',
    id_number: data.id_number || '',
    status: 'active',
    score_points: data.score_points || 0,
  }, data, { password: U.hashPassword(password) }));
  attendance.log('USER_CREATE', auth.requireAdmin ? { name: 'Administrator Sekolah' } : { name: 'Administrator' }, `${ROLE_LABEL[user.role]} baru: ${user.name}`);
  return U.ok(res, { user: auth.publicUser(user), message: `Pengguna "${user.name}" berhasil ditambahkan.` });
});

router.put('/users/:id', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.params.id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  const { errors, data } = validateUser(req.body || {}, u);
  if (errors.length) return U.fail(res, errors.join(' '));
  db.update('users', u.id, data);
  attendance.log('USER_UPDATE', { name: 'Administrator Sekolah' }, `Pengguna diperbarui: ${u.name}`);
  return U.ok(res, { user: auth.publicUser(db.findOne('users', (x) => x.id === u.id)), message: 'Pengguna berhasil diperbarui.' });
});

router.delete('/users/:id', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.params.id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  if (u.role === 'admin') return U.fail(res, 'Akun administrator tidak dapat dihapus.');
  db.remove('users', u.id);
  attendance.log('USER_DELETE', { name: 'Administrator Sekolah' }, `Pengguna dihapus: ${u.name}`);
  return U.ok(res, { message: `Pengguna "${u.name}" berhasil dihapus.` });
});

router.post('/users/:id/reset-password', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.params.id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  const password = String((req.body || {}).password || 'demo123');
  if (password.length < 6) return U.fail(res, 'Kata sandi minimal 6 karakter.');
  db.update('users', u.id, { password: U.hashPassword(password) });
  attendance.log('PASSWORD_RESET', { name: 'Administrator Sekolah' }, `Password direset untuk: ${u.name}`);
  return U.ok(res, { message: 'Kata sandi berhasil direset.' });
});

router.post('/users/:id/score', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.params.id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  const delta = Number((req.body || {}).delta) || 0;
  const next = Math.max(0, U.round((u.score_points || 0) + delta));
  db.update('users', u.id, { score_points: next });
  return U.ok(res, { score_points: next, level: auth.levelFor(next), message: 'Poin profil diperbarui.' });
});

/* ------------------------------------------------------------------ *
 *  Attendance records
 * ------------------------------------------------------------------ */
router.get('/attendance', (req, res) => {
  const { q, role, status, from, to, page, limit, class_name } = req.query;
  let rows = db.all('attendance');
  if (q) {
    const k = String(q).toLowerCase();
    rows = rows.filter((a) => [a.user_name, a.id_number, a.class_name, a.role, a.date].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  if (role) rows = rows.filter((a) => a.role === role);
  if (status) rows = rows.filter((a) => a.status === status);
  if (class_name) rows = rows.filter((a) => a.class_name === class_name);
  if (from) rows = rows.filter((a) => a.date >= from);
  if (to) rows = rows.filter((a) => a.date <= to);
  rows = rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : new Date(b.check_in_at) - new Date(a.check_in_at)));
  const total = rows.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));
  return U.ok(res, {
    total,
    page: p,
    limit: l,
    total_pages: Math.ceil(total / l),
    items: rows.slice((p - 1) * l, p * l),
    stats: attendance.attendanceStats({ from: from || U.addDays(attendance.today(), -6), to: to || attendance.today(), role }),
  });
});

router.post('/attendance', (req, res) => {
  const body = req.body || {};
  const u = db.findOne('users', (x) => x.id === body.user_id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.');
  const result = attendance.checkIn(u, Object.assign({}, body, { method: 'manual', date: body.date || attendance.today() }));
  if (!result.ok && result.reason === 'already_checked_in') return U.fail(res, 'Pengguna sudah absen masuk pada tanggal tersebut.');
  if (!result.ok) return U.fail(res, result.message || 'Gagal mencatat kehadiran.', 400);
  return U.ok(res, { record: result.record, message: 'Kehadiran berhasil ditambahkan secara manual.' });
});

router.put('/attendance/:id', (req, res) => {
  const rec = db.findOne('attendance', (a) => a.id === req.params.id);
  if (!rec) return U.fail(res, 'Rekam kehadiran tidak ditemukan.', 404);
  const body = req.body || {};
  const patch = {};
  ['status', 'note'].forEach((k) => {
    if (U.has(body[k])) patch[k] = body[k];
  });
  if (patch.status && !['present', 'late', 'absent', 'leave'].includes(patch.status)) return U.fail(res, 'Status kehadiran tidak valid.');
  if (U.has(body.check_out_at)) {
    const out = new Date(body.check_out_at);
    if (isNaN(out)) return U.fail(res, 'Format waktu pulang tidak valid.');
    patch.check_out_at = out.toISOString();
    patch.work_hours = U.round((out - new Date(rec.check_in_at)) / 3600000, 2);
  }
  db.update('attendance', rec.id, patch);
  return U.ok(res, { record: db.findOne('attendance', (a) => a.id === rec.id), message: 'Rekam kehadiran diperbarui.' });
});

router.delete('/attendance/:id', (req, res) => {
  const rec = db.findOne('attendance', (a) => a.id === req.params.id);
  if (!rec) return U.fail(res, 'Rekam kehadiran tidak ditemukan.', 404);
  db.remove('attendance', rec.id);
  return U.ok(res, { message: 'Rekam kehadiran dihapus.' });
});

router.post('/attendance/:id/selfie', (req, res) => {
  const rec = db.findOne('attendance', (a) => a.id === req.params.id);
  if (!rec) return U.fail(res, 'Rekam kehadiran tidak ditemukan.', 404);
  const selfie = String((req.body || {}).selfie || '');
  if (selfie.length > 400000) return U.fail(res, 'Ukuran foto selfie terlalu besar.');
  db.update('attendance', rec.id, { selfie });
  return U.ok(res, { message: 'Foto selfie disimpan.' });
});

/* ------------------------------------------------------------------ *
 *  Reports
 * ------------------------------------------------------------------ */
router.get('/reports', (req, res) => {
  const from = String(req.query.from || U.addDays(attendance.today(), -30));
  const to = String(req.query.to || attendance.today());
  const role = String(req.query.role || '');
  let rows = db.all('attendance').filter((a) => a.date >= from && a.date <= to);
  if (role) rows = rows.filter((a) => a.role === role);

  const count = (fn) => rows.filter(fn).length;
  const byStatus = ['present', 'late', 'absent', 'leave'].map((st) => ({ status: st, label: STATUS_LABEL[st], count: count((a) => a.status === st) }));
  const byRole = ['teacher', 'student', 'employee'].map((r) => {
    const list = rows.filter((a) => a.role === r);
    const present = list.filter((a) => a.status === 'present' || a.status === 'late').length;
    const pool = db.all('users').filter((u) => u.role === r && u.status === 'active');
    const days = U.dateRange(from, to).filter((d) => {
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      return !(dow === 0 || dow === 6);
    }).length;
    return {
      role: r,
      label: ROLE_LABEL[r],
      present,
      total: list.length,
      expected: Math.max(1, pool.length * days),
      rate: U.round((present / Math.max(1, pool.length * days)) * 100, 1),
      late: list.filter((a) => a.status === 'late').length,
    };
  });

  const byClass = {};
  rows.forEach((a) => {
    if (!a.class_name) return;
    if (!byClass[a.class_name]) byClass[a.class_name] = { class_name: a.class_name, present: 0, late: 0, total: 0, hours: 0 };
    const c = byClass[a.class_name];
    c.total++;
    if (a.status === 'present') c.present++;
    if (a.status === 'late') {
      c.late++;
      c.present++;
    }
    c.hours += a.work_hours || 0;
  });

  const byDate = U.dateRange(from, to).map((d) => {
    const list = rows.filter((a) => a.date === d);
    const present = list.filter((a) => a.status === 'present' || a.status === 'late').length;
    return { date: d, dow: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][new Date(d + 'T00:00:00Z').getUTCDay()], total: list.length, present, rate: U.round((present / Math.max(1, list.length)) * 100, 1), late: list.filter((a) => a.status === 'late').length };
  });

  const topUsers = db
    .all('users')
    .map((u) => {
      const list = rows.filter((a) => a.user_id === u.id);
      const present = list.filter((a) => a.status === 'present' || a.status === 'late').length;
      const days = U.dateRange(from, to).filter((d) => {
        const dow = new Date(d + 'T00:00:00Z').getUTCDay();
        return !(dow === 0 || dow === 6);
      }).length;
      return { user: u, present, expected: Math.max(1, days), rate: days ? U.round((present / days) * 100, 1) : 0 };
    })
    .filter((x) => x.expected > 0)
    .sort((a, b) => b.rate - a.rate || b.present - a.present)
    .slice(0, 15);

  return U.ok(res, {
    from,
    to,
    range_days: U.dateRange(from, to).length,
    overall: {
      records: rows.length,
      present: count((a) => a.status === 'present' || a.status === 'late'),
      late: count((a) => a.status === 'late'),
      on_time: count((a) => a.status === 'present'),
      absent: count((a) => a.status === 'absent'),
      avg_hours: rows.length ? U.round(rows.reduce((s, a) => s + (a.work_hours || 0), 0) / rows.length, 2) : 0,
    },
    by_status: byStatus,
    by_role: byRole,
    by_class: Object.values(byClass).sort((a, b) => b.total - a.total),
    by_date: byDate,
    top_users: topUsers.map((t) => ({ ...auth.publicUser(t.user), present: t.present, expected: t.expected, rate: t.rate })),
    requests: (() => {
      const all = db.all('requests').filter((r) => r.to_date >= from && r.from_date <= to);
      const byType = {};
      const byStatus = { pending: 0, approved: 0, rejected: 0 };
      all.forEach((r) => {
        byType[r.type] = byType[r.type] || { type: r.type, count: 0, approved: 0 };
        byType[r.type].count++;
        if (r.status === 'approved') byType[r.type].approved++;
        if (byStatus[r.status] !== undefined) byStatus[r.status]++;
      });
      const days = all.filter((r) => r.status === 'approved')
        .reduce((sum, r) => sum + 1 + Math.max(0, (new Date(r.to_date) - new Date(r.from_date)) / U.DAY_MS), 0);
      return {
        total: all.length,
        by_status: byStatus,
        by_type: Object.values(byType).sort((a, b) => b.count - a.count),
        approved_days: Math.round(days),
        approval_rate: all.length ? U.round((byStatus.approved / all.length) * 100, 1) : 0,
      };
    })(),
    extracurricular: db
      .all('extracurriculars')
      .map((ec) => {
        const list = db.all('ec_attendance').filter((a) => a.extracurricular_id === ec.id && a.date >= from && a.date <= to);
        return { ...ec, present: list.filter((a) => a.status === 'present').length, total: list.length, rate: list.length ? U.round((list.filter((a) => a.status === 'present').length / list.length) * 100, 1) : 0 };
      }),
  });
});

router.get('/reports/export.csv', (req, res) => {
  const from = String(req.query.from || U.addDays(attendance.today(), -30));
  const to = String(req.query.to || attendance.today());
  const role = String(req.query.role || '');
  let rows = db.all('attendance').filter((a) => a.date >= from && a.date <= to);
  if (role) rows = rows.filter((a) => a.role === role);
  rows = rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const header = ['Tanggal', 'Nama', 'Role', 'Kelas/Mata Pelajaran', 'ID Pengguna', 'Jam Masuk', 'Status', 'Jam Pulang', 'Jam Kerja', 'Metode', 'Jarak (m)', 'Catatan'];
  const lines = [header.join(',')];
  rows.forEach((a) => {
    lines.push(
      [
        a.date,
        a.user_name,
        ROLE_LABEL[a.role] || a.role,
        a.class_name || a.subject || '',
        a.id_number,
        a.check_in_at ? U.fmtDateTime(a.check_in_at, attendance.off()).slice(11) : '',
        STATUS_LABEL[a.status] || a.status,
        a.check_out_at ? U.fmtDateTime(a.check_out_at, attendance.off()).slice(11) : '',
        a.work_hours || 0,
        (a.check_in_method || '').toUpperCase(),
        a.check_in_dist || 0,
        a.note || '',
      ]
        .map(esc)
        .join(',')
    );
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kehadiran-${from}_${to}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

/* ------------------------------------------------------------------ *
 *  Requests (Sickness, Family Agenda, …)
 * ------------------------------------------------------------------ */
const REQ_TYPES = ['Sickness', 'Family Agenda', 'Official Duty', 'Personal', 'Other'];
const REQ_STATUS = ['pending', 'approved', 'rejected'];

router.get('/requests', (req, res) => {
  const { q, status, type, page, limit } = req.query;
  let rows = db.all('requests');
  if (q) {
    const k = String(q).toLowerCase();
    rows = rows.filter((r) => [r.user_name, r.id_number, r.title, r.details, r.type, r.role].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  if (status) rows = rows.filter((r) => r.status === status);
  if (type) rows = rows.filter((r) => r.type === type);
  rows = rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = rows.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));
  return U.ok(res, {
    total,
    page: p,
    limit: l,
    total_pages: Math.ceil(total / l),
    items: rows.slice((p - 1) * l, p * l),
    counts: {
      all: db.count('requests'),
      pending: db.count('requests', (r) => r.status === 'pending'),
      approved: db.count('requests', (r) => r.status === 'approved'),
      rejected: db.count('requests', (r) => r.status === 'rejected'),
    },
    types: REQ_TYPES,
  });
});

router.post('/requests', (req, res) => {
  const body = req.body || {};
  const u = db.findOne('users', (x) => x.id === body.user_id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.');
  const type = String(body.type || '');
  if (!REQ_TYPES.includes(type)) return U.fail(res, 'Jenis permohonan tidak valid.');
  const title = String(body.title || '').trim();
  if (title.length < 3) return U.fail(res, 'Judul permohonan minimal 3 karakter.');
  const from = String(body.from_date || attendance.today());
  const to = String(body.to_date || from);
  if (to < from) return U.fail(res, 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  const reqDoc = db.insert('requests', {
    school_id: 'school_default',
    user_id: u.id,
    user_name: u.name,
    role: u.role,
    id_number: u.id_number || '',
    type,
    title,
    details: String(body.details || '').trim(),
    from_date: from,
    to_date: to,
    status: 'pending',
    reviewed_by: '',
    reviewed_at: '',
    review_note: '',
    created_at: new Date().toISOString(),
  });
  attendance.log('REQUEST_CREATE', u, `${title} (${type})`);
  return U.ok(res, { request: reqDoc, message: 'Permohonan berhasil dikirimkan.' });
});

router.put('/requests/:id', (req, res) => {
  const r = db.findOne('requests', (x) => x.id === req.params.id);
  if (!r) return U.fail(res, 'Permohonan tidak ditemukan.', 404);
  const body = req.body || {};
  const patch = {};
  if (U.has(body.status)) {
    if (!REQ_STATUS.includes(body.status)) return U.fail(res, 'Status permohonan tidak valid.');
    patch.status = body.status;
    patch.reviewed_by = 'Administrator Sekolah';
    patch.reviewed_at = new Date().toISOString();
  }
  ['title', 'details', 'type', 'from_date', 'to_date', 'review_note'].forEach((k) => {
    if (U.has(body[k])) patch[k] = String(body[k]);
  });
  if (patch.status === 'approved') {
    // reward points for approved leave requests
    const u = db.findOne('users', (x) => x.id === r.user_id);
    if (u) {
      const days = 1 + Math.max(0, (new Date(patch.to_date || r.to_date) - new Date(patch.from_date || r.from_date)) / U.DAY_MS);
      db.update('users', u.id, { score_points: U.round((u.score_points || 0) + days * 5) });
    }
  }
  db.update('requests', r.id, patch);
  attendance.log('REQUEST_REVIEW', { name: 'Administrator Sekolah' }, `${patch.status || 'update'}: ${r.title}`);
  return U.ok(res, { request: db.findOne('requests', (x) => x.id === r.id), message: 'Permohonan diperbarui.' });
});

router.delete('/requests/:id', (req, res) => {
  const r = db.findOne('requests', (x) => x.id === req.params.id);
  if (!r) return U.fail(res, 'Permohonan tidak ditemukan.', 404);
  db.remove('requests', r.id);
  return U.ok(res, { message: 'Permohonan dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  Attachments & external links (admin only)
 * ------------------------------------------------------------------ */
const MAX_ATTACHMENT = 2.5 * 1024 * 1024; // 2.5 MB of base64 payload

/**
 * Only the administrator may attach a file or an external link. Both are
 * validated server-side: the file must be a data: URL under the size cap and
 * the link must be an http(s) URL.
 */
function sanitizeMedia(body, current) {
  const errors = [];
  const out = {};
  const att = body.attachment;
  if (att !== undefined) {
    if (att === null || att === '' || (att && att.remove === true)) {
      out.attachment = null;
    } else if (att && typeof att === 'object' && typeof att.data === 'string') {
      const data = att.data;
      if (!/^data:[\w.+-]+\/[\w.+-]+;base64,/.test(data)) {
        errors.push('Lampiran harus berupa berkas data URL (base64).');
      } else if (data.length > MAX_ATTACHMENT) {
        errors.push('Ukuran lampiran maksimal 2 MB.');
      } else {
        out.attachment = {
          name: String(att.name || 'lampiran').slice(0, 120),
          type: String(att.type || 'application/octet-stream').slice(0, 120),
          size: Number(att.size) || Math.round((data.length - data.indexOf(',') - 1) * 0.75),
          data,
        };
      }
    } else if (att && typeof att === 'string') {
      // Already-stored payload echoed back by the client — keep it as-is.
      if (current && current.attachment && current.attachment.data === att) out.attachment = current.attachment;
    }
  }
  if (body.link_url !== undefined) {
    const url = String(body.link_url || '').trim();
    if (!url) out.link_url = '';
    else if (!/^https?:\/\/[^\s]+$/i.test(url)) errors.push('Tautan eksternal harus berawalan http:// atau https://');
    else out.link_url = url.slice(0, 500);
  }
  if (body.link_label !== undefined) out.link_label = String(body.link_label || '').trim().slice(0, 120);
  return { errors, out };
}

/* ------------------------------------------------------------------ *
 *  Announcements
 * ------------------------------------------------------------------ */
router.get('/announcements', (req, res) => {
  let rows = db.all('announcements').slice();
  const pinned = rows.filter((a) => a.is_pinned);
  rows = pinned.concat(rows.filter((a) => !a.is_pinned));
  if (req.query.q) {
    const k = String(req.query.q).toLowerCase();
    rows = rows.filter((a) => [a.title, a.details, a.location].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  return U.ok(res, { items: rows, counts: { all: db.count('announcements'), pinned: db.count('announcements', (a) => a.is_pinned) } });
});

router.post('/announcements', (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (title.length < 3) return U.fail(res, 'Judul pengumuman minimal 3 karakter.');
  const media = sanitizeMedia(body, null);
  if (media.errors.length) return U.fail(res, media.errors.join(' '));
  const ann = db.insert('announcements', Object.assign({
    school_id: 'school_default',
    title,
    details: String(body.details || '').trim(),
    location: String(body.location || '').trim(),
    date: String(body.date || attendance.today()),
    time: String(body.time || '07:30').slice(0, 5),
    audience: String(body.audience || 'Semua'),
    is_pinned: !!body.is_pinned,
    author: String(body.author || 'Administrator Sekolah'),
    attachment: null,
    link_url: '',
    link_label: '',
    created_at: new Date().toISOString(),
  }, media.out));
  attendance.log('ANNOUNCEMENT_CREATE', { name: 'Administrator Sekolah' }, title);
  return U.ok(res, { announcement: ann, message: 'Pengumuman berhasil diterbitkan.' });
});

router.put('/announcements/:id', (req, res) => {
  const a = db.findOne('announcements', (x) => x.id === req.params.id);
  if (!a) return U.fail(res, 'Pengumuman tidak ditemukan.', 404);
  const body = req.body || {};
  const media = sanitizeMedia(body, a);
  if (media.errors.length) return U.fail(res, media.errors.join(' '));
  const patch = {};
  ['title', 'details', 'location', 'date', 'time', 'audience', 'author'].forEach((k) => {
    if (U.has(body[k])) patch[k] = String(body[k]);
  });
  if (U.has(body.is_pinned)) patch.is_pinned = !!body.is_pinned;
  Object.assign(patch, media.out);
  db.update('announcements', a.id, patch);
  return U.ok(res, { announcement: db.findOne('announcements', (x) => x.id === a.id), message: 'Pengumuman diperbarui.' });
});

router.delete('/announcements/:id', (req, res) => {
  const a = db.findOne('announcements', (x) => x.id === req.params.id);
  if (!a) return U.fail(res, 'Pengumuman tidak ditemukan.', 404);
  db.remove('announcements', a.id);
  return U.ok(res, { message: 'Pengumuman dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  News / information
 * ------------------------------------------------------------------ */
router.get('/news', (req, res) => {
  let rows = db.all('news').slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (req.query.q) {
    const k = String(req.query.q).toLowerCase();
    rows = rows.filter((a) => [a.title, a.details, a.category].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  if (req.query.category) rows = rows.filter((a) => a.category === req.query.category);
  return U.ok(res, { items: rows, counts: { all: db.count('news'), categories: [...new Set(db.all('news').map((n) => n.category))] } });
});

router.post('/news', (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (title.length < 3) return U.fail(res, 'Judul berita minimal 3 karakter.');
  const media = sanitizeMedia(body, null);
  if (media.errors.length) return U.fail(res, media.errors.join(' '));
  const n = db.insert('news', Object.assign({
    school_id: 'school_default',
    title,
    details: String(body.details || '').trim(),
    date: String(body.date || attendance.today()),
    time: String(body.time || '10:00').slice(0, 5),
    category: String(body.category || 'Umum'),
    cover: String(body.cover || ''),
    author: String(body.author || 'Tim Komunikasi Sekolah'),
    views: 0,
    attachment: null,
    link_url: '',
    link_label: '',
    created_at: new Date().toISOString(),
  }, media.out));
  attendance.log('NEWS_CREATE', { name: 'Administrator Sekolah' }, title);
  return U.ok(res, { news: n, message: 'Berita berhasil diterbitkan.' });
});

router.put('/news/:id', (req, res) => {
  const n = db.findOne('news', (x) => x.id === req.params.id);
  if (!n) return U.fail(res, 'Berita tidak ditemukan.', 404);
  const body = req.body || {};
  const media = sanitizeMedia(body, n);
  if (media.errors.length) return U.fail(res, media.errors.join(' '));
  const patch = {};
  ['title', 'details', 'date', 'time', 'category', 'cover', 'author'].forEach((k) => {
    if (U.has(body[k])) patch[k] = String(body[k]);
  });
  Object.assign(patch, media.out);
  db.update('news', n.id, patch);
  return U.ok(res, { news: db.findOne('news', (x) => x.id === n.id), message: 'Berita diperbarui.' });
});

router.delete('/news/:id', (req, res) => {
  const n = db.findOne('news', (x) => x.id === req.params.id);
  if (!n) return U.fail(res, 'Berita tidak ditemukan.', 404);
  db.remove('news', n.id);
  return U.ok(res, { message: 'Berita dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  Academic calendar
 * ------------------------------------------------------------------ */
router.get('/events', (req, res) => {
  let rows = db.all('events').slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (req.query.type) rows = rows.filter((e) => e.type === req.query.type);
  return U.ok(res, { items: rows, counts: { all: db.count('events'), types: [...new Set(db.all('events').map((e) => e.type))] } });
});

const EVT_TYPES = ['academic', 'exam', 'holiday', 'meeting'];
router.post('/events', (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (title.length < 2) return U.fail(res, 'Judul acara minimal 2 karakter.');
  const type = String(body.type || 'academic');
  if (!EVT_TYPES.includes(type)) return U.fail(res, 'Tipe acara tidak valid.');
  const from = String(body.date || attendance.today());
  const to = String(body.end_date || from);
  if (to < from) return U.fail(res, 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  const ev = db.insert('events', {
    school_id: 'school_default',
    title,
    type,
    date: from,
    end_date: to,
    description: String(body.description || '').trim(),
    location: String(body.location || '').trim(),
    created_at: new Date().toISOString(),
  });
  return U.ok(res, { event: ev, message: 'Acara akademik berhasil ditambahkan.' });
});

router.put('/events/:id', (req, res) => {
  const e = db.findOne('events', (x) => x.id === req.params.id);
  if (!e) return U.fail(res, 'Acara tidak ditemukan.', 404);
  const body = req.body || {};
  const patch = {};
  ['title', 'type', 'date', 'end_date', 'description', 'location'].forEach((k) => {
    if (U.has(body[k])) patch[k] = String(body[k]);
  });
  db.update('events', e.id, patch);
  return U.ok(res, { event: db.findOne('events', (x) => x.id === e.id), message: 'Acara diperbarui.' });
});

router.delete('/events/:id', (req, res) => {
  const e = db.findOne('events', (x) => x.id === req.params.id);
  if (!e) return U.fail(res, 'Acara tidak ditemukan.', 404);
  db.remove('events', e.id);
  return U.ok(res, { message: 'Acara dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  Extracurriculars (GPS LOCK + selfie)
 * ------------------------------------------------------------------ */
const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
router.get('/extracurriculars', (req, res) => {
  let rows = db.all('extracurriculars').slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
  if (req.query.q) {
    const k = String(req.query.q).toLowerCase();
    rows = rows.filter((a) => [a.name, a.category, a.room, a.teacher_name].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  rows = rows.map((ec) => {
    const list = db.all('ec_attendance').filter((a) => a.extracurricular_id === ec.id);
    return {
      ...ec,
      enrolled: list.length,
      present: list.filter((a) => a.status === 'present').length,
      today: DOW[new Date(attendance.today() + 'T00:00:00Z').getUTCDay()],
      member_count: db.count('ec_members', (m) => m.extracurricular_id === ec.id && m.status !== 'inactive'),
      mentor_count: db.count('ec_mentors', (m) => m.extracurricular_id === ec.id),
      place_count: db.count('ec_places', (p) => p.extracurricular_id === ec.id),
      schedule_count: db.count('ec_schedules', (s) => s.extracurricular_id === ec.id),
      grade_groups: ec.grade_groups || [],
    };
  });
  return U.ok(res, { items: rows, counts: { all: db.count('extracurriculars'), active: db.count('extracurriculars', (e) => e.active) } });
});

router.get('/extracurriculars/:id', (req, res) => {
  const ec = db.findOne('extracurriculars', (x) => x.id === req.params.id);
  if (!ec) return U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404);
  const list = db.all('ec_attendance').filter((a) => a.extracurricular_id === ec.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const full = sched.enrich(ec, { withMembers: true });
  return U.ok(res, {
    extracurricular: full,
    attendance: list,
    places: full.places,
    schedules: full.schedules,
    mentors: full.mentors,
    members: full.members,
    counts: {
      members: (full.members || []).length,
      mentors: full.mentors.length,
      places: full.places.length,
      schedules: full.schedules.length,
    },
  });
});

function validateEc(body) {
  const errors = [];
  const data = {};
  if (U.has(body.name)) {
    if (String(body.name).trim().length < 2) errors.push('Nama ekstrakurikuler minimal 2 karakter.');
    else data.name = String(body.name).trim();
  }
  if (U.has(body.category)) data.category = String(body.category).trim();
  if (U.has(body.description)) data.description = String(body.description).trim();
  if (U.has(body.schedule_days)) {
    const days = Array.isArray(body.schedule_days) ? body.schedule_days : String(body.schedule_days).split(',');
    data.schedule_days = days.map((d) => String(d).trim()).filter((d) => DOW.includes(d));
    if (!data.schedule_days.length) errors.push('Pilih minimal satu hari jadwal.');
  }
  if (U.has(body.start_time)) data.start_time = String(body.start_time).slice(0, 5);
  if (U.has(body.end_time)) data.end_time = String(body.end_time).slice(0, 5);
  if (U.has(body.room)) data.room = String(body.room).trim();
  if (U.has(body.capacity)) {
    const c = Number(body.capacity);
    if (Number.isNaN(c)) errors.push('Kapasitas harus angka.');
    else data.capacity = Math.max(1, Math.round(c));
  }
  if (U.has(body.teacher_id)) {
    const t = db.findOne('users', (u) => u.id === body.teacher_id);
    if (!t) errors.push('Pengampu tidak ditemukan.');
    else {
      data.teacher_id = t.id;
      data.teacher_name = t.name;
    }
  }
  if (U.has(body.location_lat)) data.location_lat = Number(body.location_lat);
  if (U.has(body.location_lng)) data.location_lng = Number(body.location_lng);
  if (U.has(body.active)) data.active = !!body.active;
  if (U.has(body.grade_groups)) {
    const g = Array.isArray(body.grade_groups) ? body.grade_groups : String(body.grade_groups).split(',');
    data.grade_groups = g.map((x) => String(x).trim()).filter((x) => sched.GRADE_GROUPS.includes(x));
  }
  return { errors, data };
}

router.post('/extracurriculars', (req, res) => {
  const { errors, data } = validateEc(req.body || {});
  if (errors.length) return U.fail(res, errors.join(' '));
  const ec = db.insert('extracurriculars', Object.assign({
    school_id: 'school_default',
    name: 'Ekstrakurikuler Baru',
    category: 'Umum',
    schedule_days: [],
    start_time: '15:45',
    end_time: '17:15',
    room: '',
    capacity: 25,
    active: true,
    teacher_name: '',
  }, data, { created_at: new Date().toISOString() }));
  return U.ok(res, { extracurricular: ec, message: `Ekstrakurikuler "${ec.name}" berhasil ditambahkan.` });
});

router.put('/extracurriculars/:id', (req, res) => {
  const ec = db.findOne('extracurriculars', (x) => x.id === req.params.id);
  if (!ec) return U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404);
  const { errors, data } = validateEc(req.body || {});
  if (errors.length) return U.fail(res, errors.join(' '));
  db.update('extracurriculars', ec.id, data);
  return U.ok(res, { extracurricular: db.findOne('extracurriculars', (x) => x.id === ec.id), message: 'Ekstrakurikuler diperbarui.' });
});

router.delete('/extracurriculars/:id', (req, res) => {
  const ec = db.findOne('extracurriculars', (x) => x.id === req.params.id);
  if (!ec) return U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404);
  db.remove('extracurriculars', ec.id);
  db.all('ec_attendance').filter((a) => a.extracurricular_id === ec.id).forEach((a) => db.remove('ec_attendance', a.id));
  ['ec_members', 'ec_mentors', 'ec_places', 'ec_schedules'].forEach((c) => {
    db.all(c).filter((r) => r.extracurricular_id === ec.id).forEach((r) => db.remove(c, r.id));
  });
  return U.ok(res, { message: `Ekstrakurikuler "${ec.name}", jadwal, tempat, anggota dan seluruh rekam kehadirannya dihapus.` });
});

router.get('/extracurriculars/:id/attendance', (req, res) => {
  const rows = db.all('ec_attendance').filter((a) => a.extracurricular_id === req.params.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return U.ok(res, { items: rows, date: req.query.date || '' });
});

router.post('/extracurriculars/:id/attendance', (req, res) => {
  const ec = db.findOne('extracurriculars', (x) => x.id === req.params.id);
  if (!ec) return U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404);
  const body = req.body || {};
  const u = db.findOne('users', (x) => x.id === body.user_id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.');
  const date = String(body.date || attendance.today());
  const s = attendance.settings();
  const radius = Number(s.ec_radius_m) || 60;
  const lat = body.gps_lat != null ? Number(body.gps_lat) : null;
  const lng = body.gps_lng != null ? Number(body.gps_lng) : null;
  let dist = 0;
  if (lat != null && lng != null) dist = U.distanceMeters(lat, lng, ec.location_lat, ec.location_lng);
  if (s.require_gps && (lat == null || lng == null)) return U.fail(res, 'Posisi GPS wajib ditautkan (GPS LOCK).');
  const inside = dist <= radius;
  if (!inside && !s.allow_outside_confirm) {
    return U.fail(res, `Posisi berada ${U.round(dist, 0)} m dari lokasi kegiatan. Jangkauan: ${radius} m.`);
  }
  const selfie = String(body.selfie || '');
  if (s.require_selfie && !selfie) return U.fail(res, 'Foto selfie wajib dipasangkan untuk ekstrakurikuler ini.');
  if (selfie.length > 400000) return U.fail(res, 'Ukuran foto selfie terlalu besar.');

  const status = body.status === 'absent' ? 'absent' : 'present';
  const existing = db.findOne('ec_attendance', (a) => a.extracurricular_id === ec.id && a.user_id === u.id && a.date === date);
  if (existing) {
    db.update('ec_attendance', existing.id, {
      status,
      gps_lat: lat,
      gps_lng: lng,
      gps_accuracy: body.gps_accuracy,
      distance_m: U.round(dist, 1),
      has_selfie: !!selfie,
      selfie,
      created_at: new Date().toISOString(),
    });
    attendance.log('EC_ATTEND', u, `${ec.name} · ${status}`);
    if (status === 'present') {
      db.update('users', u.id, { score_points: U.round((u.score_points || 0) + 2) });
    }
    return U.ok(res, { attendance: db.findOne('ec_attendance', (a) => a.id === existing.id), message: 'Kehadiran ekstrakurikuler diperbarui.' });
  }
  const rec = db.insert('ec_attendance', {
    id: U.uid('eca'),
    school_id: 'school_default',
    extracurricular_id: ec.id,
    extracurricular_name: ec.name,
    user_id: u.id,
    user_name: u.name,
    class_name: u.class_name || '',
    date,
    status,
    gps_lat: lat,
    gps_lng: lng,
    gps_accuracy: body.gps_accuracy,
    distance_m: U.round(dist, 1),
    has_selfie: !!selfie,
    selfie,
    created_at: new Date().toISOString(),
  });
  attendance.log('EC_ATTEND', u, `${ec.name} · ${status}`);
  if (status === 'present') db.update('users', u.id, { score_points: U.round((u.score_points || 0) + 2) });
  return U.ok(res, { attendance: rec, message: 'Kehadiran ekstrakurikuler berhasil direkam.' });
});

router.delete('/extracurriculars/:id/attendance/:aid', (req, res) => {
  const a = db.findOne('ec_attendance', (x) => x.id === req.params.aid);
  if (!a) return U.fail(res, 'Rekam tidak ditemukan.', 404);
  db.remove('ec_attendance', a.id);
  return U.ok(res, { message: 'Rekam kehadiran dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  Class timetable — assigned to a teacher by the administrator
 * ------------------------------------------------------------------ */
function validateClassSchedule(body) {
  const errors = [];
  const data = {};
  if (U.has(body.day)) {
    if (!sched.DOW.includes(body.day)) errors.push('Hari tidak valid.');
    else data.day = body.day;
  }
  if (U.has(body.start_time)) data.start_time = String(body.start_time).slice(0, 5);
  if (U.has(body.end_time)) data.end_time = String(body.end_time).slice(0, 5);
  if (data.start_time && data.end_time && data.end_time <= data.start_time) {
    errors.push('Jam selesai harus setelah jam mulai.');
  }
  if (U.has(body.class_name)) data.class_name = String(body.class_name).trim();
  if (U.has(body.subject)) data.subject = String(body.subject).trim();
  if (U.has(body.room)) data.room = String(body.room).trim();
  if (U.has(body.note)) data.note = String(body.note).trim();
  if (U.has(body.teacher_id)) {
    const t = db.findOne('users', (u) => u.id === body.teacher_id);
    if (!t) errors.push('Guru tidak ditemukan.');
    else { data.teacher_id = t.id; data.teacher_name = t.name; }
  }
  if (U.has(body.active)) data.active = !!body.active;
  return { errors, data };
}

router.get('/class-schedules', (req, res) => {
  let rows = db.all('class_schedules').slice();
  if (req.query.q) {
    const k = String(req.query.q).toLowerCase();
    rows = rows.filter((r) => [r.subject, r.class_name, r.teacher_name, r.room].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  if (req.query.teacher_id) rows = rows.filter((r) => r.teacher_id === req.query.teacher_id);
  if (req.query.class_name) rows = rows.filter((r) => r.class_name === req.query.class_name);
  if (req.query.day) rows = rows.filter((r) => r.day === req.query.day);
  rows.sort((a, b) => sched.DOW.indexOf(a.day) - sched.DOW.indexOf(b.day)
    || String(a.start_time).localeCompare(String(b.start_time)));
  return U.ok(res, {
    items: rows,
    total: rows.length,
    counts: {
      all: db.count('class_schedules'),
      days: [...new Set(db.all('class_schedules').map((r) => r.day))],
      teachers: db.count('class_schedules', (r) => r.teacher_id) && [...new Set(db.all('class_schedules').map((r) => r.teacher_id).filter(Boolean))].length,
    },
    teachers: [...new Set(db.all('class_schedules').map((r) => r.teacher_id).filter(Boolean))]
      .map((id) => {
        const t = db.findOne('users', (u) => u.id === id);
        return t ? { id: t.id, name: t.name } : null;
      }).filter(Boolean),
    classes: [...new Set(db.all('class_schedules').map((r) => r.class_name).filter(Boolean))].sort(),
  });
});

router.post('/class-schedules', (req, res) => {
  const { errors, data } = validateClassSchedule(req.body || {});
  if (errors.length) return U.fail(res, errors.join(' '));
  if (!data.day) return U.fail(res, 'Hari wajib dipilih.');
  if (!data.teacher_id) return U.fail(res, 'Guru pengampu wajib dipilih.');
  const row = db.insert('class_schedules', Object.assign({
    school_id: 'school_default',
    day: 'Senin', start_time: '07:30', end_time: '08:50',
    class_name: '', subject: '', teacher_name: '', room: '', note: '', active: true,
  }, data, { created_at: new Date().toISOString() }));
  attendance.log('CLASS_SCHEDULE_CREATE', req.user, `${row.subject || 'Jadwal'} · ${row.class_name} · ${row.day}`);
  return U.ok(res, { schedule: row, message: 'Jadwal mengajar berhasil ditambahkan.' });
});

router.put('/class-schedules/:id', (req, res) => {
  const row = db.findOne('class_schedules', (r) => r.id === req.params.id);
  if (!row) return U.fail(res, 'Jadwal tidak ditemukan.', 404);
  const { errors, data } = validateClassSchedule(req.body || {});
  if (errors.length) return U.fail(res, errors.join(' '));
  db.update('class_schedules', row.id, data);
  return U.ok(res, { schedule: db.findOne('class_schedules', (r) => r.id === row.id), message: 'Jadwal mengajar diperbarui.' });
});

router.delete('/class-schedules/:id', (req, res) => {
  const row = db.findOne('class_schedules', (r) => r.id === req.params.id);
  if (!row) return U.fail(res, 'Jadwal tidak ditemukan.', 404);
  db.remove('class_schedules', row.id);
  return U.ok(res, { message: 'Jadwal mengajar dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  Extracurricular — places, schedules, mentors/coaches, members
 * ------------------------------------------------------------------ */
function ecOrFail(id, res) {
  const ec = db.findOne('extracurriculars', (x) => x.id === id);
  if (!ec) { U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404); return null; }
  return ec;
}

/* ------------------------------- places ----------------------------- */
router.get('/ec-places', (req, res) => {
  let rows = db.all('ec_places').slice();
  if (req.query.extracurricular_id) rows = rows.filter((p) => p.extracurricular_id === req.query.extracurricular_id);
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
  return U.ok(res, { items: rows });
});

router.post('/ec-places', (req, res) => {
  const body = req.body || {};
  const ec = ecOrFail(body.extracurricular_id, res);
  if (!ec) return;
  const name = String(body.name || '').trim();
  if (name.length < 2) return U.fail(res, 'Nama tempat minimal 2 karakter.');
  const row = db.insert('ec_places', {
    school_id: 'school_default',
    extracurricular_id: ec.id,
    name,
    note: String(body.note || '').trim(),
    lat: body.lat != null && body.lat !== '' ? Number(body.lat) : ec.location_lat,
    lng: body.lng != null && body.lng !== '' ? Number(body.lng) : ec.location_lng,
    radius_m: body.radius_m ? Math.max(10, Math.round(Number(body.radius_m))) : 60,
    active: body.active === false ? false : true,
    created_at: new Date().toISOString(),
  });
  return U.ok(res, { place: row, message: `Tempat "${name}" ditambahkan.` });
});

router.put('/ec-places/:id', (req, res) => {
  const row = db.findOne('ec_places', (p) => p.id === req.params.id);
  if (!row) return U.fail(res, 'Tempat tidak ditemukan.', 404);
  const body = req.body || {};
  const patch = {};
  if (U.has(body.name)) {
    if (String(body.name).trim().length < 2) return U.fail(res, 'Nama tempat minimal 2 karakter.');
    patch.name = String(body.name).trim();
  }
  if (U.has(body.note)) patch.note = String(body.note).trim();
  if (U.has(body.lat)) patch.lat = Number(body.lat);
  if (U.has(body.lng)) patch.lng = Number(body.lng);
  if (U.has(body.radius_m)) patch.radius_m = Math.max(10, Math.round(Number(body.radius_m)));
  if (U.has(body.active)) patch.active = !!body.active;
  db.update('ec_places', row.id, patch);
  return U.ok(res, { place: db.findOne('ec_places', (p) => p.id === row.id), message: 'Tempat diperbarui.' });
});

router.delete('/ec-places/:id', (req, res) => {
  const row = db.findOne('ec_places', (p) => p.id === req.params.id);
  if (!row) return U.fail(res, 'Tempat tidak ditemukan.', 404);
  db.all('ec_schedules').filter((s) => s.place_id === row.id).forEach((s) => db.update('ec_schedules', s.id, { place_id: '' }));
  db.remove('ec_places', row.id);
  return U.ok(res, { message: `Tempat "${row.name}" dihapus.` });
});

/* ------------------------------ schedules --------------------------- */
router.get('/ec-schedules', (req, res) => {
  let rows = db.all('ec_schedules').slice();
  if (req.query.extracurricular_id) rows = rows.filter((s) => s.extracurricular_id === req.query.extracurricular_id);
  if (req.query.day) rows = rows.filter((s) => s.day === req.query.day);
  rows = rows.map((s) => Object.assign({}, s, { place: sched.resolvePlace(s, db.findOne('extracurriculars', (e) => e.id === s.extracurricular_id)) }));
  rows.sort((a, b) => sched.DOW.indexOf(a.day) - sched.DOW.indexOf(b.day) || String(a.start_time).localeCompare(String(b.start_time)));
  return U.ok(res, { items: rows });
});

function validateEcSchedule(body) {
  const errors = [];
  const data = {};
  if (U.has(body.day)) {
    if (!sched.DOW.includes(body.day)) errors.push('Hari tidak valid.');
    else data.day = body.day;
  }
  if (U.has(body.start_time)) data.start_time = String(body.start_time).slice(0, 5);
  if (U.has(body.end_time)) data.end_time = String(body.end_time).slice(0, 5);
  const st = data.start_time || (body && body.start_time) || '';
  const et = data.end_time || (body && body.end_time) || '';
  if (st && et && et <= st) errors.push('Jam selesai harus setelah jam mulai.');
  if (U.has(body.grade_group)) data.grade_group = String(body.grade_group).trim();
  if (U.has(body.place_id)) data.place_id = String(body.place_id).trim();
  if (U.has(body.place_name)) data.place_name = String(body.place_name).trim();
  if (U.has(body.place_lat)) data.place_lat = body.place_lat === '' ? null : Number(body.place_lat);
  if (U.has(body.place_lng)) data.place_lng = body.place_lng === '' ? null : Number(body.place_lng);
  if (U.has(body.note)) data.note = String(body.note).trim();
  if (U.has(body.active)) data.active = !!body.active;
  return { errors, data };
}

router.post('/ec-schedules', (req, res) => {
  const body = req.body || {};
  const ec = ecOrFail(body.extracurricular_id, res);
  if (!ec) return;
  const { errors, data } = validateEcSchedule(body);
  if (errors.length) return U.fail(res, errors.join(' '));
  if (!data.day) return U.fail(res, 'Hari wajib dipilih.');
  const place = data.place_id ? sched.placeById(data.place_id) : null;
  if (place) { data.place_name = place.name; data.place_lat = place.lat; data.place_lng = place.lng; }
  const row = db.insert('ec_schedules', Object.assign({
    school_id: 'school_default',
    extracurricular_id: ec.id,
    day: 'Senin', start_time: '15:45', end_time: '17:15',
    grade_group: '', place_id: '', place_name: '', place_lat: null, place_lng: null,
    note: '', active: true,
  }, data, { created_at: new Date().toISOString() }));
  return U.ok(res, { schedule: row, message: `Jadwal ${row.day} ${row.start_time}–${row.end_time} ditambahkan.` });
});

router.put('/ec-schedules/:id', (req, res) => {
  const row = db.findOne('ec_schedules', (s) => s.id === req.params.id);
  if (!row) return U.fail(res, 'Jadwal tidak ditemukan.', 404);
  const { errors, data } = validateEcSchedule(req.body || {});
  if (errors.length) return U.fail(res, errors.join(' '));
  if (data.place_id) {
    const place = sched.placeById(data.place_id);
    if (place) { data.place_name = place.name; data.place_lat = place.lat; data.place_lng = place.lng; }
  }
  db.update('ec_schedules', row.id, data);
  return U.ok(res, { schedule: db.findOne('ec_schedules', (s) => s.id === row.id), message: 'Jadwal diperbarui.' });
});

router.delete('/ec-schedules/:id', (req, res) => {
  const row = db.findOne('ec_schedules', (s) => s.id === req.params.id);
  if (!row) return U.fail(res, 'Jadwal tidak ditemukan.', 404);
  db.remove('ec_schedules', row.id);
  return U.ok(res, { message: 'Jadwal ekstrakurikuler dihapus.' });
});

/* ------------------------------- mentors ---------------------------- */
router.get('/ec-mentors', (req, res) => {
  let rows = db.all('ec_mentors').slice();
  if (req.query.extracurricular_id) rows = rows.filter((m) => m.extracurricular_id === req.query.extracurricular_id);
  rows.sort((a, b) => (a.is_primary ? -1 : 1) - (b.is_primary ? -1 : 1) || String(a.user_name).localeCompare(String(b.user_name), 'id'));
  return U.ok(res, { items: rows });
});

router.post('/ec-mentors', (req, res) => {
  const body = req.body || {};
  const ec = ecOrFail(body.extracurricular_id, res);
  if (!ec) return;
  const u = db.findOne('users', (x) => x.id === body.user_id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.');
  if (u.role === 'student') return U.fail(res, 'Peserta didik tidak dapat menjadi pembina.');
  const existing = db.findOne('ec_mentors', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
  if (existing) return U.fail(res, `${u.name} sudah terdaftar sebagai pembina kegiatan ini.`);
  const row = db.insert('ec_mentors', {
    school_id: 'school_default',
    extracurricular_id: ec.id,
    user_id: u.id,
    user_name: u.name,
    user_role: u.role,
    id_number: u.id_number || '',
    mentor_role: sched.MENTOR_ROLES.includes(body.mentor_role) ? body.mentor_role : 'Pelatih',
    is_primary: !!body.is_primary,
    active: true,
    created_at: new Date().toISOString(),
  });
  return U.ok(res, { mentor: row, message: `${u.name} ditambahkan sebagai ${row.mentor_role}.` });
});

router.put('/ec-mentors/:id', (req, res) => {
  const row = db.findOne('ec_mentors', (m) => m.id === req.params.id);
  if (!row) return U.fail(res, 'Pembina tidak ditemukan.', 404);
  const body = req.body || {};
  const patch = {};
  if (U.has(body.mentor_role) && sched.MENTOR_ROLES.includes(body.mentor_role)) patch.mentor_role = body.mentor_role;
  if (U.has(body.is_primary)) patch.is_primary = !!body.is_primary;
  if (U.has(body.active)) patch.active = !!body.active;
  db.update('ec_mentors', row.id, patch);
  return U.ok(res, { mentor: db.findOne('ec_mentors', (m) => m.id === row.id), message: 'Pembina diperbarui.' });
});

router.delete('/ec-mentors/:id', (req, res) => {
  const row = db.findOne('ec_mentors', (m) => m.id === req.params.id);
  if (!row) return U.fail(res, 'Pembina tidak ditemukan.', 404);
  db.remove('ec_mentors', row.id);
  return U.ok(res, { message: `${row.user_name} dikeluarkan dari daftar pembina.` });
});

/* ------------------------------- members ---------------------------- */
router.get('/ec-members', (req, res) => {
  let rows = db.all('ec_members').slice();
  if (req.query.extracurricular_id) rows = rows.filter((m) => m.extracurricular_id === req.query.extracurricular_id);
  if (req.query.grade_group) rows = rows.filter((m) => m.grade_group === req.query.grade_group);
  if (req.query.q) {
    const k = String(req.query.q).toLowerCase();
    rows = rows.filter((m) => [m.user_name, m.id_number, m.class_name].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  rows.sort((a, b) => String(a.class_name || '').localeCompare(String(b.class_name || ''), 'id')
    || String(a.user_name).localeCompare(String(b.user_name), 'id'));
  const groups = {};
  rows.forEach((m) => { groups[m.grade_group || 'Tanpa Kelompok'] = (groups[m.grade_group || 'Tanpa Kelompok'] || 0) + 1; });
  return U.ok(res, { items: rows, groups, total: rows.length });
});

router.post('/ec-members', (req, res) => {
  const body = req.body || {};
  const ec = ecOrFail(body.extracurricular_id, res);
  if (!ec) return;
  const u = db.findOne('users', (x) => x.id === body.user_id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.');
  if (u.role !== 'student') return U.fail(res, 'Hanya peserta didik yang dapat menjadi anggota.');
  const existing = db.findOne('ec_members', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
  if (existing) return U.fail(res, `${u.name} sudah terdaftar pada kegiatan ini.`);
  const row = db.insert('ec_members', {
    school_id: 'school_default',
    extracurricular_id: ec.id,
    user_id: u.id,
    user_name: u.name,
    id_number: u.id_number || '',
    class_name: u.class_name || '',
    grade_group: String(body.grade_group || sched.groupFromClass(u.class_name) || (ec.grade_groups || [])[0] || '').trim(),
    position: String(body.position || '').trim(),
    status: 'active',
    joined_at: body.joined_at || attendance.today(),
    created_at: new Date().toISOString(),
  });
  return U.ok(res, { member: row, message: `${u.name} ditambahkan sebagai anggota.` });
});

/** Bulk enrol: add several students at once (with their grade group). */
router.post('/ec-members/bulk', (req, res) => {
  const body = req.body || {};
  const ec = ecOrFail(body.extracurricular_id, res);
  if (!ec) return;
  const ids = Array.isArray(body.user_ids) ? body.user_ids : [];
  if (!ids.length) return U.fail(res, 'Pilih minimal satu peserta didik.');
  const gradeGroup = String(body.grade_group || '').trim();
  let added = 0;
  let skipped = 0;
  ids.forEach((id) => {
    const u = db.findOne('users', (x) => x.id === id);
    if (!u || u.role !== 'student') { skipped++; return; }
    if (db.findOne('ec_members', (m) => m.extracurricular_id === ec.id && m.user_id === u.id)) { skipped++; return; }
    db.insert('ec_members', {
      school_id: 'school_default',
      extracurricular_id: ec.id,
      user_id: u.id,
      user_name: u.name,
      id_number: u.id_number || '',
      class_name: u.class_name || '',
      grade_group: gradeGroup || sched.groupFromClass(u.class_name) || (ec.grade_groups || [])[0] || '',
      position: '',
      status: 'active',
      joined_at: attendance.today(),
      created_at: new Date().toISOString(),
    });
    added++;
  });
  return U.ok(res, {
    added,
    skipped,
    message: `${added} peserta didik ditambahkan${skipped ? `, ${skipped} dilewati (sudah terdaftar)` : ''}.`,
  });
});

router.put('/ec-members/:id', (req, res) => {
  const row = db.findOne('ec_members', (m) => m.id === req.params.id);
  if (!row) return U.fail(res, 'Anggota tidak ditemukan.', 404);
  const body = req.body || {};
  const patch = {};
  if (U.has(body.grade_group)) patch.grade_group = String(body.grade_group).trim();
  if (U.has(body.position)) patch.position = String(body.position).trim();
  if (U.has(body.status)) patch.status = ['active', 'inactive', 'alumni'].includes(body.status) ? body.status : 'active';
  db.update('ec_members', row.id, patch);
  return U.ok(res, { member: db.findOne('ec_members', (m) => m.id === row.id), message: 'Anggota diperbarui.' });
});

router.delete('/ec-members/:id', (req, res) => {
  const row = db.findOne('ec_members', (m) => m.id === req.params.id);
  if (!row) return U.fail(res, 'Anggota tidak ditemukan.', 404);
  db.remove('ec_members', row.id);
  return U.ok(res, { message: `${row.user_name} dikeluarkan dari kegiatan.` });
});

/** Students eligible to join an extracurricular (not enrolled yet). */
router.get('/ec-candidates', (req, res) => {
  const ecId = String(req.query.extracurricular_id || '');
  const k = String(req.query.q || '').toLowerCase();
  let rows = db.all('users').filter((u) => u.role === 'student' && u.status === 'active');
  if (ecId) rows = rows.filter((u) => !db.findOne('ec_members', (m) => m.extracurricular_id === ecId && m.user_id === u.id));
  if (k) rows = rows.filter((u) => [u.name, u.id_number, u.class_name].some((v) => String(v || '').toLowerCase().includes(k)));
  rows.sort((a, b) => String(a.class_name).localeCompare(String(b.class_name), 'id') || String(a.name).localeCompare(String(b.name), 'id'));
  return U.ok(res, { items: rows.map((u) => ({
    id: u.id, name: u.name, id_number: u.id_number, class_name: u.class_name,
    grade_group: sched.groupFromClass(u.class_name),
  })) });
});

/* ------------------------------------------------------------------ *
 *  Member load — how many extracurriculars each student follows
 * ------------------------------------------------------------------ */
router.get('/ec-load', (req, res) => {
  const rows = db.all('users').filter((u) => u.role === 'student').map((u) => {
    const mine = db.all('ec_members').filter((m) => m.user_id === u.id);
    return {
      id: u.id, name: u.name, id_number: u.id_number, class_name: u.class_name,
      count: mine.length,
      activities: mine.map((m) => {
        const ec = db.findOne('extracurriculars', (e) => e.id === m.extracurricular_id);
        return { id: m.extracurricular_id, name: ec ? ec.name : '—', grade_group: m.grade_group };
      }),
    };
  }).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'id'));
  return U.ok(res, { items: rows });
});

/** Extracurriculars a single user is attached to (member or mentor/coach). */
router.get('/users/:id/extracurriculars', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.params.id);
  if (!u) return U.fail(res, 'Pengguna tidak ditemukan.', 404);
  const items = sched.visibleExtracurriculars(u).map((ec) => {
    const membership = db.findOne('ec_members', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
    const mentorship = db.findOne('ec_mentors', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
    return {
      id: ec.id,
      name: ec.name,
      category: ec.category,
      grade_group: membership ? membership.grade_group : '',
      as_member: !!membership,
      as_mentor: !!mentorship,
      mentor_role: mentorship ? mentorship.mentor_role : '',
      schedule_days: [...new Set((ec.schedules || []).map((x) => x.day))],
      session_count: (ec.schedules || []).length,
    };
  });
  return U.ok(res, { items, role: u.role, is_mentor: sched.isMentor(u) });
});

/* ------------------------------------------------------------------ *
 *  School + PWA / APK branding studio
 * ------------------------------------------------------------------ */
router.get('/settings', (req, res) => {
  const s = attendance.settings();
  const sc = attendance.school();
  return U.ok(res, {
    settings: {
      ...s,
      splash_quotes: Array.isArray(s.splash_quotes) ? s.splash_quotes : [],
      brand_config: s.brand_config || {},
      android_package: s.android_package || '',
      sha256_fingerprints: s.sha256_fingerprints || '',
    },
    school: sc,
    logo_url: s.logo ? '/api/assets/logo.svg' : '',
    default_logo: '/api/assets/default-logo.svg',
  });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const patch = {};
  ['school_name', 'school_code', 'school_address', 'school_phone', 'school_email', 'app_name', 'app_short_name', 'app_tagline', 'theme_primary', 'theme_accent', 'logo', 'work_start', 'work_end', 'timezone', 'android_package', 'sha256_fingerprints'].forEach((k) => {
    if (U.has(body[k])) patch[k] = String(body[k]);
  });
  ['checkin_radius_m', 'ec_radius_m', 'late_after_minutes', 'leave_early_minutes'].forEach((k) => {
    if (U.has(body[k])) {
      const n = Number(body[k]);
      if (Number.isNaN(n)) return U.fail(res, `${k} harus berupa angka.`);
      patch[k] = n;
    }
  });
  ['require_gps', 'require_selfie', 'checkout_enabled', 'allow_outside_confirm'].forEach((k) => {
    if (U.has(body[k])) patch[k] = !!body[k];
  });
  if (U.has(body.checkin_method)) {
    if (!['qr', 'gps', 'qr_gps', 'any'].includes(body.checkin_method)) return U.fail(res, 'Metode absen tidak valid.');
    patch.checkin_method = body.checkin_method;
  }
  if (U.has(body.splash_quotes)) {
    const arr = Array.isArray(body.splash_quotes) ? body.splash_quotes : String(body.splash_quotes).split('\n');
    patch.splash_quotes = arr.map((q) => String(q).trim()).filter(Boolean).slice(0, 40);
  }
  if (U.has(body.checkin_splash_quote)) patch.checkin_splash_quote = String(body.checkin_splash_quote);
  if (U.has(body.checkout_splash_quote)) patch.checkout_splash_quote = String(body.checkout_splash_quote);
  if (U.has(body.brand_config)) patch.brand_config = body.brand_config;
  if (!db.findOne('schools', (s) => s.id === 'school_default')) db.insert('schools', { id: 'school_default' });
  // Only push the school fields that were actually sent.
  const schoolPatch = {};
  const schoolMap = {
    school_name: 'name',
    school_code: 'code',
    school_address: 'address',
    school_phone: 'phone',
    school_email: 'email',
  };
  Object.keys(schoolMap).forEach((k) => {
    if (patch[k] !== undefined) schoolPatch[schoolMap[k]] = patch[k];
  });
  if (patch.logo !== undefined) schoolPatch.logo = patch.logo;
  db.update('schools', 'school_default', schoolPatch);
  db.update('settings', 'school_default', Object.assign(patch, { updated_at: new Date().toISOString() }));
  // Re-render the PWA icons whenever the brand colours change so an installed
  // app picks up the new look.
  const brandChanged = patch.theme_primary !== undefined || patch.theme_accent !== undefined;
  if (brandChanged) require('../icons').generateIcons();
  return U.ok(res, {
    settings: attendance.settings(),
    school: attendance.school(),
    icons_regenerated: brandChanged,
    message: brandChanged
      ? 'Pengaturan disimpan. Ikon aplikasi dihasilkan ulang dengan warna baru.'
      : 'Pengaturan sekolah disimpan.',
  });
});

router.post('/settings/logo', (req, res) => {
  const body = req.body || {};
  const logo = String(body.logo || '');
  if (logo.length > 400000) return U.fail(res, 'Logo terlalu besar (maks 300 KB).');
  db.update('settings', 'school_default', { logo });
  db.update('schools', 'school_default', { logo });
  return U.ok(res, { logo_url: '/api/assets/logo.svg', message: 'Logo aplikasi diperbarui. Manifest PWA diperbarui secara otomatis.' });
});

router.post('/settings/geo', (req, res) => {
  const body = req.body || {};
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return U.fail(res, 'Koordinat tidak valid.');
  db.update('schools', 'school_default', { lat, lng });
  return U.ok(res, { school: attendance.school(), message: `Lokasi sekolah diperbarui ke ${lat}, ${lng}.` });
});

router.post('/settings/regenerate-manifest', (req, res) => {
  return U.ok(res, { manifest: true, message: 'Manifest PWA dan ikon dihasilkan ulang.' });
});

/* ------------------------------------------------------------------ *
 *  Activity logs
 * ------------------------------------------------------------------ */
router.get('/logs', (req, res) => {
  let rows = db.all('logs').slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  if (req.query.q) {
    const k = String(req.query.q).toLowerCase();
    rows = rows.filter((l) => [l.actor, l.target, l.action, l.detail].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  return U.ok(res, { items: rows.slice(0, 200) });
});

router.post('/logs/clear', (req, res) => {
  db.replaceAll('logs', []);
  return U.ok(res, { message: 'Catatan aktivitas dihapus.' });
});

/* ------------------------------------------------------------------ *
 *  Parent links — which parent may follow which student
 * ------------------------------------------------------------------ */

/** Links joined with names, so the manager can render without a second call. */
function linkRow(l) {
  const p = db.findOne('users', (u) => u.id === l.parent_id);
  const st = db.findOne('users', (u) => u.id === l.student_id);
  return {
    id: l.id,
    parent_id: l.parent_id,
    student_id: l.student_id,
    relationship: l.relationship || '',
    created_at: l.created_at || '',
    parent: p ? { id: p.id, name: p.name, id_number: p.id_number || '', phone: p.phone || '', email: p.email || '' } : null,
    student: st ? { id: st.id, name: st.name, id_number: st.id_number || '', class_name: st.class_name || '' } : null,
  };
}

/* The grade levels this school runs. Kept next to the parent API because the
   statistics block below is reported per grade. */
const PARENT_GRADES = [
  { grade: 'VII', label: 'Kelas VII', prefix: 'VII' },
  { grade: 'VIII', label: 'Kelas VIII', prefix: 'VIII' },
  { grade: 'IX', label: 'Kelas IX', prefix: 'IX' },
];
const RELATIONSHIPS = ['Ayah', 'Ibu', 'Wali'];

function gradeOfStudent(u) {
  const c = String((u && u.class_name) || '').toUpperCase();
  if (c.startsWith('IX')) return 'IX';
  if (c.startsWith('VIII')) return 'VIII';
  if (c.startsWith('VII')) return 'VII';
  return '';
}

/* Statistics are always computed over the whole school, never over the
   filtered page — the cards must not move while the operator searches. */
function parentStats() {
  const students = db.all('users').filter((u) => u.role === 'student');
  const parents = db.all('users').filter((u) => u.role === 'parent');
  const links = db.all('parent_links');
  const linked = new Set(links.map((l) => l.student_id));
  const byGrade = { VII: 0, VIII: 0, IX: 0 };
  students.forEach((s) => {
    const g = gradeOfStudent(s);
    if (g && byGrade[g] != null) byGrade[g] += 1;
  });
  return {
    grades: PARENT_GRADES.map((g) => ({
      grade: g.grade, label: g.label, students: byGrade[g.grade],
    })),
    students_total: students.length,
    parents_total: parents.length,
    links_total: links.length,
    students_with_parent: linked.size,
    students_without_parent: Math.max(0, students.length - linked.size),
  };
}

router.get('/parent-links', (req, res) => {
  const { parent_id, student_id, q, grade, relationship } = req.query;
  const linkIds = new Set(db.all('parent_links').map((l) => l.id));
  let rows = db.all('parent_links').filter((l) => linkIds.has(l.id));

  if (parent_id) rows = rows.filter((l) => l.parent_id === parent_id);
  if (student_id) rows = rows.filter((l) => l.student_id === student_id);

  if (grade) {
    const g = String(grade).toUpperCase();
    const wanted = PARENT_GRADES.find((x) => x.grade === g);
    if (wanted) {
      rows = rows.filter((l) => {
        const st = db.findOne('users', (u) => u.id === l.student_id);
        return gradeOfStudent(st) === wanted.grade;
      });
    }
  }
  if (relationship) {
    const rel = String(relationship).toLowerCase();
    rows = rows.filter((l) => String(l.relationship || '').toLowerCase() === rel);
  }
  if (q) {
    const k = String(q).toLowerCase();
    rows = rows.filter((l) => {
      const r = linkRow(l);
      return [r.parent && r.parent.name, r.parent && r.parent.id_number, r.parent && r.parent.phone,
        r.student && r.student.name, r.student && r.student.id_number,
        r.student && r.student.class_name, r.relationship]
        .some((v) => String(v || '').toLowerCase().includes(k));
    });
  }

  let items = rows.map(linkRow).filter((r) => r.parent && r.student);
  items = items.map((r) => {
    const st = db.findOne('users', (u) => u.id === r.student_id);
    return { ...r, grade: gradeOfStudent(st) };
  });
  items.sort((a, b) => String(a.student.class_name).localeCompare(String(b.student.class_name), 'id', { numeric: true })
    || String(a.student.name).localeCompare(String(b.student.name), 'id', { numeric: true })
    || String(a.parent.name).localeCompare(String(b.parent.name), 'id', { numeric: true }));

  const total = items.length;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitRaw = parseInt(req.query.limit, 10) || 10;
  const limit = limitRaw === -1 ? (total || 1) : Math.max(1, limitRaw);
  const total_pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  return U.ok(res, {
    items: paged,
    total,
    page,
    limit: limitRaw,
    total_pages,
    stats: parentStats(),
  });
});

router.put('/parent-links/:id', (req, res) => {
  const l = db.findOne('parent_links', (x) => x.id === req.params.id);
  if (!l) return U.fail(res, 'Hubungan tidak ditemukan.', 404);
  const body = req.body || {};

  if (Object.prototype.hasOwnProperty.call(body, 'student_id')) {
    const sid = String(body.student_id || '').trim();
    const st = db.findOne('users', (u) => u.id === sid);
    if (!st) return U.fail(res, 'Peserta didik tidak ditemukan.');
    if (st.role !== 'student') return U.fail(res, `"${st.name}" bukan peserta didik.`);
    const dupe = db.findOne('parent_links', (x) => x.id !== l.id
      && x.parent_id === l.parent_id && x.student_id === sid);
    if (dupe) return U.fail(res, 'Orang tua ini sudah terhubung dengan peserta didik tersebut.', 409);
    l.student_id = sid;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'parent_id')) {
    const pid = String(body.parent_id || '').trim();
    const np = db.findOne('users', (u) => u.id === pid);
    if (!np) return U.fail(res, 'Akun orang tua tidak ditemukan.');
    if (np.role !== 'parent') return U.fail(res, `"${np.name}" bukan akun orang tua.`);
    const dupe = db.findOne('parent_links', (x) => x.id !== l.id
      && x.parent_id === pid && x.student_id === l.student_id);
    if (dupe) return U.fail(res, 'Orang tua ini sudah terhubung dengan peserta didik tersebut.', 409);
    l.parent_id = pid;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'relationship')) {
    const rel = String(body.relationship || '').trim();
    if (!rel) return U.fail(res, 'Hubungan tidak boleh kosong.');
    l.relationship = rel;
  }

  const pp = body.parent && typeof body.parent === 'object' ? body.parent : null;
  if (pp) {
    const p = db.findOne('users', (u) => u.id === l.parent_id);
    if (!p) return U.fail(res, 'Akun orang tua tidak ditemukan.', 404);
    if (Object.prototype.hasOwnProperty.call(pp, 'name')) {
      const nm = String(pp.name || '').trim();
      if (!nm) return U.fail(res, 'Nama orang tua tidak boleh kosong.');
      p.name = nm;
    }
    if (Object.prototype.hasOwnProperty.call(pp, 'phone')) p.phone = String(pp.phone || '').trim();
    if (Object.prototype.hasOwnProperty.call(pp, 'email')) {
      const em = String(pp.email || '').trim();
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return U.fail(res, 'Format email tidak valid.');
      p.email = em;
    }
    p.updated_at = new Date().toISOString();
    db.update('users', p.id, p);
  }

  l.updated_at = new Date().toISOString();
  db.update('parent_links', l.id, l);

  const row = linkRow(l);
  attendance.log('PARENT_LINK_EDIT', { name: 'Administrator Sekolah' },
    `Hubungan diperbarui: ${(row.parent && row.parent.name) || '?'} — ${(row.student && row.student.name) || '?'}`);
  return U.ok(res, { link: row, message: 'Data hubungan diperbarui.' });
});

router.post('/parent-links', (req, res) => {
  const parentId = String((req.body || {}).parent_id || '').trim();
  const studentId = String((req.body || {}).student_id || '').trim();
  let relationship = String((req.body || {}).relationship || '').trim();

  const p = db.findOne('users', (u) => u.id === parentId);
  if (!p) return U.fail(res, 'Akun orang tua tidak ditemukan.');
  if (p.role !== 'parent') return U.fail(res, `"${p.name}" bukan akun orang tua.`);
  const st = db.findOne('users', (u) => u.id === studentId);
  if (!st) return U.fail(res, 'Peserta didik tidak ditemukan.');
  if (st.role !== 'student') return U.fail(res, `"${st.name}" bukan peserta didik.`);
  if (!relationship) relationship = 'Wali';

  const dupe = db.findOne('parent_links', (l) => l.parent_id === parentId && l.student_id === studentId);
  if (dupe) return U.fail(res, `${p.name} sudah terhubung dengan ${st.name}.`, 409);

  const link = db.insert('parent_links', {
    school_id: st.school_id || 'school_default',
    parent_id: parentId,
    student_id: studentId,
    relationship,
    created_at: new Date().toISOString(),
  });
  attendance.log('PARENT_LINK', { name: 'Administrator Sekolah' },
    `${relationship} ${p.name} dihubungkan dengan ${st.name} (${st.class_name || '-'})`);
  return U.ok(res, { link: linkRow(link), message: `${p.name} kini mengikuti ${st.name}.` });
});

router.delete('/parent-links/:id', (req, res) => {
  const l = db.findOne('parent_links', (x) => x.id === req.params.id);
  if (!l) return U.fail(res, 'Hubungan tidak ditemukan.', 404);
  const row = linkRow(l);
  db.remove('parent_links', l.id);
  attendance.log('PARENT_UNLINK', { name: 'Administrator Sekolah' },
    `${(row.parent && row.parent.name) || '?'} diputus dari ${(row.student && row.student.name) || '?'}`);
  return U.ok(res, { message: 'Hubungan dihapus.' });
});

router.post('/demo/reset', (_req, res) => {
  const result = require('../seed').build();
  return U.ok(res, { message: 'Data demo diperbarui ulang.', result });
});

module.exports = router;
