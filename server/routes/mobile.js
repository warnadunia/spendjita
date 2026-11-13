'use strict';
/** Mobile PWA API — check-in/check-out, history, requests, calendar, profile. */
const express = require('express');
const db = require('../db');
const U = require('../util');
const auth = require('../auth');
const attendance = require('../attendance');
const sched = require('../schedule');
const storage = require('../storage');

const router = express.Router();
router.use(auth.attachUser, auth.requireMember);

const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/* ------------------------------- me ------------------------------- */
router.get('/me', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.user.id);
  const todayRec = attendance.recordFor(u.id, attendance.today());
  return U.ok(res, {
    user: auth.publicUser(u),
    school: attendance.school(),
    settings: attendance.settings(),
    today: {
      date: attendance.today(),
      record: todayRec || null,
      geo: attendance.geofence(attendance.school().lat, attendance.school().lng, 0),
    },
    stats: {
      attendance: db.count('attendance', (a) => a.user_id === u.id),
      present: db.count('attendance', (a) => a.user_id === u.id && a.status === 'present'),
      late: db.count('attendance', (a) => a.user_id === u.id && a.status === 'late'),
      requests: db.count('requests', (r) => r.user_id === u.id),
      ec: db.count('ec_attendance', (a) => a.user_id === u.id),
      extracurriculars: sched.assignedEcIds(u).length,
    },
    scope: {
      is_mentor: sched.isMentor(u),
      assigned_extracurriculars: sched.assignedEcIds(u).length,
      grade_group: u.role === 'student' ? sched.groupFromClass(u.class_name) : '',
    },
    /** Sessions the member may actually record attendance for today. */
    ec_today: ecToday(u),
  });
});

/**
 * Today's extracurricular sessions for a member. Drives the floating QR
 * button: it only exists when there is something to scan for.
 */
function ecToday(u) {
  const today = attendance.today();
  const dow = sched.dowOf(today);
  if (u.role === 'admin') return [];
  return sched.ecSchedulesFor(u, today, { day: dow }).map((x) => ({
    id: x.id,
    extracurricular_id: x.extracurricular_id,
    extracurricular_name: x.extracurricular_name || '',
    start_time: x.start_time,
    end_time: x.end_time,
    day: x.day,
    grade_group: x.grade_group || '',
    place: x.place ? { id: x.place.id, name: x.place.name, lat: x.place.lat, lng: x.place.lng } : null,
    location_lat: x.location_lat,
    location_lng: x.location_lng,
    is_mentor: !!x.is_mentor,
  }));
}

/* --------------------------- check in/out ------------------------- */
router.post('/checkin', async (req, res) => {
  const body = req.body || {};
  let selfie = String(body.selfie || '');
  if (selfie) {
    selfie = await storage.uploadBase64(selfie, 'selfie');
  }
  const result = attendance.checkIn(req.user, Object.assign({ method: body.method || 'gps' }, body, { selfie }));
  if (!result.ok) {
    return U.fail(res, result.message || 'Gagal mencatat absensi masuk.', result.reason === 'out_of_range' ? 400 : 409);
  }
  const u = db.findOne('users', (x) => x.id === req.user.id);
  const points = result.record.status === 'present' ? 3 : result.record.status === 'late' ? 1 : 0;
  if (points) db.update('users', u.id, { score_points: U.round((u.score_points || 0) + points) });
  return U.ok(res, {
    record: result.record,
    geo: result.geo,
    points,
    level: auth.levelFor((u.score_points || 0) + points),
    message: result.message,
  });
});

router.post('/checkout', async (req, res) => {
  const body = req.body || {};
  let selfie = String(body.selfie || '');
  if (selfie) {
    selfie = await storage.uploadBase64(selfie, 'selfie');
  }
  const result = attendance.checkOut(req.user, Object.assign({ method: body.method || 'gps' }, body, { selfie }));
  if (!result.ok) return U.fail(res, result.message || 'Gagal mencatat absensi pulang.', 400);
  return U.ok(res, { record: result.record, geo: result.geo, message: result.message });
});

