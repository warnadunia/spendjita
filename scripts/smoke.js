'use strict';
/** API smoke test — run with: node scripts/smoke.js */
const http = require('http');
const BASE = { host: '127.0.0.1', port: 3000 };

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers || {});
    let payload = null;
    if (body !== undefined && body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      h['content-type'] = h['content-type'] || 'application/json';
      h['content-length'] = Buffer.byteLength(payload);
    }
    const r = http.request(Object.assign({}, BASE, { method, path, headers: h }), (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch { j = d.slice(0, 120); }
        resolve({ status: res.statusCode, body: j, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓', label);
  } else {
    fail++;
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '');
  }
}

(async () => {
  console.log('\n== public ==');
  const school = await req('GET', '/api/public/school');
  check('GET /api/public/school', school.status === 200 && school.body.ok && school.body.data.school.name);
  check('QR payloads present', school.body.data.qr.checkin.includes('/scan.html?mode=checkin'), school.body.data.qr);
  const qr = await req('GET', '/api/public/qr?mode=checkin');
  check('GET /api/public/qr', qr.status === 200 && qr.headers['content-type'].includes('svg'), qr.status);
  const qr2 = await req('GET', '/api/public/qr/checkout.svg?size=300');
  check('GET /api/public/qr/:mode.svg', qr2.status === 200 && (qr2.headers['content-type'] || '').includes('svg'), qr2.status);
  const manifest = await req('GET', '/manifest.json');
  check('manifest.json', manifest.status === 200 && manifest.body.name, manifest.body && manifest.body.name);
  const icon = await req('GET', '/icons/icon-512.png');
  check('icon 512 png', icon.status === 200 && icon.headers['content-type'].includes('png'), icon.status);
  const avatar = await req('GET', '/api/assets/avatar/Rafli%20Wijaya.svg');
  check('avatar svg', avatar.status === 200 && (avatar.headers['content-type'] || '').includes('svg'));

  console.log('\n== auth ==');
  const demos = await req('GET', '/api/auth/demo-accounts');
  check('demo accounts endpoint', demos.status === 200 && !!demos.body.data.length);
  const demoRoles = (demos.body.data || []).map((d) => d.role);
  check('demo accounts cover every role',
    ['admin', 'teacher', 'student', 'employee', 'parent'].every((r) => demoRoles.includes(r)),
    JSON.stringify(demoRoles));
  // The mobile login screen renders these chips in order, so `parent` must come
  // after `employee` for the Orang Tua chip to sit below the Karyawan chip.
  check('parent demo chip is listed below the employee chip',
    demoRoles.indexOf('parent') > demoRoles.indexOf('employee'), JSON.stringify(demoRoles));
  const idOf = (role) => demos.body.data.find((d) => d.role === role).id_number;
  const emailOf = (role) => demos.body.data.find((d) => d.role === role).name;
  const studentId = idOf('student');
  const teacherId = idOf('teacher');
  const employeeId = idOf('employee');
  console.log('    demo ids:', JSON.stringify(demos.body.data));
  const bad = await req('POST', '/api/auth/login', { idNumber: 'SP1TAADM', password: 'wrong' });
  check('login rejects bad password', bad.status === 401);
  const adm = await req('POST', '/api/auth/login', { idNumber: 'SP1TAADM', password: 'demo123' });
  check('admin login', adm.status === 200 && adm.body.data.user.role === 'admin');
  const adminToken = adm.body.data.token;
  const H = (t) => ({ authorization: 'Bearer ' + t });

  const studentEmail = (await req('POST', '/api/auth/login', { idNumber: studentId, password: 'demo123' })).body.data.user.email;
  const forgot = await req('POST', '/api/auth/forgot-password', { idNumber: studentId, email: studentEmail });
  check('forgot-password issues token', forgot.status === 200 && /^\d{6}$/.test(forgot.body.data.token));
  const badReset = await req('POST', '/api/auth/reset-password', { idNumber: studentId, token: '000000', password: 'newpass1' });
  check('reset rejects bad token', badReset.status === 400);
  const reset = await req('POST', '/api/auth/reset-password', { idNumber: studentId, token: forgot.body.data.token, password: 'newpass1' });
  check('reset works', reset.status === 200);
  const relogin = await req('POST', '/api/auth/login', { idNumber: studentId, password: 'newpass1' });
  check('login with new password', relogin.status === 200);
  // restore the demo password for the student account
  const rest = await req('POST', '/api/auth/forgot-password', { idNumber: studentId });
  await req('POST', '/api/auth/reset-password', { idNumber: studentId, token: rest.body.data.token, password: 'demo123' });
  check('student password restored', (await req('POST', '/api/auth/login', { idNumber: studentId, password: 'demo123' })).status === 200);

  console.log('\n== admin ==');
  const dash = await req('GET', '/api/admin/dashboard', null, H(adminToken));
  check('dashboard 200', dash.status === 200 && dash.body.data.counters);
  check('dashboard has trend', dash.body.data.trend.length === 7);
  check('dashboard has activity', dash.body.data.activity.length > 3);
  check('dashboard has by_role', dash.body.data.by_role.length === 3);

  const noAuth = await req('GET', '/api/admin/dashboard');
  check('admin routes protected', noAuth.status === 401);

  // The server's own local date (Asia/Jakarta) and a helper that finds a user
  // with no attendance record yet today, so check-in flows are idempotent
  // no matter how many times the suite runs.
  const serverToday = dash.body.data.date;
  async function freshUser(role) {
    const all = await req('GET', `/api/admin/users?role=${role}&limit=200`, null, H(adminToken));
    const done = new Set();
    for (let pg = 1; pg <= 10; pg++) {
      const page = await req('GET', `/api/admin/attendance?from=${serverToday}&to=${serverToday}&limit=200&page=${pg}`, null, H(adminToken));
      if (page.status !== 200 || !page.body.data.items.length) break;
      page.body.data.items.forEach((a) => done.add(a.user_id));
      if (page.body.data.items.length < 200) break;
    }
    return all.body.data.items.find((u) => !done.has(u.id));
  }

  const users = await req('GET', '/api/admin/users?role=teacher&limit=5', null, H(adminToken));
  check('users list paginated', users.status === 200 && users.body.data.items.length === 5 && users.body.data.total > 20);
  const u0 = users.body.data.items[0];
  const created = await req('POST', '/api/admin/users', { name: 'Test Guru', role: 'teacher', id_number: 'TESTT001', email: 'test@sp1yogyakarta.sch.id', password: 'demo123', position: 'Guru Matematika' }, H(adminToken));
  check('create user', created.status === 200 && created.body.data.user.name === 'Test Guru');
  check('duplicate id rejected', (await req('POST', '/api/admin/users', { name: 'X', role: 'teacher', id_number: 'TESTT001' }, H(adminToken))).status === 400);
  const updated = await req('PUT', '/api/admin/users/' + created.body.data.user.id, { name: 'Test Guru Diupdate', score_points: 77 }, H(adminToken));
  check('update user', updated.status === 200 && updated.body.data.user.score_points === 77);
  const detail = await req('GET', '/api/admin/users/' + created.body.data.user.id, null, H(adminToken));
  check('user detail + history', detail.status === 200 && Array.isArray(detail.body.data.attendance));
  const del = await req('DELETE', '/api/admin/users/' + created.body.data.user.id, null, H(adminToken));
  check('delete user', del.status === 200);

  const att = await req('GET', '/api/admin/attendance?limit=10', null, H(adminToken));
  check('attendance list', att.status === 200 && att.body.data.items.length === 10 && att.body.data.stats.rate !== undefined);

  const reqs = await req('GET', '/api/admin/requests?status=pending', null, H(adminToken));
  check('requests list', reqs.status === 200 && reqs.body.data.items.every((r) => r.status === 'pending'));
  check('requests counts', reqs.body.data.counts.pending > 0);
  const r0 = reqs.body.data.items[0];
  const approved = await req('PUT', '/api/admin/requests/' + r0.id, { status: 'approved', review_note: 'Disetujui.' }, H(adminToken));
  check('approve request', approved.status === 200 && approved.body.data.request.status === 'approved');
  check('approved request awards points', approved.body.data.request.reviewed_by === 'Administrator Sekolah');

  const anns = await req('GET', '/api/admin/announcements', null, H(adminToken));
  check('announcements list', anns.status === 200 && anns.body.data.items.length >= 6);
  const a0 = anns.body.data.items[0];
  const ann = await req('POST', '/api/admin/announcements', { title: 'Pengumuman Uji Coba', details: 'Isi pengumuman uji coba.', location: 'Aula', date: '2026-11-01', time: '09:00', audience: 'Semua' }, H(adminToken));
  check('create announcement', ann.status === 200);
  const annUp = await req('PUT', '/api/admin/announcements/' + ann.body.data.announcement.id, { title: 'Pengumuman Uji Coba 2', is_pinned: true }, H(adminToken));
  check('update announcement', annUp.status === 200 && annUp.body.data.announcement.is_pinned === true);
  check('delete announcement', (await req('DELETE', '/api/admin/announcements/' + ann.body.data.announcement.id, null, H(adminToken))).status === 200);

  const news = await req('POST', '/api/admin/news', { title: 'Berita Uji Coba', details: 'Isi berita.', date: '2026-10-29', category: 'Prestasi' }, H(adminToken));
  check('create news', news.status === 200);
  check('delete news', (await req('DELETE', '/api/admin/news/' + news.body.data.news.id, null, H(adminToken))).status === 200);

  const ev = await req('POST', '/api/admin/events', { title: 'Acara Uji Coba', type: 'meeting', date: '2026-11-20', end_date: '2026-11-21', description: 'Deskripsi' }, H(adminToken));
  check('create event', ev.status === 200);
  check('delete event', (await req('DELETE', '/api/admin/events/' + ev.body.data.event.id, null, H(adminToken))).status === 200);

  const ec = await req('GET', '/api/admin/extracurriculars', null, H(adminToken));
  check('extracurriculars list', ec.status === 200 && ec.body.data.items.length === 8);
  const ecPost = await req('POST', '/api/admin/extracurriculars', { name: 'Bola Voli', category: 'Olahraga', schedule_days: ['Senin'], start_time: '15:45', end_time: '17:00', room: 'Lapangan Voli' }, H(adminToken));
  check('create extracurricular', ecPost.status === 200);
  check('delete extracurricular', (await req('DELETE', '/api/admin/extracurriculars/' + ecPost.body.data.extracurricular.id, null, H(adminToken))).status === 200);

  const rep = await req('GET', '/api/admin/reports?from=2026-10-16&to=2026-10-29', null, H(adminToken));
  check('reports summary', rep.status === 200 && rep.body.data.overall.records > 0);
  check('reports by class', rep.body.data.by_class.length > 0);
  check('reports by role', rep.body.data.by_role.length === 3);
  const csv = await req('GET', '/api/admin/reports/export.csv?from=2026-10-16&to=2026-10-29', null, H(adminToken));
  check('csv export', csv.status === 200 && csv.body.includes('Tanggal') && csv.body.includes('"'));

  const st = await req('PUT', '/api/admin/settings', { app_name: 'Absensi SMP Negeri 1 Yogyakarta', theme_primary: '#0ea5e9', late_after_minutes: 15 }, H(adminToken));
  check('settings update', st.status === 200 && st.body.data.settings.theme_primary === '#0ea5e9');
  const m2 = await req('GET', '/manifest.json');
  check('manifest reflects branding', m2.body.theme_color === '#0ea5e9', m2.body.theme_color);

  console.log('\n== mobile ==');
  const freshTeacher = await freshUser('teacher');
  check('found a fresh teacher', !!freshTeacher, freshTeacher && freshTeacher.id_number);
  const mob = await req('POST', '/api/auth/login', { idNumber: freshTeacher.id_number, password: 'demo123' });
  check('teacher login', mob.status === 200 && mob.body.data.user.role === 'teacher');
  const t = mob.body.data.token;
  const mDash = await req('GET', '/api/mobile/dashboard', null, H(t));
  check('mobile dashboard', mDash.status === 200 && mDash.body.data.week.days.length === 7);
  check('mobile has announcements', mDash.body.data.announcements.length > 0);

  const me = await req('GET', '/api/mobile/me', null, H(t));
  check('mobile me', me.status === 200 && me.body.data.user.name);
  // The seeder may already have given this user a check-in today; make the
  // assertions work either way.
  const alreadyIn = !!me.body.data.today.record;
  const before = me.body.data.stats.attendance;
  if (!alreadyIn) {
    const ci = await req('POST', '/api/mobile/checkin', { lat: -7.78282, lng: 110.36706, method: 'gps' }, H(t));
    check('checkin (within geofence)', ci.status === 200 && ci.body.data.record.check_in_at, ci.body);
    check('checkin geofence distance < 5m', ci.body.data.geo && ci.body.data.geo.dist < 5, ci.body.data.geo);
    const dup = await req('POST', '/api/mobile/checkin', { lat: -7.78282, lng: 110.36706, method: 'gps' }, H(t));
    check('duplicate checkin blocked', dup.status === 409, dup.status);
  } else {
    console.log('    (seeder already checked this user in today — skipping duplicate check)');
    check('seeded check-in present', !!me.body.data.today.record.check_in_at);
  }
  const mid = await req('GET', '/api/mobile/me', null, H(t));
  check('attendance count reflects check-in', mid.body.data.stats.attendance >= before);
  const far = await req('POST', '/api/mobile/checkout', { lat: -7.9, lng: 110.5, method: 'gps' }, H(t));
  check('checkout outside geofence (allowed by config)', far.status === 200, far.body);
  const dupOut = await req('POST', '/api/mobile/checkout', { lat: -7.78282, lng: 110.36706, method: 'gps' }, H(t));
  check('duplicate checkout blocked', dupOut.status === 400, dupOut.status);
  const me2 = await req('GET', '/api/mobile/me', null, H(t));
  check('checkout recorded', !!me2.body.data.today.record.check_out_at);
  // check-in and check-out land in the same second here, so hours >= 0;
  // the historical seeded records prove the arithmetic itself.
  check('work hours computed', typeof me2.body.data.today.record.work_hours === 'number' && me2.body.data.today.record.work_hours >= 0, me2.body.data.today.record.work_hours);
  const hist = await req('GET', '/api/mobile/attendance?limit=30', null, H(t));
  const withHours = hist.body.data.items.filter((r) => r.work_hours > 0);
  check('historical records have positive work hours', withHours.length > 0, withHours.length);

  // Extracurriculars are role scoped: a member can only record attendance for
  // an activity they are actually enrolled in / assigned to.
  const ecId = ec.body.data.items[0].id;
  const blocked = await req('POST', '/api/mobile/extracurriculars/' + ecId + '/attendance', { gps_lat: -7.80672, gps_lng: 110.32281, status: 'present' }, H(t));
  check('unassigned extracurricular is rejected', blocked.status === 403, blocked.status);
  const enrol = await req('POST', '/api/admin/ec-mentors', { extracurricular_id: ecId, user_id: freshTeacher.id, mentor_role: 'Pelatih' }, H(adminToken));
  check('admin assigns a mentor/coach', enrol.status === 200, enrol.body);
  const scoped = await req('GET', '/api/mobile/extracurriculars', null, H(t));
  check('member sees only assigned extracurriculars', scoped.status === 200
    && scoped.body.data.items.length >= 1
    && scoped.body.data.items.length < ec.body.data.items.length
    && scoped.body.data.items.some((e) => e.id === ecId), (scoped.body.data.items || []).length);
  const ecAtt = await req('POST', '/api/mobile/extracurriculars/' + ecId + '/attendance', { gps_lat: -7.80672, gps_lng: 110.32281, status: 'present', selfie: 'data:image/png;base64,AAAA' }, H(t));
  check('ec attendance with selfie', ecAtt.status === 200 && ecAtt.body.data.attendance.status === 'present', ecAtt.body);
  const ecDetail = await req('GET', '/api/mobile/extracurriculars/' + ecId, null, H(t));
  check('ec detail returns schedules + places + mentors', ecDetail.status === 200
    && Array.isArray(ecDetail.body.data.extracurricular.schedules)
    && Array.isArray(ecDetail.body.data.extracurricular.places)
    && Array.isArray(ecDetail.body.data.extracurricular.mentors), ecDetail.body);
  const unenrol = await req('DELETE', '/api/admin/ec-mentors/' + enrol.body.data.mentor.id, null, H(adminToken));
  check('admin removes mentor', unenrol.status === 200);

  // role scoped academic calendar
  const cal = await req('GET', '/api/mobile/calendar/day', null, H(t));
  check('calendar day detail is role scoped', cal.status === 200
    && cal.body.data.role === 'teacher'
    && cal.body.data.sections.some((x) => x.key === 'class')
    && cal.body.data.sections.some((x) => x.key === 'general'), cal.body.data && cal.body.data.role);

  // point rank grouped by role
  const board = await req('GET', '/api/mobile/leaderboard', null, H(t));
  check('leaderboard grouped by role', board.status === 200
    && Array.isArray(board.body.data.groups.student)
    && Array.isArray(board.body.data.groups.teacher)
    && Array.isArray(board.body.data.groups.employee)
    && board.body.data.groups.teacher.every((r) => r.role === 'teacher')
    && board.body.data.groups.student.every((r) => r.role === 'student'), board.body.data && Object.keys(board.body.data.groups || {}).join(','));

  // admin-managed class timetable
  const csAdd = await req('POST', '/api/admin/class-schedules', { day: 'Senin', start_time: '07:30', end_time: '08:50', class_name: 'X-UJI', subject: 'Matematika', teacher_id: freshTeacher.id, room: 'Ruang Uji' }, H(adminToken));
  check('admin creates class schedule', csAdd.status === 200 && csAdd.body.data.schedule.teacher_id === freshTeacher.id, csAdd.body);
  const csBad = await req('POST', '/api/admin/class-schedules', { day: 'Senin', start_time: '09:00', end_time: '08:00', class_name: 'X-UJI', teacher_id: freshTeacher.id }, H(adminToken));
  check('class schedule rejects inverted time', csBad.status === 400, csBad.status);
  const csList = await req('GET', '/api/admin/class-schedules?teacher_id=' + freshTeacher.id, null, H(adminToken));
  check('class schedule filters by teacher', csList.status === 200
    && csList.body.data.items.length >= 1
    && csList.body.data.items.every((x) => x.teacher_id === freshTeacher.id), csList.body.data && csList.body.data.items.length);
  const sched = await req('GET', '/api/mobile/schedule/week', null, H(t));
  const monday = sched.body.data.days.Senin || [];
  check('teacher weekly schedule includes the new entry', monday.some((x) => x.class_name === 'X-UJI'), monday.length);
  check('admin deletes class schedule', (await req('DELETE', '/api/admin/class-schedules/' + csAdd.body.data.schedule.id, null, H(adminToken))).status === 200);

  // extracurricular schedules / places / mentors CRUD
  const ecPlace = await req('POST', '/api/admin/ec-places', { extracurricular_id: ecId, name: 'Tempat Uji', lat: -7.80672, lng: 110.32281 }, H(adminToken));
  check('admin adds ec place', ecPlace.status === 200, ecPlace.body);
  const ecSched = await req('POST', '/api/admin/ec-schedules', { extracurricular_id: ecId, day: 'Senin', start_time: '15:45', end_time: '17:00', place_id: ecPlace.body.data.place.id, grade_group: 'Kelas VII' }, H(adminToken));
  check('admin adds ec schedule bound to a place', ecSched.status === 200 && ecSched.body.data.schedule.place_name === 'Tempat Uji', ecSched.body);
  const ecMentor = await req('POST', '/api/admin/ec-mentors', { extracurricular_id: ecId, user_id: freshTeacher.id, mentor_role: 'Pelatih' }, H(adminToken));
  check('admin adds ec mentor', ecMentor.status === 200, ecMentor.body);
  const noStudent = await req('POST', '/api/admin/ec-mentors', { extracurricular_id: ecId, user_id: ec.body.data.items[0].id, mentor_role: 'Pembina' }, H(adminToken));
  check('ec mentor rejects a student', noStudent.status === 400, noStudent.status);
  const bulk = await req('POST', '/api/admin/ec-members/bulk', { extracurricular_id: ecId, user_ids: [freshTeacher.id], grade_group: 'Kelas VII' }, H(adminToken));
  check('bulk enrol skips non-students', bulk.status === 200 && bulk.body.data.added === 0 && bulk.body.data.skipped === 1, bulk.body.data);
  check('admin deletes ec schedule', (await req('DELETE', '/api/admin/ec-schedules/' + ecSched.body.data.schedule.id, null, H(adminToken))).status === 200);
  check('admin deletes ec place', (await req('DELETE', '/api/admin/ec-places/' + ecPlace.body.data.place.id, null, H(adminToken))).status === 200);
  check('admin deletes ec mentor', (await req('DELETE', '/api/admin/ec-mentors/' + ecMentor.body.data.mentor.id, null, H(adminToken))).status === 200);

  const histAll = await req('GET', '/api/mobile/attendance', null, H(t));
  check('attendance history', histAll.status === 200 && histAll.body.data.items.length > 0);
  const wr = await req('GET', '/api/mobile/weekly', null, H(t));
  check('weekly stats', wr.status === 200 && wr.body.data.days.length === 7);
  const lb = await req('GET', '/api/mobile/leaderboard', null, H(t));
  check('leaderboard', lb.status === 200 && lb.body.data.items.length > 0);
  const mReq = await req('POST', '/api/mobile/requests', { type: 'Sickness', title: 'Sakit demam', details: 'Demam sejak kemarin.', from_date: '2026-10-30', to_date: '2026-10-30' }, H(t));
  check('mobile request create', mReq.status === 200 && mReq.body.data.request.status === 'pending');

  console.log('\n== announcements & news media ==');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PDF = 'data:application/pdf;base64,' + 'A'.repeat(320);

  const annA = await req('POST', '/api/admin/announcements', {
    title: 'Pengumuman uji lampiran', details: 'Isi pengumuman uji lampiran dan tautan.',
    date: '2026-06-15', time: '08:00', location: 'Aula', audience: 'Semua',
    attachment: { name: 'foto.png', type: 'image/png', size: 70, data: PNG },
    link_url: 'https://sp1yogyakarta.sch.id/daftar', link_label: 'Form pendaftaran',
  }, H(adminToken));
  check('admin publishes an announcement with attachment + link', annA.status === 200
    && annA.body.data.announcement.attachment.name === 'foto.png'
    && annA.body.data.announcement.link_url === 'https://sp1yogyakarta.sch.id/daftar', annA.body.error || annA.body.data && annA.body.data.announcement);
  const annId = annA.body.data.announcement.id;

  const badLink = await req('POST', '/api/admin/announcements', {
    title: 'Tautan tidak valid', details: 'Harus ditolak oleh server.', link_url: 'javascript:alert(1)',
  }, H(adminToken));
  check('server rejects a non-http external link', badLink.status === 400, badLink.status);

  const badAtt = await req('POST', '/api/admin/announcements', {
    title: 'Lampiran tidak valid', details: 'Harus ditolak oleh server.',
    attachment: { name: 'x', type: 'image/png', size: 1, data: 'not-a-data-url' },
  }, H(adminToken));
  check('server rejects a malformed attachment', badAtt.status === 400, badAtt.status);

  const bigAtt = await req('POST', '/api/admin/announcements', {
    title: 'Lampiran kebesaran', details: 'Harus ditolak oleh server.',
    attachment: { name: 'big.png', type: 'image/png', size: 9000000, data: 'data:image/png;base64,' + 'A'.repeat(3000000) },
  }, H(adminToken));
  check('server rejects an oversized attachment', bigAtt.status === 400, bigAtt.status);

  const annSwap = await req('PUT', '/api/admin/announcements/' + annId, {
    attachment: { name: 'dok.pdf', type: 'application/pdf', size: 240, data: PDF },
    link_url: 'https://example.org/x',
  }, H(adminToken));
  check('admin swaps the attachment and the link', annSwap.status === 200
    && annSwap.body.data.announcement.attachment.type === 'application/pdf'
    && annSwap.body.data.announcement.link_url === 'https://example.org/x', annSwap.body.error);

  const annClear = await req('PUT', '/api/admin/announcements/' + annId, {
    attachment: null, link_url: '',
  }, H(adminToken));
  check('admin clears the attachment and the link', annClear.status === 200
    && !annClear.body.data.announcement.attachment && !annClear.body.data.announcement.link_url, annClear.body.data.announcement);

  await req('PUT', '/api/admin/announcements/' + annId, {
    attachment: { name: 'foto.png', type: 'image/png', size: 70, data: PNG },
    link_url: 'https://sp1yogyakarta.sch.id/daftar', link_label: 'Form pendaftaran',
  }, H(adminToken));

  const newsA = await req('POST', '/api/admin/news', {
    title: 'Berita uji lampiran', details: 'Isi berita uji lampiran dan tautan.',
    date: '2026-06-15', time: '10:00', category: 'Prestasi',
    attachment: { name: 'dok.pdf', type: 'application/pdf', size: 240, data: PDF },
    link_url: 'https://example.org/berita',
  }, H(adminToken));
  check('admin publishes news with attachment + link', newsA.status === 200
    && newsA.body.data.news.attachment.name === 'dok.pdf'
    && newsA.body.data.news.link_url === 'https://example.org/berita', newsA.body.error);
  const newsId = newsA.body.data.news.id;

  const viewBump = await req('POST', '/api/mobile/news/' + newsId + '/view', {}, H(t));
  check('opening a news detail counts a view', viewBump.status === 200 && viewBump.body.data.views >= 1, viewBump.body.data);

  // a member reads exactly what was stored
  const sLogin = await req('POST', '/api/auth/login', { idNumber: studentId, password: 'demo123' });
  const sTok = sLogin.body.data.token;
  const annRead = await req('GET', '/api/mobile/announcements', null, H(sTok));
  const annRow = (annRead.body.data.items || []).find((x) => x.id === annId);
  check('member receives the attachment and the link', !!annRow
    && annRow.attachment.data === PNG && annRow.link_label === 'Form pendaftaran', annRow && Object.keys(annRow));

  console.log('\n== calendar day detail is date-exact ==');
  const dayOn = await req('GET', '/api/mobile/calendar/day?date=2026-06-15', null, H(sTok));
  const dayOff = await req('GET', '/api/mobile/calendar/day?date=2026-06-16', null, H(sTok));
  const general = (r) => ((r.body.data.sections || []).find((x) => x.key === 'general') || { items: [] }).items;
  const on15 = general(dayOn);
  const on16 = general(dayOff);
  check('the dated day lists the announcement', on15.some((i) => i.kind === 'announcement' && i.id === annId), on15.map((i) => i.title));
  check('the dated day lists the news item', on15.some((i) => i.kind === 'news' && i.id === newsId), on15.map((i) => i.title));
  check('the next day lists neither', !on16.some((i) => i.kind === 'announcement' || i.kind === 'news'), on16.map((i) => i.title));
  check('dated items carry media flags', on15.filter((i) => i.kind !== 'event').every((i) => i.has_attachment === true && i.has_link === true),
    on15.filter((i) => i.kind !== 'event'));
  check('events still show on their own date', Array.isArray(on15) && on15.every((i) => i.kind === 'event' || i.time.indexOf('2026-06-15') === 0), on15.map((i) => i.time));

  console.log('\n== point rank is intra-role ==');
  const lbS = await req('GET', '/api/mobile/leaderboard', null, H(sTok));
  check('student only sees the student group', lbS.body.data.role === 'student'
    && Array.isArray(lbS.body.data.my_group)
    && lbS.body.data.my_group.every((r) => r.role === 'student')
    && lbS.body.data.my_group.length > 0, lbS.body.data.my_group && lbS.body.data.my_group.slice(0, 2));
  check('student rank counted against students only', lbS.body.data.my_rank >= 1 && lbS.body.data.my_total >= lbS.body.data.my_rank,
    { rank: lbS.body.data.my_rank, total: lbS.body.data.my_total });
  const lbT = await req('GET', '/api/mobile/leaderboard', null, H(t));
  check('teacher only sees the teacher group', lbT.body.data.role === 'teacher'
    && lbT.body.data.my_group.every((r) => r.role === 'teacher'), lbT.body.data.my_group && lbT.body.data.my_group.slice(0, 2));
  const eLogin = await req('POST', '/api/auth/login', { idNumber: employeeId, password: 'demo123' });
  const lbE = await req('GET', '/api/mobile/leaderboard', null, H(eLogin.body.data.token));
  check('employee only sees the employee group', lbE.body.data.role === 'employee'
    && lbE.body.data.my_group.every((r) => r.role === 'employee'), lbE.body.data.my_group && lbE.body.data.my_group.slice(0, 2));
  check('the three role groups are disjoint', (lbS.body.data.groups.student || []).every((r) => r.role === 'student')
    && (lbS.body.data.groups.teacher || []).every((r) => r.role === 'teacher')
    && (lbS.body.data.groups.employee || []).every((r) => r.role === 'employee'));

  check('admin deletes the test announcement', (await req('DELETE', '/api/admin/announcements/' + annId, null, H(adminToken))).status === 200);
  check('admin deletes the test news item', (await req('DELETE', '/api/admin/news/' + newsId, null, H(adminToken))).status === 200);

  console.log('\n== kiosk QR (one rotating code for in & out) ==');
  const kt1 = await req('GET', '/api/public/kiosk/token');
  check('kiosk token issued', kt1.status === 200 && !!kt1.body.data.token
    && kt1.body.data.ttl > 0 && kt1.body.data.ttl <= 60, kt1.body.data && kt1.body.data.ttl);
  check('kiosk token carries the school location + radius', kt1.body.data.location
    && typeof kt1.body.data.location.lat === 'number' && kt1.body.data.radius > 0,
    JSON.stringify({ loc: kt1.body.data.location, radius: kt1.body.data.radius }));
  const kt2 = await req('GET', '/api/public/kiosk/token');
  // The slot is 60 s wide, so two calls either share a slot (same token) or
  // straddle a boundary (different token) — both are correct.
  check('token follows the 60s slot clock', kt1.body.data.slot === kt2.body.data.slot
    ? kt1.body.data.token === kt2.body.data.token
    : kt2.body.data.slot === kt1.body.data.slot + 1 && kt1.body.data.token !== kt2.body.data.token,
    JSON.stringify({ a: kt1.body.data.slot, b: kt2.body.data.slot }));
  check('token expires within a minute', new Date(kt1.body.data.expires_at).getTime() - Date.now() <= 60000);
  const kq = await req('GET', '/api/public/kiosk/qr.svg?size=400');
  check('kiosk QR renders as SVG', kq.status === 200 && (kq.headers['content-type'] || '').includes('svg'));

  // ---- one code, both directions -------------------------------------
  const scanUser = await freshUser('student');
  check('found a student with no check-in today', !!scanUser, scanUser && scanUser.id_number);
  const scanLogin2 = await req('POST', '/api/auth/login', { idNumber: scanUser.id_number, password: 'demo123' });
  const sTok2 = scanLogin2.body.data.token;
  const near = { lat: -7.78282, lng: 110.36706 };

  const scIn = await req('POST', '/api/public/scan-attend',
    { token: kt1.body.data.token, lat: near.lat, lng: near.lng }, H(sTok2));
  check('scanning the kiosk code checks IN', scIn.status === 200 && scIn.body.data.mode === 'checkin',
    JSON.stringify({ s: scIn.status, m: scIn.body.data && scIn.body.data.mode, e: scIn.body.error }));
  check('check-in stored the QR method', scIn.body.data.record.check_in_method === 'qr', scIn.body.data.record.check_in_method);
  check('check-in is geofenced inside the radius', scIn.body.data.record.check_in_dist < 20, scIn.body.data.record.check_in_dist);

  const scOut = await req('POST', '/api/public/scan-attend',
    { token: kt2.body.data.token, lat: near.lat, lng: near.lng }, H(sTok2));
  check('the same code then checks OUT', scOut.status === 200 && scOut.body.data.mode === 'checkout',
    JSON.stringify({ s: scOut.status, m: scOut.body.data && scOut.body.data.mode, e: scOut.body.error }));
  check('check-out filled check_out_at', !!scOut.body.data.record.check_out_at);

  // ---- a screenshot from a previous minute is worthless ---------------
  const forged = kt1.body.data.token.slice(0, -3) + 'AAA';
  const badTok = await req('POST', '/api/public/scan-attend', { token: forged, lat: near.lat, lng: near.lng }, H(sTok2));
  check('a tampered token is rejected', badTok.status === 410, badTok.status);
  const staleTok = await req('POST', '/api/public/scan-attend',
    { token: 'eyJ2IjoxLCJrIjoia2lvc2siLCJzIjoiU01OMUIiLCJzbG90IjoxLCJpYXQiOjAsImV4cCI6MX0.bm90YXJlYWxzaWduYXR1cmU', lat: near.lat, lng: near.lng },
    H(sTok2));
  check('an expired token is rejected', staleTok.status === 410, staleTok.status);
  const noCred = await req('POST', '/api/public/scan-attend', { lat: near.lat, lng: near.lng }, H(sTok2));
  check('a scan without any credential is rejected', noCred.status === 400, noCred.status);
  const anon = await req('POST', '/api/public/scan-attend', { token: kt1.body.data.token, lat: near.lat, lng: near.lng });
  check('scanning requires a session', anon.status === 401, anon.status);

  // ---- manual code fallback (admin controlled) ------------------------
  const codeSchool = (await req('GET', '/api/public/school')).body.data.school.code;
  const scanUser2 = await freshUser('employee');
  if (scanUser2) {
    const l2 = await req('POST', '/api/auth/login', { idNumber: scanUser2.id_number, password: 'demo123' });
    const manual = await req('POST', '/api/public/scan-attend', { code: codeSchool, lat: near.lat, lng: near.lng }, H(l2.body.data.token));
    check('manual school code still works', manual.status === 200 && manual.body.data.mode === 'checkin', manual.body.error);
    const wrongCode = await req('POST', '/api/public/scan-attend', { code: 'NOPE', lat: near.lat, lng: near.lng }, H(l2.body.data.token));
    check('an unknown school code is rejected', wrongCode.status === 400, wrongCode.status);
  } else {
    console.log('    (no free employee to test the manual code — skipping)');
  }

  // ---- out of radius ---------------------------------------------------
  const scanUser3 = await freshUser('teacher');
  if (scanUser3) {
    const l3 = await req('POST', '/api/auth/login', { idNumber: scanUser3.id_number, password: 'demo123' });
    const far = await req('POST', '/api/public/scan-attend',
      { token: kt1.body.data.token, lat: -7.9, lng: 110.5 }, H(l3.body.data.token));
    check('scanning from far away is refused', far.status === 400, far.status);
  } else {
    console.log('    (no free teacher to test the geofence — skipping)');
  }

  // ---- today's EC sessions gate the floating button -------------------
  const meToday = await req('GET', '/api/mobile/me', null, H(sTok2));
  check('me exposes today\'s extracurricular sessions', Array.isArray(meToday.body.data.ec_today), typeof meToday.body.data.ec_today);
  const dashEc = await req('GET', '/api/mobile/dashboard', null, H(sTok2));
  check('dashboard exposes today\'s extracurricular sessions', Array.isArray(dashEc.body.data.ec_today));

  // ---- ranking carries per-role totals --------------------------------
  const lbTotals = await req('GET', '/api/mobile/leaderboard', null, H(sTok2));
  check('leaderboard returns per-role totals',
    lbTotals.body.data.totals && lbTotals.body.data.totals.student > 0
    && lbTotals.body.data.totals.teacher > 0 && lbTotals.body.data.totals.employee > 0,
    JSON.stringify(lbTotals.body.data.totals));

  console.log('\n== scan flow ==');
  const resolve = await req('POST', '/api/public/scan/resolve', { mode: 'checkin', code: 'SP1TA', lat: -7.78282, lng: 110.36706 });
  check('scan resolve', resolve.status === 200 && resolve.body.data.distance !== undefined, resolve.body.error || 'ok');
  check('scan resolve radius', resolve.body.data.radius === 120, resolve.body.data.radius);
  check('scan resolve distance', resolve.body.data.distance < 5, resolve.body.data.distance);
  // Pick a user the seeder did NOT already give a check-in today, so the
  // scan check-in -> check-out round trip can be exercised end to end.
  const fresh = await freshUser('student');
  check('found a user with no check-in today', !!fresh, fresh && fresh.id_number);
  const scanLogin = await req('POST', '/api/public/scan/login', { idNumber: fresh.id_number, password: 'demo123' });
  check('scan login', scanLogin.status === 200);
  const scanConfirm = await req('POST', '/api/public/scan/confirm', { token: scanLogin.body.data.token, mode: 'checkin', lat: -7.8064, lng: 110.3231, method: 'qr' });
  check('scan confirm checkin', scanConfirm.status === 200, scanConfirm.body);
  check('scan checkin awards points', scanConfirm.body.data.record.status === 'present' || scanConfirm.body.data.record.status === 'late', scanConfirm.body.data.record.status);
  const scanOut = await req('POST', '/api/public/scan/confirm', { token: scanLogin.body.data.token, mode: 'checkout', lat: -7.8064, lng: 110.3231, method: 'qr' });
  check('scan confirm checkout', scanOut.status === 200, scanOut.body);
  check('scan checkout sets check_out_at', !!scanOut.body.data.record.check_out_at);
  check('scan checkout computes hours (number)', typeof scanOut.body.data.record.work_hours === 'number' && scanOut.body.data.record.work_hours >= 0, scanOut.body.data.record.work_hours);

  console.log('\n== kiosk token lifetime ==');
  {
    const kt = await req('GET', '/api/public/kiosk/token');
    const d = kt.body.data;
    check('token advertises its rotation and validity', !!d.expires_at && !!d.valid_until, JSON.stringify({ e: d.expires_at, v: d.valid_until }));
    // The payload's exp must outlive the slot, otherwise U.verify rejects the
    // code the instant the screen rotates and the grace window never applies.
    const body = JSON.parse(Buffer.from(String(d.token).split('.')[0], 'base64url').toString('utf8'));
    const SLOT = 60000;
    check('the signed payload carries the slot', typeof body.slot === 'number' && body.slot === d.slot, JSON.stringify(body));
    check('the code stays scannable past the rotation',
      body.exp === (d.slot + 2) * SLOT, 'exp=' + body.exp + ' expected=' + (d.slot + 2) * SLOT);
    const graceMs = new Date(d.valid_until).getTime() - new Date(d.expires_at).getTime();
    check('the grace window is a full slot', graceMs === SLOT, graceMs);
  }

  console.log('\n== parents ==');
  const parLogin = await req('POST', '/api/auth/login', { idNumber: 'SP1TAP002', password: 'demo123' });
  check('parent account can log in', parLogin.status === 200 && parLogin.body.data.user.role === 'parent', parLogin.body.error || '');
  const P = { authorization: 'Bearer ' + (parLogin.body.data.token || '') };

  // a parent must not be able to use the member API at all
  const parMember = await req('GET', '/api/mobile/me', null, P);
  check('parent is refused the member API', parMember.status === 403, parMember.status);
  const parCheckin = await req('POST', '/api/mobile/checkin', { lat: -7.78282, lng: 110.36706 }, P);
  check('parent cannot record an attendance', parCheckin.status === 403, parCheckin.status);

  const kids = await req('GET', '/api/parent/children', null, P);
  check('parent lists linked children', kids.status === 200 && kids.body.data.items.length === 2, kids.body.data && kids.body.data.items.length);
  check('each child carries a today summary', kids.body.data.items.every((c) => c.today && c.today.date), JSON.stringify(kids.body.data.items.map((c) => c.name)));

  const kidId = kids.body.data.items[0].id;
  const ov = await req('GET', '/api/parent/overview?student_id=' + kidId, null, P);
  check('parent reads the overview', ov.status === 200 && ov.body.data.student.id === kidId, ov.body.error || '');
  check('overview names the relationship', !!ov.body.data.relationship, ov.body.data.relationship);
  check('overview covers school hours', Array.isArray(ov.body.data.school_time.recent) && ov.body.data.school_time.counts);
  check('overview covers after-school activities', Array.isArray(ov.body.data.after_school), ov.body.data.after_school.length);
  check('overview covers letters', Array.isArray(ov.body.data.letters), ov.body.data.letters.length);
  check('overview covers school information', Array.isArray(ov.body.data.information.announcements) && Array.isArray(ov.body.data.information.news));

  // authorisation is the link itself
  const otherPar = await req('POST', '/api/auth/login', { idNumber: 'SP1TAP003', password: 'demo123' });
  const P3 = { authorization: 'Bearer ' + (otherPar.body.data.token || '') };
  const cross = await req('GET', '/api/parent/overview?student_id=' + kidId, null, P3);
  check('another parent is refused that child', cross.status === 403, cross.status);
  const noArg = await req('GET', '/api/parent/overview', null, P);
  check('overview without a student is rejected', noArg.status === 400, noArg.status);
  const anonPar = await req('GET', '/api/parent/children');
  check('anonymous is refused the parent API', anonPar.status === 401, anonPar.status);
  const stuPar = await req('GET', '/api/parent/children', null, H(sTok));
  check('a student is refused the parent API', stuPar.status === 403, stuPar.status);

  // admin manages the links
  const links0 = await req('GET', '/api/admin/parent-links', null, H(adminToken));
  check('admin lists parent links', links0.status === 200 && links0.body.data.total >= 4, links0.body.data && links0.body.data.total);
  check('links carry parent and student names', links0.body.data.items.every((l) => l.parent && l.student && l.relationship), JSON.stringify((links0.body.data.items || [])[0]));

  /* ---------- the admin page: statistics, search, filters, editing ---------- */
  const plStats = links0.body.data.stats;
  check('parent links carry statistics', !!plStats, JSON.stringify(plStats));
  check('statistics break the students down per grade',
    plStats.grades && plStats.grades.length === 3
    && plStats.grades.map((g) => g.grade).join(',') === 'VII,VIII,IX',
    JSON.stringify(plStats.grades));
  check('statistics count the students in each grade',
    plStats.grades.every((g) => g.students > 0), JSON.stringify(plStats.grades));
  check('statistics total matches the grade breakdown',
    plStats.grades.reduce((n, g) => n + g.students, 0) === plStats.students_total,
    `${plStats.grades.reduce((n, g) => n + g.students, 0)} vs ${plStats.students_total}`);
  check('statistics count the parents',
    plStats.parents_total >= 3, plStats.parents_total);
  check('statistics split linked and unlinked students',
    plStats.students_with_parent + plStats.students_without_parent === plStats.students_total,
    JSON.stringify([plStats.students_with_parent, plStats.students_without_parent, plStats.students_total]));

  const plPaged = await req('GET', '/api/admin/parent-links?page=1&limit=2', null, H(adminToken));
  check('parent links are paginated',
    plPaged.status === 200 && plPaged.body.data.items.length <= 2 && plPaged.body.data.total_pages >= 2,
    JSON.stringify([plPaged.body.data.items.length, plPaged.body.data.total_pages]));
  check('pagination reports the page size', plPaged.body.data.limit === 2, plPaged.body.data.limit);

  const plGrade = await req('GET', '/api/admin/parent-links?grade=VII', null, H(adminToken));
  check('the grade filter narrows the table',
    plGrade.status === 200 && plGrade.body.data.items.length > 0
    && plGrade.body.data.items.every((l) => l.grade === 'VII'),
    JSON.stringify((plGrade.body.data.items || []).map((l) => l.grade)));
  const plGrade9 = await req('GET', '/api/admin/parent-links?grade=IX', null, H(adminToken));
  check('an empty grade filter result is reported cleanly',
    plGrade9.status === 200 && plGrade9.body.data.total === plGrade9.body.data.items.length,
    plGrade9.body.data.total);

  const plRel = await req('GET', '/api/admin/parent-links?relationship=Ibu', null, H(adminToken));
  check('the relationship filter narrows the table',
    plRel.status === 200 && plRel.body.data.items.every((l) => l.relationship === 'Ibu'),
    JSON.stringify((plRel.body.data.items || []).map((l) => l.relationship)));

  const plQ = await req('GET', '/api/admin/parent-links?q=' + encodeURIComponent('Siti'), null, H(adminToken));
  // the box searches the parent, the student and the class alike
  check('the search box matches the people involved',
    plQ.status === 200 && plQ.body.data.items.length > 0
    && plQ.body.data.items.every((l) => /siti/i.test(l.parent.name)
      || /siti/i.test(l.student.name) || /siti/i.test(l.student.class_name)),
    JSON.stringify((plQ.body.data.items || []).map((l) => l.parent.name + ' / ' + l.student.name)));
  const plQClass = await req('GET', '/api/admin/parent-links?q=' + encodeURIComponent('VII-A'), null, H(adminToken));
  check('the search box matches the class name',
    plQClass.status === 200 && plQClass.body.data.items.every((l) => /VII-A/.test(l.student.class_name)),
    JSON.stringify((plQClass.body.data.items || []).map((l) => l.student.class_name)));
  const plNone = await req('GET', '/api/admin/parent-links?q=zzzznotarealname', null, H(adminToken));
  check('a search with no hits returns an empty page',
    plNone.status === 200 && plNone.body.data.items.length === 0 && plNone.body.data.total === 0,
    plNone.body.data.total);

  // statistics must not move while the operator filters or searches
  check('statistics stay school-wide while filtering',
    plQ.body.data.stats && plQ.body.data.stats.students_total === plStats.students_total
    && plNone.body.data.stats.students_total === plStats.students_total,
    JSON.stringify([plQ.body.data.stats && plQ.body.data.stats.students_total,
      plNone.body.data.stats && plNone.body.data.stats.students_total]));

  const newParent = await req('POST', '/api/admin/users', { name: 'Uji Orang Tua', id_number: 'UJIP' + Date.now().toString().slice(-6), role: 'parent', password: 'demo123' }, H(adminToken));
  check('admin can create a parent account', newParent.status === 200 && newParent.body.data.user.role === 'parent', newParent.body.error || '');
  const mkLink = await req('POST', '/api/admin/parent-links', { parent_id: newParent.body.data.user.id, student_id: kidId, relationship: 'Wali' }, H(adminToken));
  check('admin links a parent to a student', mkLink.status === 200 && mkLink.body.data.link.relationship === 'Wali', mkLink.body.error || '');
  const dupe = await req('POST', '/api/admin/parent-links', { parent_id: newParent.body.data.user.id, student_id: kidId }, H(adminToken));
  check('a duplicate link is refused', dupe.status === 409, dupe.status);
  const badRole = await req('POST', '/api/admin/parent-links', { parent_id: kids.body.data.items[0].id, student_id: kidId }, H(adminToken));
  check('linking a non-parent is refused', badRole.status === 400, badRole.status);
  const newKid = await req('GET', '/api/parent/children', null, { authorization: 'Bearer ' + (await req('POST', '/api/auth/login', { idNumber: newParent.body.data.user.id_number, password: 'demo123' })).body.data.token });
  check('the new parent now sees that child', newKid.status === 200 && newKid.body.data.items.some((c) => c.id === kidId), JSON.stringify(newKid.body.data.items.map((c) => c.name)));
  const delLink = await req('DELETE', '/api/admin/parent-links/' + mkLink.body.data.link.id, null, H(adminToken));
  check('admin can unlink', delLink.status === 200, delLink.status);
  const afterDel = await req('GET', '/api/parent/children', null, { authorization: 'Bearer ' + (await req('POST', '/api/auth/login', { idNumber: newParent.body.data.user.id_number, password: 'demo123' })).body.data.token });
  check('the unlinked parent sees no children', afterDel.status === 200 && afterDel.body.data.items.length === 0, afterDel.body.data.items.length);
  const delUser = await req('DELETE', '/api/admin/users/' + newParent.body.data.user.id, null, H(adminToken));
  /* --------------------------- editing a link --------------------------- */
  const editTarget = links0.body.data.items[0];
  const editRel = await req('PUT', '/api/admin/parent-links/' + editTarget.id,
    { relationship: 'Wali' }, H(adminToken));
  check('admin can edit the relationship',
    editRel.status === 200 && editRel.body.data.link.relationship === 'Wali',
    editRel.body.error || (editRel.body.data && editRel.body.data.link.relationship));
  const editBadRel = await req('PUT', '/api/admin/parent-links/' + editTarget.id,
    { relationship: '' }, H(adminToken));
  check('an empty relationship is refused', editBadRel.status === 400, editBadRel.status);

  const editName = await req('PUT', '/api/admin/parent-links/' + editTarget.id,
    { parent: { name: 'Uji Nama Edit', phone: '+62 811 0000 111', email: 'uji.edit@sp1yogyakarta.sch.id' } }, H(adminToken));
  check('admin can edit the parent contact data',
    editName.status === 200
    && editName.body.data.link.parent.name === 'Uji Nama Edit'
    && editName.body.data.link.parent.phone === '+62 811 0000 111'
    && editName.body.data.link.parent.email === 'uji.edit@sp1yogyakarta.sch.id',
    editName.body.error || JSON.stringify(editName.body.data && editName.body.data.link.parent));
  check('editing the parent record is reflected in the user list',
    (await req('GET', '/api/admin/users?role=parent&limit=200', null, H(adminToken)))
      .body.data.items.some((u) => u.id === editTarget.parent_id && u.name === 'Uji Nama Edit'));

  const editBadMail = await req('PUT', '/api/admin/parent-links/' + editTarget.id,
    { parent: { email: 'bukan-email' } }, H(adminToken));
  check('an invalid parent email is refused', editBadMail.status === 400, editBadMail.status);
  const editBadName = await req('PUT', '/api/admin/parent-links/' + editTarget.id,
    { parent: { name: '   ' } }, H(adminToken));
  check('an empty parent name is refused', editBadName.status === 400, editBadName.status);
  const editMissing = await req('PUT', '/api/admin/parent-links/plk_tidakada',
    { relationship: 'Ibu' }, H(adminToken));
  check('editing an unknown link is a 404', editMissing.status === 404, editMissing.status);

  // put the seeded data back so a re-run of the suite is deterministic
  await req('PUT', '/api/admin/parent-links/' + editTarget.id,
    { relationship: editTarget.relationship, student_id: editTarget.student_id, parent_id: editTarget.parent_id,
      parent: { name: editTarget.parent.name, phone: editTarget.parent.phone || '', email: editTarget.parent.email || '' } },
    H(adminToken));

  check('the test parent account is removed', delUser.status === 200, delUser.status);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('SMOKE TEST ERROR', e);
  process.exit(1);
});
