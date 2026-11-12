'use strict';
/**
 * Parents.
 *
 * A parent is a first-class account (`role: 'parent'`) whose only job is to
 * follow their own children. The link between the two lives in `parent_links`,
 * so one parent can watch several children and a child can be followed by
 * both mother and father without either of them inheriting any school role.
 *
 * Everything a parent can read is derived from the child's existing records —
 * there is no separate "parent data" to fall out of sync.
 */
const db = require('./db');
const U = require('./util');
const attendance = require('./attendance');
const sched = require('./schedule');

const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const RELATIONSHIPS = ['Ayah', 'Ibu', 'Wali'];

/* ------------------------------- links ------------------------------- */

/** Every student id a parent is allowed to look at. */
function childIdsOf(parentId) {
  return db.all('parent_links')
    .filter((l) => l.parent_id === parentId)
    .map((l) => l.student_id);
}

/** The children, as light rows including how their day is going. */
function childrenOf(parentId) {
  const today = attendance.today();
  return childIdsOf(parentId)
    .map((id) => db.findOne('users', (u) => u.id === id))
    .filter((u) => u && u.role === 'student')
    .map((u) => {
      const rec = attendance.recordFor(u.id, today);
      return {
        id: u.id,
        name: u.name,
        id_number: u.id_number || '',
        class_name: u.class_name || '',
        avatar: u.avatar || '',
        score_points: u.score_points || 0,
        today: summarizeToday(u, rec),
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'id', { numeric: true }));
}

/** True when the parent is linked to that student. */
function mayView(parentId, studentId) {
  return db.all('parent_links').some((l) => l.parent_id === parentId && l.student_id === studentId);
}

/* ------------------------------ payloads ----------------------------- */

/**
 * One line describing where the child is right now, used by the child
 * switcher and the hero card so a parent gets the answer in one glance.
 */
function summarizeToday(u, rec) {
  const today = attendance.today();
  const dow = sched.dowOf(today);
  const ecRows = sched.ecSchedulesFor(u, today, { day: dow });
  const ecRec = db.all('ec_attendance').filter((a) => a.user_id === u.id && a.date === today);
  return {
    date: today,
    day: dow,
    status: rec ? rec.status : 'absent',
    check_in_at: rec ? rec.check_in_at || '' : '',
    check_out_at: rec ? rec.check_out_at || '' : '',
    has_record: !!rec,
    at_school: !!(rec && rec.check_in_at && !rec.check_out_at),
    ec_today: ecRows.map((x) => ({
      id: x.id,
      extracurricular_id: x.extracurricular_id,
      extracurricular_name: x.extracurricular_name || '',
      start_time: x.start_time,
      end_time: x.end_time,
      place: x.place ? x.place.name : '',
    })),
    ec_recorded: ecRec.length,
    ec_attended: ecRec.filter((a) => a.status === 'present').length,
  };
}

/**
 * Everything a parent is allowed to see about one child:
 * school hours, what happens after school, letters and school information.
 */
function overviewFor(parentId, studentId) {
  const student = db.findOne('users', (u) => u.id === studentId);
  if (!student || student.role !== 'student') return null;

  const today = attendance.today();
  const todayRec = attendance.recordFor(student.id, today);
  const dow = sched.dowOf(today);

  /* ---- school hours ------------------------------------------------- */
  const rows = db.all('attendance')
    .filter((a) => a.user_id === student.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  rows.forEach((r) => { if (counts[r.status] != null) counts[r.status] += 1; });
  const recent = rows.slice(0, 30).map((r) => ({
    id: r.id,
    date: r.date,
    dow: DOW[new Date(r.date + 'T00:00:00Z').getUTCDay()],
    status: r.status,
    check_in_at: r.check_in_at || '',
    check_out_at: r.check_out_at || '',
    work_hours: r.work_hours || 0,
    check_in_method: r.check_in_method || '',
  }));

  /* ---- after school: extracurriculars ------------------------------- */
  const ecAll = db.all('ec_attendance').filter((a) => a.user_id === student.id);
  const afterSchool = sched.visibleExtracurriculars(student).map((ec) => {
    const mine = ecAll.filter((a) => a.extracurricular_id === ec.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      id: ec.id,
      name: ec.name,
      category: ec.category || '',
      description: ec.description || '',
      room: ec.room || '',
      mentor_names: (ec.mentors || []).map((m) => m.name),
      schedules: (ec.schedules || []).filter((x) => x.active !== false).map((x) => ({
        id: x.id,
        day: x.day,
        start_time: x.start_time,
        end_time: x.end_time,
        grade_group: x.grade_group || '',
        place: x.place ? { id: x.place.id, name: x.place.name } : null,
      })),
      meets_today: (ec.schedules || []).some((x) => x.active !== false && x.day === dow),
      attended: mine.filter((a) => a.status === 'present').length,
      total_sessions: mine.length,
      last_date: mine.length ? mine[0].date : '',
      records: mine.slice(0, 20).map((a) => ({
        id: a.id,
        date: a.date,
        status: a.status,
        place_name: a.place_name || '',
        has_selfie: !!a.has_selfie,
        distance_m: a.distance_m || 0,
      })),
    };
  });

  /* ---- letters (permission requests) -------------------------------- */
  const letters = db.all('requests')
    .filter((r) => r.user_id === student.id)
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      type: r.type || '',
      title: r.title || '',
      details: r.details || '',
      start_date: r.start_date || '',
      end_date: r.end_date || '',
      status: r.status || 'pending',
      review_note: r.review_note || '',
      created_at: r.created_at || '',
    }));

  /* ---- school information aimed at students ------------------------- */
  const information = {
    announcements: db.all('announcements')
      .filter((a) => a.audience === 'Semua' || a.audience === 'Peserta Didik')
      .sort((a, b) => {
        if (!!b.is_pinned !== !!a.is_pinned) return b.is_pinned ? 1 : -1;
        return String(a.date) < String(b.date) ? 1 : -1;
      })
      .slice(0, 10)
      .map((a) => ({
        id: a.id, title: a.title, details: a.details || '', date: a.date,
        location: a.location || '', time: a.time || '', is_pinned: !!a.is_pinned,
        attachment: a.attachment || null, link: a.link || null, link_label: a.link_label || '',
      })),
    news: db.all('news')
      .sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1))
      .slice(0, 10)
      .map((n) => ({
        id: n.id, title: n.title, details: n.details || '', date: n.date,
        category: n.category || '', cover: n.cover || '', views: n.views || 0,
        attachment: n.attachment || null, link: n.link || null, link_label: n.link_label || '',
      })),
  };

  return {
    generated_at: new Date().toISOString(),
    date: today,
    student: {
      id: student.id,
      name: student.name,
      id_number: student.id_number || '',
      class_name: student.class_name || '',
      avatar: student.avatar || '',
      gender: student.gender || '',
      score_points: student.score_points || 0,
      level: require('./auth').levelFor(student.score_points || 0),
    },
    // A parent sees the relationship they hold, not the school's admin data.
    relationship: relationshipOf(parentId, student.id),
    today: Object.assign(summarizeToday(student, todayRec), {
      class_schedule: sched.classSchedulesFor(student, today, { day: dow })
        .map((c) => ({
          id: c.id, start_time: c.start_time, end_time: c.end_time,
          subject: c.subject || c.name || '', teacher: c.teacher_name || '', room: c.room || '',
        })),
      ec_schedule: sched.ecSchedulesFor(student, today, { day: dow })
        .map((x) => ({
          id: x.id, extracurricular_name: x.extracurricular_name || '',
          start_time: x.start_time, end_time: x.end_time,
          place: x.place ? x.place.name : '',
        })),
    }),
    school_time: {
      week: attendance.weeklyStats(student.id),
      counts,
      rate: rows.length ? U.round((counts.present + counts.late) / rows.length * 100, 1) : 0,
      recent,
    },
    after_school: afterSchool,
    letters,
    information,
  };
}

function relationshipOf(parentId, studentId) {
  const l = db.findOne('parent_links', (x) => x.parent_id === parentId && x.student_id === studentId);
  return l ? l.relationship || '' : '';
}

module.exports = {
  RELATIONSHIPS,
  childIdsOf,
  childrenOf,
  mayView,
  overviewFor,
  relationshipOf,
  summarizeToday,
};
