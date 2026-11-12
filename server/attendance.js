'use strict';
/** Attendance domain service: check-in / check-out, geofence, status, stats. */
const db = require('./db');
const U = require('./util');

function settings() {
  return db.findOne('settings', (s) => s.id === 'school_default') || db.all('settings')[0] || {};
}
function off() {
  return U.tzMinutes(settings().timezone || 'Asia/Jakarta');
}
function today() {
  return U.localDateStr(new Date(), off());
}
function school() {
  return db.findOne('schools', (s) => s.id === 'school_default') || db.all('schools')[0] || { lat: -7.80642, lng: 110.32308 };
}

/** Status derived from the check-in time vs. work start + late tolerance. */
function statusFor(inISO) {
  const s = settings();
  const lateMin = Number(s.late_after_minutes) || 10;
  if (!inISO) return 'absent';
  const [h, m] = String(s.work_start || '07:30').split(':').map(Number);
  const startMin = h * 60 + m;
  const d = new Date(inISO);
  const shifted = new Date(d.getTime() - off() * 60000);
  const inMin = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return inMin > startMin + lateMin ? 'late' : 'present';
}

function geofence(lat, lng, radius) {
  const sc = school();
  const dist = U.distanceMeters(Number(lat), Number(lng), sc.lat, sc.lng);
  const r = radius == null ? Number(settings().checkin_radius_m) || 120 : radius;
  return { dist, radius: r, inside: dist <= r, school: sc };
}

function recordFor(userId, date) {
  return db.findOne('attendance', (a) => a.user_id === userId && a.date === date);
}

function checkIn(user, body) {
  const s = settings();
  const date = body.date || today();
  const existing = recordFor(user.id, date);
  if (existing) {
    return { ok: false, reason: 'already_checked_in', record: existing, message: 'Anda sudah absen masuk hari ini.' };
  }
  const lat = body.lat != null ? Number(body.lat) : null;
  const lng = body.lng != null ? Number(body.lng) : null;
  const method = String(body.method || 'gps').toLowerCase();
  let geo = null;
  if (lat != null && lng != null) geo = geofence(lat, lng, s.checkin_radius_m);
  if (s.require_gps && !geo) {
    return { ok: false, reason: 'gps_required', message: 'Posisi GPS tidak terdeteksi. Izin lokasi harus diaktifkan.' };
  }
  if (geo && !geo.inside && !s.allow_outside_confirm) {
    return { ok: false, reason: 'out_of_range', geo, message: `Anda berada ${U.round(geo.dist, 0)} m dari lokasi sekolah. Jangkauan: ${geo.radius} m.` };
  }

  const inISO = new Date().toISOString();
  const rec = {
    id: U.uid('att'),
    school_id: 'school_default',
    user_id: user.id,
    user_name: user.name,
    role: user.role,
    id_number: user.id_number || '',
    class_name: user.class_name || '',
    subject: user.subject || '',
    date,
    check_in_at: inISO,
    check_in_method: method,
    check_in_lat: lat,
    check_in_lng: lng,
    check_in_dist: geo ? U.round(geo.dist, 1) : 0,
    check_in_note: body.note || '',
    status: statusFor(inISO),
    check_out_at: '',
    check_out_method: '',
    check_out_lat: 0,
    check_out_lng: 0,
    check_out_dist: 0,
    work_hours: 0,
    note: '',
    created_at: inISO,
  };
  db.insert('attendance', rec);
  log('CHECK_IN', user, `${method.toUpperCase()} · ${geo ? U.round(geo.dist, 0) + ' m' : 'tanpa GPS'}`);
  return { ok: true, record: rec, geo, message: 'Absensi masuk berhasil direkam.' };
}

