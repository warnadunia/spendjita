'use strict';
/**
 * Scheduling domain — extracurricular membership/mentorship/venues/schedules
 * plus the teacher class timetable, and the role-scoped resolution used by the
 * mobile academic calendar.
 *
 * Visibility rule enforced everywhere in this module:
 *   a member (teacher / mentor-coach / student) can only see the
 *   extracurriculars they are explicitly assigned to.
 */
const db = require('./db');
const U = require('./util');

const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
/** Grouping buckets an extracurricular can split its students into. */
const GRADE_GROUPS = ['Kelas VII', 'Kelas VIII', 'Kelas IX'];
/** Roles a person can hold on an extracurricular. */
const MENTOR_ROLES = ['Pembina', 'Pelatih', 'Asisten Pelatih'];

function dowOf(dateStr) {
  return DOW[new Date(String(dateStr) + 'T00:00:00Z').getUTCDay()];
}

/* ------------------------------------------------------------------ *
 *  Assignment / scope
 * ------------------------------------------------------------------ */

/**
 * Every extracurricular id the user is attached to, from any source:
 *  - students  → ec_members rows
 *  - teachers / employees → ec_mentors rows
 *  - legacy single-coach field `teacher_id` on the extracurricular itself
 */
function assignedEcIds(user) {
  if (!user || !user.id) return [];
  const ids = new Set();
  db.all('ec_mentors').forEach((m) => { if (m.user_id === user.id) ids.add(m.extracurricular_id); });
  db.all('ec_members').forEach((m) => {
    if (m.user_id === user.id && m.status !== 'inactive') ids.add(m.extracurricular_id);
  });
  db.all('extracurriculars').forEach((e) => { if (e.teacher_id === user.id) ids.add(e.id); });
  return [...ids];
}

function isAssigned(user, ecId) {
  return assignedEcIds(user).indexOf(ecId) >= 0;
}

/** True when the user holds a coaching/mentoring role on any EC. */
function isMentor(user) {
  if (!user || !user.id) return false;
  if (db.all('ec_mentors').some((m) => m.user_id === user.id)) return true;
  return db.all('extracurriculars').some((e) => e.teacher_id === user.id);
}

function mentorOf(user) {
  if (!user || !user.id) return [];
  return db.all('ec_mentors').filter((m) => m.user_id === user.id);
}

/** Membership rows for a student (with the EC hydrated). */
function membershipsOf(userId) {
  return db.all('ec_members').filter((m) => m.user_id === userId);
}

/**
 * Grade group a student belongs to inside one extracurricular.
 * Falls back to a group derived from the student's class name.
 */
function gradeGroupOf(user, ecId) {
  const m = db.findOne('ec_members', (x) => x.user_id === user.id && x.extracurricular_id === ecId);
  if (m && m.grade_group) return m.grade_group;
  return groupFromClass(user && user.class_name);
}

function groupFromClass(className) {
  const c = String(className || '').toUpperCase();
  // SMP grade levels. `VIII` must be tested before `VII` — "VIII-A" also
  // starts with the three characters "VII".
  if (c.startsWith('IX')) return 'Kelas IX';
  if (c.startsWith('VIII')) return 'Kelas VIII';
  if (c.startsWith('VII')) return 'Kelas VII';
  return '';
}

/* ------------------------------------------------------------------ *
 *  Extracurricular enrichment
 * ------------------------------------------------------------------ */

function placesOf(ecId) {
  return db.all('ec_places').filter((p) => p.extracurricular_id === ecId)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
}

function placeById(id) {
  return db.findOne('ec_places', (p) => p.id === id) || null;
}

function schedulesOf(ecId) {
  return db.all('ec_schedules').filter((s) => s.extracurricular_id === ecId)
    .sort((a, b) => DOW.indexOf(a.day) - DOW.indexOf(b.day) || String(a.start_time).localeCompare(String(b.start_time)));
}