router.get('/status', (req, res) => {
  const rec = attendance.recordFor(req.user.id, attendance.today());
  return U.ok(res, { date: attendance.today(), record: rec || null });
});

/* ---------------------------- attendance --------------------------- */
router.get('/attendance', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 60);
  const rows = attendance.userAttendance(req.user.id, limit);
  const stats = attendance.attendanceStats({ from: U.addDays(attendance.today(), -30), to: attendance.today() });
  const mine = rows.slice(0, 30);
  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  mine.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
  const ecRows = db.all('ec_attendance').filter((a) => a.user_id === req.user.id).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  return U.ok(res, {
    items: rows,
    counts,
    rate: U.round((counts.present + counts.late) / Math.max(1, mine.length) * 100, 1),
    total_minutes: U.round(mine.reduce((s, r) => s + (r.work_hours || 0), 0) * 60),
    extracurriculars: ecRows,
  });
});

router.get('/weekly', (req, res) => {
  return U.ok(res, attendance.weeklyStats(req.user.id));
});

/* ----------------------------- requests ---------------------------- */
router.get('/requests', (req, res) => {
  const rows = db.all('requests').filter((r) => r.user_id === req.user.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const counts = { all: rows.length, pending: rows.filter((r) => r.status === 'pending').length, approved: rows.filter((r) => r.status === 'approved').length, rejected: rows.filter((r) => r.status === 'rejected').length };
  return U.ok(res, { items: rows, counts, types: ['Sickness', 'Family Agenda', 'Official Duty', 'Personal', 'Other'] });
});

router.post('/requests', (req, res) => {
  const body = req.body || {};
  const type = String(body.type || '');
  if (!['Sickness', 'Family Agenda', 'Official Duty', 'Personal', 'Other'].includes(type)) return U.fail(res, 'Jenis permohonan tidak valid.');
  const title = String(body.title || '').trim();
  if (title.length < 3) return U.fail(res, 'Judul permohonan minimal 3 karakter.');
  const from = String(body.from_date || attendance.today());
  const to = String(body.to_date || from);
  if (to < from) return U.fail(res, 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  const r = db.insert('requests', {
    id: U.uid('req'),
    school_id: 'school_default',
    user_id: req.user.id,
    user_name: req.user.name,
    role: req.user.role,
    id_number: req.user.id_number || '',
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
  attendance.log('REQUEST_CREATE', req.user, `${title} (${type})`);
  return U.ok(res, { request: r, message: 'Permohonan Anda dikirimkan ke administrator.' });
});

router.delete('/requests/:id', (req, res) => {
  const r = db.findOne('requests', (x) => x.id === req.params.id && x.user_id === req.user.id);
  if (!r) return U.fail(res, 'Permohonan tidak ditemukan.', 404);
  db.remove('requests', r.id);
  return U.ok(res, { message: 'Permohonan dihapus.' });
});

/* ------------------------- announcements / news -------------------- */
router.get('/announcements', (req, res) => {
  const role = req.user.role;
  let rows = db.all('announcements');
  rows = rows.filter((a) => a.audience === 'Semua' || a.audience === role || a.audience === (role === 'teacher' ? 'Guru & Karyawan' : 'Peserta Didik'));
  rows = rows.sort((a, b) => (a.is_pinned ? -1 : 1) - (b.is_pinned ? -1 : 1) || new Date(b.created_at) - new Date(a.created_at));
  return U.ok(res, { items: rows.slice(0, 20) });
});

router.get('/news', (req, res) => {
  const rows = db.all('news').slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);
  return U.ok(res, { items: rows });
});

router.post('/news/:id/view', (req, res) => {
  const n = db.findOne('news', (x) => x.id === req.params.id);
  if (!n) return U.fail(res, 'Berita tidak ditemukan.', 404);
  db.update('news', n.id, { views: (n.views || 0) + 1 });
  return U.ok(res, { views: (n.views || 0) + 1 });
});

/* --------------------------- academic calendar ---------------------- */
router.get('/events', (req, res) => {
  const rows = db.all('events').slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  return U.ok(res, { items: rows });
});

/**
 * Role-scoped detail for one calendar date.
 *
 *   student  → their daily class schedule + their extracurricular schedule
 *   teacher  → the class schedule they are assigned to teach + their EC
 *   employee → general information only
 *   coach    → the extracurricular schedules they mentor
 */
router.get('/calendar/day', (req, res) => {
  const date = String(req.query.date || attendance.today());
  const u = db.findOne('users', (x) => x.id === req.user.id);
  return U.ok(res, sched.dayDetail(u, date));
});

/** Everything happening for this member on one date (dashboard shortcut). */
router.get('/schedule/today', (req, res) => {
  const date = String(req.query.date || attendance.today());
  const u = db.findOne('users', (x) => x.id === req.user.id);
  const dow = sched.dowOf(date);
  return U.ok(res, {
    date,
    day: dow,
    role: u.role,
    class_schedule: sched.classSchedulesFor(u, date, { day: dow }),
    ec_schedule: sched.ecSchedulesFor(u, date, { day: dow }),
    events: sched.eventsOn(date),
    is_mentor: sched.isMentor(u),
  });
});

/** Weekly teaching timetable (teachers) or class timetable (students). */
router.get('/schedule/week', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.user.id);
  const days = {};
  sched.DOW.forEach((d) => {
    if (d === 'Minggu') { days[d] = []; return; }
    days[d] = sched.classSchedulesFor(u, null, { day: d });
  });
  return U.ok(res, {
    role: u.role,
    scope: u.role === 'student' ? (u.class_name || '') : (u.subject || ''),
    days,
    ec: sched.DOW.map((d) => ({ day: d, items: d === 'Minggu' ? [] : sched.ecSchedulesFor(u, null, { day: d }) })),
  });
});

/* ------------------------- extracurriculars ------------------------- */
/**
 * Scope rule: a member only ever sees the extracurriculars they are assigned
 * to — students through enrollment, teachers/coaches through mentorship.
 */
router.get('/extracurriculars', (req, res) => {
  const today = attendance.today();
  const todayDow = sched.dowOf(today);
  const u = db.findOne('users', (x) => x.id === req.user.id);
  const rows = sched.visibleExtracurriculars(u).map((ec) => {
    const list = db.all('ec_attendance')
      .filter((a) => a.extracurricular_id === ec.id && a.user_id === u.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const last = list[0] || null;
    const membership = db.findOne('ec_members', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
    const mentorship = db.findOne('ec_mentors', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
    const todaySessions = ec.schedules.filter((s) => s.day === todayDow && s.active !== false);
    return {
      ...ec,
      my_attendance: list.length,
      my_present: list.filter((a) => a.status === 'present').length,
      last_attended: last ? last.date : '',
      today: todaySessions.length > 0,
      today_sessions: todaySessions,
      my_grade_group: membership ? membership.grade_group : (mentorship ? '' : sched.groupFromClass(u.class_name)),
      my_role: mentorship ? mentorship.mentor_role : (membership ? 'Anggota' : ''),
      is_coach: !!mentorship,
      todayDow,
    };
  });
  return U.ok(res, {
    items: rows,
    today,
    todayDow,
    scope: {
      role: u.role,
      is_mentor: sched.isMentor(u),
      assigned: rows.length,
      label: u.role === 'student'
        ? 'Ekstrakurikuler yang Anda ikuti'
        : 'Ekstrakurikuler binaan Anda',
    },
  });
});

/** Full detail of one assigned extracurricular. */
router.get('/extracurriculars/:id', (req, res) => {
  const u = db.findOne('users', (x) => x.id === req.user.id);
  const ec = db.findOne('extracurriculars', (x) => x.id === req.params.id);
  if (!ec || !ec.active) return U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404);
  if (!sched.isAssigned(u, ec.id)) return U.fail(res, 'Anda tidak terdaftar pada kegiatan ini.', 403);
  const full = sched.enrich(ec, { withMembers: u.role !== 'student' });
  const today = attendance.today();
  const list = db.all('ec_attendance')
    .filter((a) => a.extracurricular_id === ec.id && a.user_id === u.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const membership = db.findOne('ec_members', (m) => m.extracurricular_id === ec.id && m.user_id === u.id);
  return U.ok(res, {
    extracurricular: full,
    my_attendance: list,
    my_stats: {
      total: list.length,
      present: list.filter((a) => a.status === 'present').length,
      absent: list.filter((a) => a.status === 'absent').length,
      rate: U.round((list.filter((a) => a.status === 'present').length / Math.max(1, list.length)) * 100, 1),
    },
    my_grade_group: membership ? membership.grade_group : '',
    peers: u.role === 'student'
      ? (full.members || []).filter((m) => m.grade_group === (membership && membership.grade_group))
      : [],
    today: sched.ecSchedulesFor(u, today).filter((s) => s.extracurricular_id === ec.id),
  });
});

router.get('/extracurriculars/:id/attendance', (req, res) => {
  const rows = db.all('ec_attendance').filter((a) => a.extracurricular_id === req.params.id && a.user_id === req.user.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return U.ok(res, { items: rows });
});

router.post('/extracurriculars/:id/attendance', async (req, res) => {
  const ec = db.findOne('extracurriculars', (x) => x.id === req.params.id);
  if (!ec) return U.fail(res, 'Ekstrakurikuler tidak ditemukan.', 404);
  if (!sched.isAssigned(req.user, ec.id)) {
    return U.fail(res, 'Anda tidak terdaftar pada kegiatan ekstrakurikuler ini.', 403);
  }
  const body = req.body || {};
  const sessionId = String(body.ec_schedule_id || '');
  let venue = { lat: ec.location_lat, lng: ec.location_lng, name: ec.room || '' };
  if (sessionId) {
    const sess = db.findOne('ec_schedules', (x) => x.id === sessionId && x.extracurricular_id === ec.id);
    if (sess) {
      const p = sched.resolvePlace(sess, ec);
      venue = { lat: p.lat, lng: p.lng, name: p.name };
    }
  }
  const s = attendance.settings();
  const radius = Number(s.ec_radius_m) || 60;
  const lat = body.gps_lat != null ? Number(body.gps_lat) : null;
  const lng = body.gps_lng != null ? Number(body.gps_lng) : null;
  if (s.require_gps && (lat == null || lng == null)) return U.fail(res, 'Posisi GPS wajib ditautkan (GPS LOCK).');
  const dist = lat != null && lng != null ? U.distanceMeters(lat, lng, venue.lat, venue.lng) : 0;
  const inside = dist <= radius;
  if (!inside && !s.allow_outside_confirm) {
    return U.fail(res, `Posisi berada ${U.round(dist, 0)} m dari lokasi kegiatan. Jangkauan: ${radius} m.`);
  }
  let selfie = String(body.selfie || '');
  if (s.require_selfie && !selfie) return U.fail(res, 'Foto selfie wajib dipasangkan untuk ekstrakurikuler ini.');
  if (selfie.length > 800000) return U.fail(res, 'Ukuran foto selfie terlalu besar.');
  if (selfie) {
    selfie = await storage.uploadBase64(selfie, 'ec-selfie');
  }
  const date = String(body.date || attendance.today());
  const status = body.status === 'absent' ? 'absent' : 'present';
  const existing = db.findOne('ec_attendance', (a) => a.extracurricular_id === ec.id && a.user_id === req.user.id && a.date === date);
  if (existing) {
    db.update('ec_attendance', existing.id, {
      status,
      gps_lat: lat,
      gps_lng: lng,
      gps_accuracy: body.gps_accuracy,
      distance_m: U.round(dist, 1),
      has_selfie: !!selfie,
      selfie,
    });
    attendance.log('EC_ATTEND', req.user, `${ec.name} · ${status}`);
    if (status === 'present') db.update('users', req.user.id, { score_points: U.round((req.user.score_points || 0) + 2) });
    return U.ok(res, { attendance: db.findOne('ec_attendance', (a) => a.id === existing.id), message: 'Kehadiran diperbarui.' });
  }
  const rec = db.insert('ec_attendance', {
    id: U.uid('eca'),
    school_id: 'school_default',
    extracurricular_id: ec.id,
    extracurricular_name: ec.name,
    user_id: req.user.id,
    user_name: req.user.name,
    class_name: req.user.class_name || '',
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
  attendance.log('EC_ATTEND', req.user, `${ec.name} · ${status}`);
  if (status === 'present') db.update('users', req.user.id, { score_points: U.round((req.user.score_points || 0) + 2) });
  return U.ok(res, { attendance: rec, message: 'Kehadiran ekstrakurikuler direkam.', points: status === 'present' ? 2 : 0 });
});

/* ----------------------------- leaderboard ------------------------- */
/**
 * Point rank — grouped purely by role. A student is only ever ranked against
 * other students, a teacher against other teachers, and so on.
 */
router.get('/leaderboard', (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const groups = sched.rankGroups(limit);
  const totals = sched.rankTotals();
  const me = db.findOne('users', (u) => u.id === req.user.id);
  const withLevel = (rows) => rows.map((r) => Object.assign({}, r, { level: auth.levelFor(r.score_points) }));
  Object.keys(groups).forEach((k) => { groups[k] = withLevel(groups[k]); });
  const mine = groups[me.role] || [];
  const pos = sched.rankOf(me);
  const myIndex = mine.findIndex((r) => r.id === me.id);
  // Always surface the member's own row, even when outside the visible top-N.
  if (myIndex < 0 && pos.row) mine.push(Object.assign({}, pos.row, { me: true }));
  return U.ok(res, {
    groups,
    totals,
    role: me.role,
    my_group: mine,
    my_rank: pos.rank,
    my_total: pos.total,
    my_percentile: pos.total ? U.round(((pos.total - pos.rank) / pos.total) * 100, 1) : 0,
    my_points: me.score_points || 0,
    me: { id: me.id, name: me.name, role: me.role, score_points: me.score_points || 0, level: auth.levelFor(me.score_points || 0) },
    // legacy flat list keeps older clients working
    items: mine,
  });
});

/* ------------------------------ data ------------------------------ */
router.get('/dashboard', (req, res) => {
  const u = req.user;
  const todayRec = attendance.recordFor(u.id, attendance.today());
  const week = attendance.weeklyStats(u.id);
  const announcements = db.all('announcements').filter((a) => a.audience === 'Semua' || a.audience === u.role).slice(0, 3);
  const news = db.all('news').slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 2);
  const events = db.all('events').filter((e) => e.end_date >= attendance.today()).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 3);
  const today = attendance.today();
  const todayDow = sched.dowOf(today);
  // Only the extracurriculars this member is actually assigned to.
  const ecRows = sched.visibleExtracurriculars(u).map((ec) => ({
    ...ec,
    enrolled: db.count('ec_attendance', (a) => a.extracurricular_id === ec.id && a.user_id === u.id && a.status === 'present'),
    today: ec.schedules.some((x) => x.day === todayDow && x.active !== false),
  }));
  return U.ok(res, {
    generated_at: new Date().toISOString(),
    date: today,
    today_record: todayRec,
    ec_today: ecToday(u),
    week,
    announcements,
    news,
    events,
    extracurriculars: ecRows,
    schedule: {
      date: today,
      day: todayDow,
      class_schedule: sched.classSchedulesFor(u, today, { day: todayDow }),
      ec_schedule: sched.ecSchedulesFor(u, today, { day: todayDow }),
    },
    stats: {
      present: db.count('attendance', (a) => a.user_id === u.id && a.status === 'present'),
      late: db.count('attendance', (a) => a.user_id === u.id && a.status === 'late'),
      total: db.count('attendance', (a) => a.user_id === u.id),
      ec: db.count('ec_attendance', (a) => a.user_id === u.id && a.status === 'present'),
    },
  });
});

module.exports = router;