function checkOut(user, body) {
  const date = body.date || today();
  const rec = recordFor(user.id, date);
  if (!rec) return { ok: false, reason: 'not_checked_in', message: 'Anda belum absen masuk hari ini.' };
  if (rec.check_out_at) return { ok: false, reason: 'already_checked_out', record: rec, message: 'Anda sudah absen pulang hari ini.' };
  const s = settings();
  const lat = body.lat != null ? Number(body.lat) : null;
  const lng = body.lng != null ? Number(body.lng) : null;
  let geo = null;
  if (lat != null && lng != null) geo = geofence(lat, lng, s.checkin_radius_m);
  const outAt = new Date();
  const outISO = outAt.toISOString();
  const hours = U.round((outAt - new Date(rec.check_in_at)) / 3600000, 2);
  db.update('attendance', rec.id, {
    check_out_at: outISO,
    check_out_method: String(body.method || 'gps').toLowerCase(),
    check_out_lat: lat,
    check_out_lng: lng,
    check_out_dist: geo ? U.round(geo.dist, 1) : 0,
    work_hours: hours > 0 ? hours : 0,
  });
  log('CHECK_OUT', user, `${String(body.method || 'gps').toUpperCase()} · ${hours} jam · ${geo ? U.round(geo.dist, 0) + ' m' : 'tanpa GPS'}`);
  return { ok: true, record: db.findOne('attendance', (a) => a.id === rec.id), geo, message: 'Absensi pulang berhasil direkam.' };
}

function log(action, user, detail) {
  db.insert('logs', {
    id: U.uid('log'),
    school_id: 'school_default',
    actor: user.name,
    actor_id: user.id,
    action,
    target: user.name,
    target_id: user.id,
    detail: detail || '',
    at: new Date().toISOString(),
  });
  if (db.count('logs') > 2500) {
    db.all('logs').sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 1500);
    db.replaceAll('logs', db.all('logs').slice(-1500));
  }
}

/** Attendance aggregation helpers used by admin + mobile dashboards. */
function attendanceStats(filters) {
  const f = filters || {};
  const from = f.from || U.addDays(today(), -6);
  const to = f.to || today();
  const role = f.role || '';
  let rows = db.all('attendance').filter(
    (a) => a.date >= from && a.date <= to && (!role || a.role === role)
  );
  const present = rows.filter((r) => r.status === 'present').length;
  const late = rows.filter((r) => r.status === 'late').length;
  const total = rows.length;
  const onTime = present + late;
  return {
    from,
    to,
    total,
    present,
    late,
    absent: 0,
    rate: total ? U.round(((onTime / total) * 100), 1) : 0,
    on_time_rate: total ? U.round((present / total) * 100, 1) : 0,
    avg_work_hours: total ? U.round(rows.reduce((s, r) => s + (r.work_hours || 0), 0) / total, 2) : 0,
  };
}

function userAttendance(userId, limit) {
  const rows = db
    .all('attendance')
    .filter((a) => a.user_id === userId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const n = limit || 60;
  return rows.slice(0, n);
}

function weeklyStats(userId) {
  const rows = db.all('attendance').filter((a) => a.user_id === userId && a.date >= U.addDays(today(), -13) && a.date <= today());
  const byDate = {};
  rows.forEach((r) => (byDate[r.date] = r));
  const days = U.dateRange(U.addDays(today(), -6), today());
  const out = days.map((d) => {
    const r = byDate[d];
    return {
      date: d,
      dow: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][new Date(d + 'T00:00:00Z').getUTCDay()],
      status: r ? r.status : 'absent',
      check_in: r ? r.check_in_at : '',
      check_out: r ? r.check_out_at : '',
      work_hours: r ? r.work_hours || 0 : 0,
    };
  });
  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  out.forEach((d) => (counts[d.status] = (counts[d.status] || 0) + 1));
  return { days: out, counts, rate: U.round((counts.present + counts.late) / out.length * 100, 1) };
}

module.exports = {
  settings,
  off,
  today,
  school,
  statusFor,
  geofence,
  recordFor,
  checkIn,
  checkOut,
  attendanceStats,
  userAttendance,
  weeklyStats,
  log,
};