function mentorsOf(ecId) {
  return db.all('ec_mentors').filter((m) => m.extracurricular_id === ecId)
    .sort((a, b) => (a.is_primary ? -1 : 1) - (b.is_primary ? -1 : 1) || String(a.user_name).localeCompare(String(b.user_name), 'id'));
}

function membersOf(ecId) {
  return db.all('ec_members').filter((m) => m.extracurricular_id === ecId)
    .sort((a, b) => String(a.user_name).localeCompare(String(b.user_name), 'id'));
}

/** Resolve the venue of a schedule: its own override, its place row, or the EC. */
function resolvePlace(sched, ec) {
  if (sched.place_id) {
    const p = placeById(sched.place_id);
    if (p) return { name: p.name, lat: p.lat, lng: p.lng, radius_m: p.radius_m, source: 'place' };
  }
  if (sched.place_name) {
    return {
      name: sched.place_name,
      lat: sched.place_lat != null ? sched.place_lat : (ec ? ec.location_lat : null),
      lng: sched.place_lng != null ? sched.place_lng : (ec ? ec.location_lng : null),
      radius_m: sched.radius_m || null,
      source: 'inline',
    };
  }
  if (ec) return { name: ec.room || '', lat: ec.location_lat, lng: ec.location_lng, radius_m: null, source: 'default' };
  return { name: '', lat: null, lng: null, radius_m: null, source: 'none' };
}

/** Decorate one extracurricular with schedules / places / mentors / members. */
function enrich(ec, opts) {
  const o = opts || {};
  const schedules = schedulesOf(ec.id).map((s) => Object.assign({}, s, { place: resolvePlace(s, ec) }));
  const out = Object.assign({}, ec, {
    places: placesOf(ec.id),
    schedules,
    mentors: mentorsOf(ec.id),
    member_count: db.count('ec_members', (m) => m.extracurricular_id === ec.id && m.status !== 'inactive'),
  });
  if (o.withMembers) out.members = membersOf(ec.id);
  // A schedule row is authoritative when present; fall back to the legacy
  // single start/end + days pair so older records still render correctly.
  if (!schedules.length) {
    out.schedules = (ec.schedule_days || []).map((day) => ({
      id: 'legacy-' + ec.id + '-' + day,
      extracurricular_id: ec.id,
      day,
      start_time: ec.start_time,
      end_time: ec.end_time,
      grade_group: '',
      place_id: '',
      place_name: ec.room || '',
      place_lat: ec.location_lat,
      place_lng: ec.location_lng,
      note: '',
      active: true,
      legacy: true,
      place: { name: ec.room || '', lat: ec.location_lat, lng: ec.location_lng, radius_m: null, source: 'default' },
    }));
  }
  return out;
}

/** Extracurriculars visible to a member, fully enriched. */
function visibleExtracurriculars(user) {
  const ids = assignedEcIds(user);
  return db.all('extracurriculars')
    .filter((e) => e.active && ids.indexOf(e.id) >= 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'))
    .map((ec) => enrich(ec));
}

/* ------------------------------------------------------------------ *
 *  Class timetable
 * ------------------------------------------------------------------ */

function classSchedulesFor(user, date, opts) {
  const o = opts || {};
  const dow = o.day || dowOf(date);
  if (user.role === 'student') {
    if (!user.class_name) return [];
    return db.all('class_schedules')
      .filter((s) => s.active !== false && s.class_name === user.class_name && s.day === dow)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }
  if (user.role === 'teacher') {
    return db.all('class_schedules')
      .filter((s) => s.active !== false && s.teacher_id === user.id && s.day === dow)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }
  return [];
}

/* ------------------------------------------------------------------ *
 *  Extracurricular timetable for a given day
 * ------------------------------------------------------------------ */

function ecSchedulesFor(user, date, opts) {
  const o = opts || {};
  const dow = o.day || dowOf(date);
  const ids = assignedEcIds(user);
  if (!ids.length) return [];
  const out = [];
  db.all('ec_schedules').forEach((s) => {
    if (s.active === false) return;
    if (s.day !== dow) return;
    if (ids.indexOf(s.extracurricular_id) < 0) return;
    const ec = db.findOne('extracurriculars', (e) => e.id === s.extracurricular_id);
    if (!ec || !ec.active) return;
    // A schedule can be limited to one grade group — a student only sees
    // their own group (mentors see every group they coach).
    if (user.role === 'student' && s.grade_group && s.grade_group !== gradeGroupOf(user, ec.id)) return;
    out.push(Object.assign({}, s, {
      extracurricular_name: ec.name,
      extracurricular_category: ec.category,
      place: resolvePlace(s, ec),
    }));
  });
  return out.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}

/* ------------------------------------------------------------------ *
 *  Academic-calendar day detail — role scoped
 * ------------------------------------------------------------------ */

function eventsOn(date) {
  return db.all('events')
    .filter((e) => date >= e.date && date <= (e.end_date || e.date))
    .sort((a, b) => (a.type === 'holiday' ? -1 : 1) - (b.type === 'holiday' ? -1 : 1));
}

/**
 * Build the sections a given role is allowed to see on a calendar date.
 *
 *  student  → daily class schedule + their extracurricular schedule + general
 *  teacher  → the class schedule they teach + their EC schedule + general
 *  employee → general information only
 *  mentor   → the extracurricular schedules they coach
 */
function dayDetail(user, date) {
  const dow = dowOf(date);
  const events = eventsOn(date);
  const sections = [];

  const classRows = classSchedulesFor(user, date, { day: dow });
  if (user.role === 'student' || user.role === 'teacher') {
    sections.push({
      key: 'class',
      title: user.role === 'student' ? 'Jadwal Pelajaran' : 'Jadwal Mengajar',
      icon: 'school',
      scope: user.role === 'student' ? (user.class_name || 'Kelas belum ditetapkan') : 'Sesuai penugasan Anda',
      items: classRows.map((s) => ({
        id: s.id,
        time: `${s.start_time}–${s.end_time}`,
        title: s.subject || 'Kegiatan Kelas',
        sub: s.class_name ? `Kelas ${s.class_name}` : '',
        place: s.room || '',
        tag: s.teacher_name || '',
      })),
    });
  }

  const ecRows = ecSchedulesFor(user, date, { day: dow });
  if (user.role !== 'employee' || ecRows.length) {
    sections.push({
      key: 'ec',
      title: 'Jadwal Ekstrakurikuler',
      icon: 'star',
      scope: (user.role === 'student'
        ? 'Ekstrakurikuler yang Anda ikuti'
        : user.role === 'employee' ? 'Ekstrakurikuler binaan Anda' : 'Ekstrakurikuler binaan Anda'),
      items: ecRows.map((s) => ({
        id: s.id,
        time: `${s.start_time}–${s.end_time}`,
        title: s.extracurricular_name,
        sub: [s.grade_group, s.place && s.place.name].filter(Boolean).join(' · '),
        place: s.place ? s.place.name : '',
        tag: s.note || '',
        extracurricular_id: s.extracurricular_id,
      })),
    });
  }

  // General information — only what actually belongs to THIS date:
  // school events spanning it, plus the announcements and news published on it.
  const generalItems = events.map((e) => ({
    id: e.id,
    kind: 'event',
    time: e.end_date && e.end_date !== e.date ? `${e.date} – ${e.end_date}` : 'Sepanjang hari',
    title: e.title,
    sub: e.description || '',
    place: e.location || '',
    tag: e.type,
  }));
  // The detail page needs the real payload, so hand the media over with the
  // row (it is the same data the info sheet already fetches).
  const mediaOf = (r) => ({
    has_attachment: !!(r.attachment && r.attachment.data),
    has_link: !!r.link_url,
    attachment: r.attachment || null,
    link_url: r.link_url || '',
    link_label: r.link_label || '',
  });
  db.all('announcements')
    .filter((a) => a.date === date)
    .filter((a) => a.audience === 'Semua' || a.audience === user.role
      || (user.role === 'teacher' && a.audience === 'Guru & Karyawan')
      || (user.role === 'employee' && a.audience === 'Guru & Karyawan')
      || (user.role === 'student' && a.audience === 'Peserta Didik'))
    .sort((a, b) => (a.is_pinned ? -1 : 1) - (b.is_pinned ? -1 : 1) || String(a.time || '').localeCompare(String(b.time || '')))
    .forEach((a) => generalItems.push(Object.assign({
      id: a.id,
      kind: 'announcement',
      time: a.time ? `${a.date} · ${a.time}` : a.date,
      title: a.title,
      sub: a.details || '',
      place: a.location || '',
      tag: a.is_pinned ? 'Pengumuman · Disematkan' : 'Pengumuman',
    }, mediaOf(a))));
  db.all('news')
    .filter((n) => n.date === date)
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .forEach((n) => generalItems.push(Object.assign({
      id: n.id,
      kind: 'news',
      time: n.time ? `${n.date} · ${n.time}` : n.date,
      title: n.title,
      sub: n.details || '',
      place: n.category || '',
      tag: 'Berita',
    }, mediaOf(n))));

  sections.push({
    key: 'general',
    title: 'Informasi Umum',
    icon: 'info',
    scope: 'Kegiatan, pengumuman dan berita pada tanggal ini',
    items: generalItems,
  });

  return {
    date,
    day: dow,
    role: user.role,
    is_mentor: isMentor(user),
    events,
    sections,
    has_class: classRows.length > 0,
    has_ec: ecRows.length > 0,
  };
}

/* ------------------------------------------------------------------ *
 *  Point ranking — grouped by role
 * ------------------------------------------------------------------ */

const RANK_ROLES = ['student', 'teacher', 'employee'];

function toRankRow(u, i) {
  return {
    rank: i + 1,
    id: u.id,
    name: u.name,
    role: u.role,
    class_name: u.class_name || '',
    subject: u.subject || '',
    position: u.position || '',
    score_points: u.score_points || 0,
  };
}

/** Every active member of a role, ordered by points (source of true rank). */
function fullRank(role) {
  return db.all('users')
    .filter((u) => u.status === 'active' && u.role === role)
    .sort((a, b) => (b.score_points || 0) - (a.score_points || 0))
    .map(toRankRow);
}

function rankGroups(limitPerRole) {
  const lim = limitPerRole || 20;
  const groups = {};
  RANK_ROLES.forEach((role) => { groups[role] = fullRank(role).slice(0, lim); });
  return groups;
}

/** How many members each role group actually contains. */
function rankTotals() {
  const out = {};
  RANK_ROLES.forEach((role) => { out[role] = fullRank(role).length; });
  return out;
}

/** True position of a user inside their own role group. */
function rankOf(user) {
  const rows = fullRank(user.role);
  const i = rows.findIndex((r) => r.id === user.id);
  return { rank: i >= 0 ? i + 1 : 0, total: rows.length, row: i >= 0 ? rows[i] : null };
}

module.exports = {
  DOW,
  GRADE_GROUPS,
  MENTOR_ROLES,
  RANK_ROLES,
  dowOf,
  assignedEcIds,
  isAssigned,
  isMentor,
  mentorOf,
  membershipsOf,
  gradeGroupOf,
  groupFromClass,
  placesOf,
  placeById,
  schedulesOf,
  mentorsOf,
  membersOf,
  resolvePlace,
  enrich,
  visibleExtracurriculars,
  classSchedulesFor,
  ecSchedulesFor,
  eventsOn,
  dayDetail,
  rankGroups,
  rankTotals,
  fullRank,
  rankOf,
  toRankRow,
};
