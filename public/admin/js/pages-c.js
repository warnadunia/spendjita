/* ==========================================================================
   Admin pages — Class timetable (Jadwal Mengajar) and the extracurricular
                 sub-managers: schedules, places, members, mentors/coaches
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.Core;
  const L = global.ListEngine;
  const Pages = global.Pages;
  const H = global.PagesHelpers;
  const { userCell, statusBadge, roleBadge, reqStatusBadge, iconBtn, register } = H;

  const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const WORK_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const GRADE_GROUPS = ['Kelas VII', 'Kelas VIII', 'Kelas IX'];
  const MENTOR_ROLES = ['Pembina', 'Pelatih', 'Asisten Pelatih'];

  const emptyBlock = (title, text, icon) => `<div class="empty">
    <div class="empty-ico">${C.icon(icon || 'inbox', 26, 1.8)}</div>
    <div class="empty-title">${C.esc(title)}</div>
    <div class="empty-text">${C.esc(text || '')}</div>
  </div>`;

  /* ====================== shared: teacher / people cache ================= */
  let teacherCache = null;
  let staffCache = null;
  function loadTeachers() {
    if (teacherCache) return Promise.resolve(teacherCache);
    return C.api('/admin/users?role=teacher&limit=200').then((r) => {
      teacherCache = r.items || [];
      return teacherCache;
    }).catch(() => (teacherCache = []));
  }
  function loadStaff() {
    if (staffCache) return Promise.resolve(staffCache);
    return C.api('/admin/users?role=employee&limit=200').then((r) => {
      staffCache = r.items || [];
      return staffCache;
    }).catch(() => (staffCache = []));
  }

  /* ====================================================================== *
   *  CLASS TIMETABLE — admin assigns a teaching schedule to a teacher
   * ====================================================================== */
  register('classSchedules', {
    title: 'Jadwal Mengajar',
    sub: 'Jadwal pelajaran yang ditugaskan kepada guru',
    icon: 'calendar',
    group: 'Sekolah',

    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Jadwal Mengajar</div>
            <div class="view-sub">Atur jadwal pelajaran per kelas dan tugaskan guru pengampu</div>
          </div>
          <div class="row gap-8 wrap">
            <button class="btn" id="cs-week">${C.icon('calendar', 16, 2.3)} Grid Mingguan</button>
            <button class="btn btn-primary" id="cs-add">${C.icon('plus', 16, 2.4)} Tambah Jadwal</button>
          </div>
        </div>
        <div id="cs-list"></div>`;
      root.querySelector('#cs-add').addEventListener('click', () => this.openForm(null, () => this.reload()));
      root.querySelector('#cs-week').addEventListener('click', () => this.openGrid());

      this._root = root;
      this.reload();
    },

    reload() { if (this._root) this.load(this._root); },

    async load(root) {
      const host = root.querySelector('#cs-list');
      if (!host) return;
      let meta;
      try { meta = await C.api('/admin/class-schedules'); }
      catch (err) { host.innerHTML = `<div class="card">${emptyBlock('Gagal memuat', err.message, 'alert')}</div>`; return; }
      this._teachers = meta.teachers || [];
      this._classes = meta.classes || [];

      const list = L.createList({
        el: host,
        endpoint: '/admin/class-schedules',
        limit: 25,
        search: true,
        searchPlaceholder: 'Cari mata pelajaran, kelas, guru, ruang…',
        defaultSort: 'day',
        transform: (d) => ({
          items: d.items || [],
          total: d.total != null ? d.total : (d.items || []).length,
          page: 1,
          limit: (d.items || []).length || 1,
        }),
        filters: [
          { name: 'day', label: 'Hari', placeholder: 'Semua hari', options: WORK_DAYS.map((d) => ({ value: d, label: d })) },
          {
            name: 'teacher_id', label: 'Guru', placeholder: 'Semua guru',
            options: (meta.teachers || []).map((t) => ({ value: t.id, label: t.name })),
          },
          {
            name: 'class_name', label: 'Kelas', placeholder: 'Semua kelas',
            options: (meta.classes || []).map((c) => ({ value: c, label: c })),
          },
        ],
        columns: [
          {
            label: 'Hari / Waktu', key: 'day', width: '172px',
            render: (r) => `<div>
              <div class="semibold">${C.esc(r.day)}</div>
              <div class="text-xs muted mono">${C.esc(r.start_time)}–${C.esc(r.end_time)}</div>
            </div>`,
          },
          {
            label: 'Kelas', key: 'class_name', width: '104px',
            render: (r) => r.class_name ? `<span class="badge badge-brand">${C.esc(r.class_name)}</span>` : '<span class="dim">—</span>',
          },
          {
            label: 'Mata Pelajaran', key: 'subject',
            render: (r) => `<div class="semibold">${C.esc(r.subject || '—')}</div>
              ${r.note ? `<div class="text-xs muted">${C.esc(r.note)}</div>` : ''}`,
          },
          {
            label: 'Guru Pengampu', key: 'teacher_name',
            render: (r) => r.teacher_name
              ? userCell({ name: r.teacher_name, id_number: '' })
              : '<span class="badge badge-warn">Belum ditugaskan</span>',
          },
          {
            label: 'Ruang', key: 'room', width: '132px',
            render: (r) => `<span class="text-sm">${C.esc(r.room || '—')}</span>`,
          },
          {
            label: 'Status', key: 'active', width: '104px',
            render: (r) => r.active === false ? '<span class="badge badge-muted">Nonaktif</span>' : '<span class="badge badge-ok"><i class="badge-dot"></i>Aktif</span>',
          },
        ],
        rowActions: () => `${iconBtn('edit', 'edit', 'Ubah')} ${iconBtn('delete', 'trash', 'Hapus')}`,
        empty: {
          icon: 'calendar',
          title: 'Belum ada jadwal',
          text: 'Tambahkan jadwal pelajaran untuk menugaskan guru pada kelas tertentu.',
        },
      });

      list.load();

      host.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        if (!tr) return;
        const rec = (list.state.data.items || []).find((r) => r.id === tr.dataset.id);
        if (!rec) return;
        if (btn.dataset.act === 'edit') this.openForm(rec, () => this.reload());
        if (btn.dataset.act === 'delete') this.remove(rec, () => this.reload());
      });
    },

    async remove(rec, done) {
      const ok = await C.confirmDialog({
        title: 'Hapus jadwal?',
        text: `Jadwal ${rec.subject || ''} kelas ${rec.class_name || '—'} hari ${rec.day} akan dihapus.`,
        okText: 'Ya, hapus',
        danger: true,
      });
      if (!ok) return;
      try { await C.api('/admin/class-schedules/' + rec.id, { method: 'DELETE' }); C.toastOk('Dihapus', 'Jadwal berhasil dihapus.'); done && done(); }
      catch (err) { C.toastErr('Gagal', err.message); }
    },

    openForm(row, done) {
      const isEdit = !!row;
      const teachers = this._teachers || [];
      const classes = this._classes || [];
      const m = C.modal({
        title: isEdit ? 'Ubah jadwal mengajar' : 'Tambah jadwal mengajar',
        sub: 'Tugaskan guru pada kelas, hari dan jam tertentu',
        wide: true,
        okText: isEdit ? 'Simpan' : 'Tambahkan',
        body: `
          <div class="form-grid mb-12">
            <div class="field">
              <label class="label">Hari <span class="req">*</span></label>
              <select class="select" name="day" data-autofocus>
                ${WORK_DAYS.map((d) => `<option value="${d}" ${row && row.day === d ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="label">Kelas <span class="req">*</span></label>
              <input class="input" name="class_name" list="cs-classes" placeholder="mis. X-A" value="${C.esc(row ? row.class_name : '')}">
              <datalist id="cs-classes">${classes.map((c) => `<option value="${C.esc(c)}">`).join('')}</datalist>
            </div>
            <div class="field">
              <label class="label">Jam mulai <span class="req">*</span></label>
              <input class="input" type="time" name="start_time" value="${C.esc(row ? row.start_time : '07:30')}">
            </div>
            <div class="field">
              <label class="label">Jam selesai <span class="req">*</span></label>
              <input class="input" type="time" name="end_time" value="${C.esc(row ? row.end_time : '08:50')}">
            </div>
          </div>
          <div class="form-grid mb-12">
            <div class="field">
              <label class="label">Mata pelajaran</label>
              <input class="input" name="subject" placeholder="mis. Matematika" value="${C.esc(row ? row.subject : '')}">
            </div>
            <div class="field">
              <label class="label">Ruang / Tempat</label>
              <input class="input" name="room" placeholder="mis. Ruang X-A" value="${C.esc(row ? row.room : '')}">
            </div>
          </div>
          <div class="field mb-12">
            <label class="label">Guru pengampu <span class="req">*</span></label>
            <select class="select" name="teacher_id" id="cs-teacher">
              <option value="">— Pilih guru —</option>
              ${teachers.map((t) => `<option value="${t.id}" ${row && row.teacher_id === t.id ? 'selected' : ''}>${C.esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field mb-12">
            <label class="label">Keterangan</label>
            <input class="input" name="note" placeholder="opsional" value="${C.esc(row ? row.note : '')}">
          </div>
          <label class="check"><input type="checkbox" name="active" ${!row || row.active !== false ? 'checked' : ''}> Jadwal aktif</label>`,
        onMount(api) {
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = C.formValues(api.body);
            if (!v.day) return m.error('Pilih hari.');
            if (!v.class_name || !String(v.class_name).trim()) return m.error('Kelas wajib diisi.');
            if (!v.teacher_id) return m.error('Pilih guru pengampu.');
            if (!v.start_time || !v.end_time) return m.error('Jam mulai dan selesai wajib diisi.');
            if (v.end_time <= v.start_time) return m.error('Jam selesai harus setelah jam mulai.');
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = isEdit
                ? await C.api('/admin/class-schedules/' + row.id, { method: 'PUT', body: v })
                : await C.api('/admin/class-schedules', { method: 'POST', body: v });
              api.close();
              C.toastOk(isEdit ? 'Disimpan' : 'Ditambahkan', res.message || 'Jadwal disimpan.');
              done && done();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      if (!teachers.length) {
        loadTeachers().then((list) => {
          this._teachers = list;
          const sel = m.body.querySelector('[name="teacher_id"]');
          if (sel) sel.innerHTML = '<option value="">— Pilih guru —</option>' + list.map((t) => `<option value="${t.id}" ${row && row.teacher_id === t.id ? 'selected' : ''}>${C.esc(t.name)}</option>`).join('');
        });
      }
      return m;
    },

    /** Read-only weekly grid of every class timetable entry. */
    async openGrid() {
      const m = C.modal({
        title: 'Grid jadwal mingguan',
        sub: 'Seluruh jadwal pelajaran per kelas',
        wide: true,
        footer: '<button class="btn" data-cancel>Tutup</button>',
        body: '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>',
        onMount(api) { api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close()); },
      });
      let d;
      try { d = await C.api('/admin/class-schedules'); }
      catch (err) { m.body.innerHTML = emptyBlock('Gagal memuat', err.message, 'alert'); return m; }
      const rows = d.items || [];
      if (!rows.length) { m.body.innerHTML = emptyBlock('Belum ada jadwal', 'Tambahkan jadwal mengajar terlebih dahulu.', 'calendar'); return m; }
      const byClass = {};
      rows.forEach((r) => {
        const k = r.class_name || '—';
        (byClass[k] = byClass[k] || {})[r.day] = (byClass[k][r.day] || []).concat(r);
      });
      Object.values(byClass).forEach((days) => Object.keys(days).forEach((k) => days[k].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))));
      m.body.innerHTML = Object.keys(byClass).sort().map((cls) => `
        <div class="card mb-16" style="box-shadow:none;background:var(--ink-50)">
          <div class="card-body" style="padding:14px">
            <div class="semibold mb-8">Kelas ${C.esc(cls)}</div>
            <table class="data">
              <thead><tr><th>Hari</th><th>Jam</th><th>Mata Pelajaran</th><th>Guru</th><th>Ruang</th></tr></thead>
              <tbody>
                ${WORK_DAYS.map((day) => {
                  const list = (byClass[cls][day] || []);
                  if (!list.length) return `<tr><td class="semibold">${day}</td><td colspan="4" class="dim">—</td></tr>`;
                  return list.map((r, i) => `<tr>
                    <td>${i === 0 ? `<span class="semibold">${day}</span>` : ''}</td>
                    <td class="mono text-xs">${C.esc(r.start_time)}–${C.esc(r.end_time)}</td>
                    <td>${C.esc(r.subject || '—')}</td>
                    <td>${C.esc(r.teacher_name || '—')}</td>
                    <td>${C.esc(r.room || '—')}</td>
                  </tr>`).join('');
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`).join('');
      return m;
    },
  });

  /* ====================================================================== *
   *  EXTRACURRICULAR SUB-MANAGERS
   * ====================================================================== */
  const Managers = global.Pages.ecManagers = global.Pages.ecManagers || {};

  /* ------------------------------ schedules ---------------------------- */
  Managers.openSchedules = function (ec, onDone) {
    const m = C.modal({
      title: 'Jadwal kegiatan',
      sub: ec.name,
      wide: true,
      footer: '<button class="btn btn-primary" data-add>' + C.icon('plus', 15, 2.4) + ' Tambah Jadwal</button><button class="btn" data-cancel>Tutup</button>',
      body: '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>',
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-add]').addEventListener('click', () => Managers.editSchedule(ec, null, () => { draw(); onDone && onDone(); }));
      },
    });
    draw();

    function draw() {
      m.body.innerHTML = '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>';
      Promise.all([
        C.api('/admin/ec-schedules?extracurricular_id=' + ec.id),
        C.api('/admin/ec-places?extracurricular_id=' + ec.id),
      ]).then(([sd, pd]) => {
        ec._schedules = sd.items || [];
        ec._places = pd.items || [];
        render(sd.items || [], pd.items || []);
      }).catch((err) => { m.body.innerHTML = emptyBlock('Gagal memuat', err.message, 'alert'); });
    }

    function render(rows, places) {
      const grouped = {};
      rows.forEach((r) => { (grouped[r.day] = grouped[r.day] || []).push(r); });
      const days = Object.keys(grouped).sort((a, b) => DOW.indexOf(a) - DOW.indexOf(b));
      m.body.innerHTML = days.length ? `
        <div class="text-xs muted mb-12" style="margin-bottom:12px">
          ${rows.length} jadwal · ${places.length} tempat terdaftar. Setiap jadwal dapat dibatasi untuk kelompok tertentu.
        </div>
        ${days.map((day) => `
          <div class="card mb-12" style="box-shadow:none;background:var(--ink-50)">
            <div class="card-body" style="padding:13px">
              <div class="semibold mb-8">${C.esc(day)}</div>
              ${grouped[day].map((r) => `
                <div class="row between gap-8" style="padding:8px 10px;background:#fff;border-radius:11px;margin-bottom:6px">
                  <div class="grow" style="min-width:0">
                    <div class="row gap-8 wrap">
                      <b class="mono text-sm">${C.esc(r.start_time)}–${C.esc(r.end_time)}</b>
                      <span class="text-sm">${C.esc((r.place && r.place.name) || 'Tanpa tempat')}</span>
                      ${r.grade_group ? `<span class="badge badge-violet">${C.esc(r.grade_group)}</span>` : '<span class="badge badge-muted">Semua kelompok</span>'}
                      ${r.active === false ? '<span class="badge badge-muted">Nonaktif</span>' : ''}
                    </div>
                    ${r.note ? `<div class="text-xs muted mt-4">${C.esc(r.note)}</div>` : ''}
                  </div>
                  <div class="row gap-4">
                    <button class="icon-btn btn-sm" data-edit="${r.id}" title="Ubah">${C.icon('edit', 15, 2.2)}</button>
                    <button class="icon-btn btn-sm" data-del="${r.id}" title="Hapus">${C.icon('trash', 15, 2.2)}</button>
                  </div>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      ` : emptyBlock('Belum ada jadwal', 'Tambahkan jadwal latihan untuk kegiatan ini.', 'calendar');

      m.body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const row = (ec._schedules || []).find((x) => x.id === b.dataset.edit);
        Managers.editSchedule(ec, row, () => { draw(); onDone && onDone(); });
      }));
      m.body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const row = (ec._schedules || []).find((x) => x.id === b.dataset.del);
        if (!(await C.confirmDialog({ title: 'Hapus jadwal?', text: `Jadwal ${row.day} ${row.start_time}–${row.end_time} akan dihapus.`, okText: 'Ya, hapus', danger: true }))) return;
        try {
          await C.api('/admin/ec-schedules/' + row.id, { method: 'DELETE' });
          C.toastOk('Dihapus', 'Jadwal berhasil dihapus.');
          draw(); onDone && onDone();
        } catch (err) { C.toastErr('Gagal', err.message); }
      }));
    }
    return m;
  };

  Managers.editSchedule = function (ec, row, done) {
    const isEdit = !!row;
    const places = ec._places || [];
    const groups = (ec.grade_groups || []).length ? ec.grade_groups : GRADE_GROUPS;
    const m = C.modal({
      title: isEdit ? 'Ubah jadwal' : 'Tambah jadwal',
      sub: ec.name,
      okText: isEdit ? 'Simpan' : 'Tambahkan',
      body: `
        <div class="form-grid mb-12">
          <div class="field">
            <label class="label">Hari <span class="req">*</span></label>
            <select class="select" name="day" data-autofocus>
              ${DOW.map((d) => `<option value="${d}" ${row && row.day === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="label">Kelompok siswa</label>
            <select class="select" name="grade_group">
              <option value="">Semua kelompok</option>
              ${GRADE_GROUPS.map((g) => `<option value="${g}" ${row && row.grade_group === g ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="label">Jam mulai</label>
            <input class="input" type="time" name="start_time" value="${C.esc(row ? row.start_time : ec.start_time || '15:45')}">
          </div>
          <div class="field">
            <label class="label">Jam selesai</label>
            <input class="input" type="time" name="end_time" value="${C.esc(row ? row.end_time : ec.end_time || '17:15')}">
          </div>
        </div>
        <div class="field mb-12">
          <label class="label">Tempat kegiatan</label>
          <select class="select" name="place_id">
            <option value="">— Tanpa tempat khusus —</option>
            ${places.map((p) => `<option value="${p.id}" ${row && row.place_id === p.id ? 'selected' : ''}>${C.esc(p.name)}</option>`).join('')}
          </select>
          <div class="hint mt-4">Tempat dikelola melalui tombol <b>Tempat</b> pada kartu kegiatan.</div>
        </div>
        <div class="field mb-12">
          <label class="label">Keterangan</label>
          <input class="input" name="note" placeholder="opsional" value="${C.esc(row ? row.note : '')}">
        </div>
        <label class="check"><input type="checkbox" name="active" ${!row || row.active !== false ? 'checked' : ''}> Jadwal aktif</label>
        ${!places.length ? `<div class="hint mt-8">Kegiatan ini belum punya tempat terdaftar — jadwal akan memakai titik GPS utama kegiatan.</div>` : ''}`,
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-submit]').addEventListener('click', async () => {
          m.clearError();
          const v = C.formValues(api.body);
          if (!v.day) return m.error('Pilih hari.');
          if (v.end_time && v.start_time && v.end_time <= v.start_time) return m.error('Jam selesai harus setelah jam mulai.');
          api.setBusy(true, 'Menyimpan…');
          try {
            const body = Object.assign({ extracurricular_id: ec.id }, v, { place_lat: '', place_lng: '' });
            const res = isEdit
              ? await C.api('/admin/ec-schedules/' + row.id, { method: 'PUT', body })
              : await C.api('/admin/ec-schedules', { method: 'POST', body });
            api.close();
            C.toastOk(isEdit ? 'Disimpan' : 'Ditambahkan', res.message || 'Jadwal disimpan.');
            done && done();
          } catch (err) { api.setBusy(false); m.error(err.message); }
        });
      },
    });
    return m;
  };

  /* -------------------------------- places ----------------------------- */
  Managers.openPlaces = function (ec, onDone) {
    const m = C.modal({
      title: 'Tempat kegiatan',
      sub: ec.name,
      wide: true,
      footer: '<button class="btn btn-primary" data-add>' + C.icon('plus', 15, 2.4) + ' Tambah Tempat</button><button class="btn" data-cancel>Tutup</button>',
      body: '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>',
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-add]').addEventListener('click', () => Managers.editPlace(ec, null, () => { draw(); onDone && onDone(); }));
      },
    });
    draw();

    function draw() {
      m.body.innerHTML = '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>';
      C.api('/admin/ec-places?extracurricular_id=' + ec.id).then((d) => render(d.items || []))
        .catch((err) => { m.body.innerHTML = emptyBlock('Gagal memuat', err.message, 'alert'); });
    }

    function render(rows) {
      m.body.innerHTML = rows.length ? `
        <div class="text-xs muted mb-12" style="margin-bottom:12px">
          ${rows.length} tempat terdaftar. Titik ini menjadi pusat radius GPS Lock untuk jadwal yang memakainya.
        </div>
        ${rows.map((p) => `
          <div class="row between gap-8" style="padding:12px 14px;background:var(--ink-50);border-radius:13px;margin-bottom:8px">
            <div class="grow" style="min-width:0">
              <div class="row gap-8 wrap">
                <span class="semibold">${C.esc(p.name)}</span>
                <span class="badge badge-muted">radius ${p.radius_m || 60} m</span>
                ${p.active === false ? '<span class="badge badge-muted">Nonaktif</span>' : ''}
              </div>
              ${p.note ? `<div class="text-xs muted mt-4">${C.esc(p.note)}</div>` : ''}
              <div class="mono text-xs muted mt-4">${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}</div>
            </div>
            <div class="row gap-4">
              <button class="icon-btn btn-sm" data-edit="${p.id}" title="Ubah">${C.icon('edit', 15, 2.2)}</button>
              <button class="icon-btn btn-sm" data-del="${p.id}" title="Hapus">${C.icon('trash', 15, 2.2)}</button>
            </div>
          </div>`).join('')}
      ` : emptyBlock('Belum ada tempat', 'Tambahkan tempat latihan agar setiap jadwal bisa dikunci dengan GPS.', 'map');

      m.body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
        const d = await C.api('/admin/ec-places?extracurricular_id=' + ec.id);
        const row = (d.items || []).find((x) => x.id === b.dataset.edit);
        Managers.editPlace(ec, row, () => { draw(); onDone && onDone(); });
      }));
      m.body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await C.confirmDialog({ title: 'Hapus tempat?', text: 'Jadwal yang memakai tempat ini akan kembali ke titik utama kegiatan.', okText: 'Ya, hapus', danger: true }))) return;
        try { await C.api('/admin/ec-places/' + b.dataset.del, { method: 'DELETE' }); C.toastOk('Dihapus', 'Tempat berhasil dihapus.'); draw(); onDone && onDone(); }
        catch (err) { C.toastErr('Gagal', err.message); }
      }));
    }
    return m;
  };

  Managers.editPlace = function (ec, row, done) {
    const isEdit = !!row;
    const m = C.modal({
      title: isEdit ? 'Ubah tempat' : 'Tambah tempat',
      sub: ec.name,
      okText: isEdit ? 'Simpan' : 'Tambahkan',
      body: `
        <div class="field mb-12">
          <label class="label">Nama tempat <span class="req">*</span></label>
          <input class="input" name="name" data-autofocus placeholder="mis. Lapangan Upacara" value="${C.esc(row ? row.name : '')}">
        </div>
        <div class="field mb-12">
          <label class="label">Keterangan</label>
          <input class="input" name="note" placeholder="opsional" value="${C.esc(row ? row.note : '')}">
        </div>
        <div class="form-grid mb-12">
          <div class="field"><label class="label">Lintang (lat)</label>
            <input class="input" name="lat" value="${C.esc(row ? row.lat : ec.location_lat)}"></div>
          <div class="field"><label class="label">Bujur (lng)</label>
            <input class="input" name="lng" value="${C.esc(row ? row.lng : ec.location_lng)}"></div>
          <div class="field"><label class="label">Radius GPS (m)</label>
            <input class="input" type="number" min="10" name="radius_m" value="${C.esc(row ? row.radius_m : 60)}"></div>
        </div>
        <button class="btn btn-sm" type="button" id="pl-here">${C.icon('target', 14, 2.3)} Gunakan lokasi saya</button>
        <span class="hint" id="pl-hint" style="margin-left:8px"></span>
        <label class="check mt-12"><input type="checkbox" name="active" ${!row || row.active !== false ? 'checked' : ''}> Tempat aktif</label>`,
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('#pl-here').addEventListener('click', () => {
          if (!navigator.geolocation) return C.toastWarn('GPS tidak tersedia', 'Perangkat ini tidak mendukung geolokasi.');
          navigator.geolocation.getCurrentPosition((pos) => {
            api.body.querySelector('[name="lat"]').value = pos.coords.latitude.toFixed(6);
            api.body.querySelector('[name="lng"]').value = pos.coords.longitude.toFixed(6);
            api.el.querySelector('#pl-hint').textContent = 'Koordinat diperbarui dari lokasi Anda.';
            C.toastOk('Lokasi tersimpan', 'Koordinat tempat diperbarui.');
          }, () => C.toastErr('Gagal', 'Tidak dapat mengambil lokasi.'));
        });
        api.el.querySelector('[data-submit]').addEventListener('click', async () => {
          m.clearError();
          const v = C.formValues(api.body);
          if (!v.name || String(v.name).trim().length < 2) return m.error('Nama tempat minimal 2 karakter.');
          api.setBusy(true, 'Menyimpan…');
          try {
            const body = Object.assign({ extracurricular_id: ec.id }, v);
            const res = isEdit
              ? await C.api('/admin/ec-places/' + row.id, { method: 'PUT', body })
              : await C.api('/admin/ec-places', { method: 'POST', body });
            api.close();
            C.toastOk(isEdit ? 'Disimpan' : 'Ditambahkan', res.message || 'Tempat disimpan.');
            done && done();
          } catch (err) { api.setBusy(false); m.error(err.message); }
        });
      },
    });
    return m;
  };

  /* ------------------------------ mentors ------------------------------ */
  Managers.openMentors = function (ec, onDone) {
    const m = C.modal({
      title: 'Pembina &amp; pelatih',
      sub: ec.name,
      wide: true,
      footer: '<button class="btn btn-primary" data-add>' + C.icon('plus', 15, 2.4) + ' Tambah Pembina</button><button class="btn" data-cancel>Tutup</button>',
      body: '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>',
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-add]').addEventListener('click', () => Managers.editMentor(ec, null, () => { draw(); onDone && onDone(); }));
      },
    });
    draw();

    function draw() {
      m.body.innerHTML = '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>';
      C.api('/admin/ec-mentors?extracurricular_id=' + ec.id).then((d) => render(d.items || []))
        .catch((err) => { m.body.innerHTML = emptyBlock('Gagal memuat', err.message, 'alert'); });
    }

    function render(rows) {
      m.body.innerHTML = rows.length ? `
        <div class="text-xs muted mb-12" style="margin-bottom:12px">
          ${rows.length} pembina terdaftar. Pembina hanya melihat ekstrakurikuler yang ditugaskan kepadanya.
        </div>
        ${rows.map((r) => `
          <div class="row between gap-8" style="padding:11px 14px;background:var(--ink-50);border-radius:13px;margin-bottom:8px">
            <div class="grow" style="min-width:0">${userCell({ name: r.user_name, id_number: r.id_number })}</div>
            <div class="row gap-6">
              ${roleBadge(r.user_role)}
              <span class="badge ${r.is_primary ? 'badge-brand' : 'badge-muted'}">${C.esc(r.mentor_role || '')}</span>
              <button class="icon-btn btn-sm" data-edit="${r.id}" title="Ubah">${C.icon('edit', 15, 2.2)}</button>
              <button class="icon-btn btn-sm" data-del="${r.id}" title="Hapus">${C.icon('trash', 15, 2.2)}</button>
            </div>
          </div>`).join('')}
      ` : emptyBlock('Belum ada pembina', 'Tugaskan guru atau karyawan sebagai pembina kegiatan ini.', 'users');

      m.body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
        const d = await C.api('/admin/ec-mentors?extracurricular_id=' + ec.id);
        const row = (d.items || []).find((x) => x.id === b.dataset.edit);
        Managers.editMentor(ec, row, () => { draw(); onDone && onDone(); });
      }));
      m.body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await C.confirmDialog({ title: 'Keluarkan pembina?', text: 'Pembina tidak lagi melihat kegiatan ini pada aplikasi seluler.', okText: 'Ya, keluarkan', danger: true }))) return;
        try { await C.api('/admin/ec-mentors/' + b.dataset.del, { method: 'DELETE' }); C.toastOk('Dihapus', 'Pembina dikeluarkan.'); draw(); onDone && onDone(); }
        catch (err) { C.toastErr('Gagal', err.message); }
      }));
    }
    return m;
  };

  Managers.editMentor = function (ec, row, done) {
    const isEdit = !!row;
    const m = C.modal({
      title: isEdit ? 'Ubah pembina' : 'Tambah pembina',
      sub: ec.name,
      okText: isEdit ? 'Simpan' : 'Tambahkan',
      body: `
        ${isEdit ? `<div class="field mb-12"><label class="label">Pembina</label>
          <input class="input" value="${C.esc(row.user_name)}" disabled></div>` : `
        <div class="field mb-12">
          <label class="label">Guru / Karyawan <span class="req">*</span></label>
          <select class="select" name="user_id" id="mt-user" data-autofocus><option value="">Memuat daftar…</option></select>
        </div>`}
        <div class="field mb-12">
          <label class="label">Peran</label>
          <select class="select" name="mentor_role">
            ${MENTOR_ROLES.map((r) => `<option value="${r}" ${row && row.mentor_role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <label class="check"><input type="checkbox" name="is_primary" ${row && row.is_primary ? 'checked' : ''}> Jadikan pembina utama</label>`,
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-submit]').addEventListener('click', async () => {
          m.clearError();
          const v = C.formValues(api.body);
          if (!isEdit && !v.user_id) return m.error('Pilih guru atau karyawan.');
          api.setBusy(true, 'Menyimpan…');
          try {
            const res = isEdit
              ? await C.api('/admin/ec-mentors/' + row.id, { method: 'PUT', body: v })
              : await C.api('/admin/ec-mentors', { method: 'POST', body: Object.assign({ extracurricular_id: ec.id }, v) });
            api.close();
            C.toastOk(isEdit ? 'Disimpan' : 'Ditambahkan', res.message || 'Pembina disimpan.');
            done && done();
          } catch (err) { api.setBusy(false); m.error(err.message); }
        });
        if (!isEdit) {
          Promise.all([loadTeachers(), loadStaff()]).then(([t, e]) => {
            const sel = api.body.querySelector('#mt-user');
            if (!sel) return;
            sel.innerHTML = '<option value="">— Pilih —</option>'
              + `<optgroup label="Guru">${t.map((x) => `<option value="${x.id}">${C.esc(x.name)}</option>`).join('')}</optgroup>`
              + `<optgroup label="Karyawan">${e.map((x) => `<option value="${x.id}">${C.esc(x.name)}</option>`).join('')}</optgroup>`;
          });
        }
      },
    });
    return m;
  };

  /* ------------------------------ members ------------------------------ */
  Managers.openMembers = function (ec, onDone) {
    let filterGroup = '';
    const m = C.modal({
      title: 'Anggota ekstrakurikuler',
      sub: ec.name,
      wide: true,
      footer: '<button class="btn btn-primary" data-add>' + C.icon('plus', 15, 2.4) + ' Tambah Anggota</button><button class="btn" data-cancel>Tutup</button>',
      body: '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>',
      onMount(api) {
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-add]').addEventListener('click', () => Managers.addMembers(ec, () => { draw(); onDone && onDone(); }));
      },
    });
    draw();

    function draw() {
      m.body.innerHTML = '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>';
      C.api('/admin/ec-members?extracurricular_id=' + ec.id).then((d) => render(d.items || [], d.groups || {}))
        .catch((err) => { m.body.innerHTML = emptyBlock('Gagal memuat', err.message, 'alert'); });
    }

    function render(rows, groups) {
      const groupNames = Object.keys(groups).sort();
      const shown = filterGroup ? rows.filter((r) => (r.grade_group || 'Tanpa Kelompok') === filterGroup) : rows;
      m.body.innerHTML = `
        <div class="row between gap-8 wrap mb-12" style="margin-bottom:12px">
          <div class="row gap-6 wrap">
            <button class="chip ${filterGroup ? '' : 'is-active'}" data-grp="">Semua <b>${rows.length}</b></button>
            ${groupNames.map((g) => `<button class="chip ${filterGroup === g ? 'is-active' : ''}" data-grp="${C.esc(g)}">${C.esc(g)} <b>${groups[g]}</b></button>`).join('')}
          </div>
          <span class="text-xs muted">Kelompok dipakai untuk membatasi jadwal</span>
        </div>
        ${shown.length ? `<table class="data">
          <thead><tr><th>Peserta Didik</th><th>Kelas</th><th style="width:170px">Kelompok</th><th style="width:80px"></th></tr></thead>
          <tbody>${shown.map((r) => `<tr data-id="${r.id}">
            <td>${userCell({ name: r.user_name, id_number: r.id_number })}</td>
            <td><span class="badge badge-brand">${C.esc(r.class_name || '—')}</span></td>
            <td>
              <select class="select" data-grp-set="${r.id}" style="height:34px;padding:0 8px;font-size:.8rem">
                <option value="">—</option>
                ${GRADE_GROUPS.map((g) => `<option value="${g}" ${r.grade_group === g ? 'selected' : ''}>${g}</option>`).join('')}
              </select>
            </td>
            <td><button class="icon-btn btn-sm" data-del="${r.id}" title="Keluarkan">${C.icon('trash', 15, 2.2)}</button></td>
          </tr>`).join('')}</tbody>
        </table>` : emptyBlock('Belum ada anggota', 'Tambahkan peserta didik ke kegiatan ini.', 'users')}`;

      m.body.querySelectorAll('[data-grp]').forEach((b) => b.addEventListener('click', () => { filterGroup = b.dataset.grp; draw(); }));
      m.body.querySelectorAll('[data-grp-set]').forEach((sel) => sel.addEventListener('change', async () => {
        try {
          await C.api('/admin/ec-members/' + sel.dataset.grpSet, { method: 'PUT', body: { grade_group: sel.value } });
          C.toastOk('Disimpan', 'Kelompok anggota diperbarui.');
          draw(); onDone && onDone();
        } catch (err) { C.toastErr('Gagal', err.message); }
      }));
      m.body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await C.confirmDialog({ title: 'Keluarkan anggota?', text: 'Riwayat kehadiran anggota tetap tersimpan.', okText: 'Ya, keluarkan', danger: true }))) return;
        try { await C.api('/admin/ec-members/' + b.dataset.del, { method: 'DELETE' }); C.toastOk('Dihapus', 'Anggota dikeluarkan.'); draw(); onDone && onDone(); }
        catch (err) { C.toastErr('Gagal', err.message); }
      }));
    }
    return m;
  };

  /** Bulk enrolment sheet — pick a grade group, tick students, add them. */
  Managers.addMembers = function (ec, done) {
    const selected = new Set();
    let candidates = [];
    const m = C.modal({
      title: 'Tambah anggota',
      sub: ec.name,
      wide: true,
      okText: 'Tambahkan Terpilih',
      body: `
        <div class="row gap-8 wrap mb-12" style="margin-bottom:12px">
          <select class="select" id="am-group" style="max-width:200px">
            <option value="">Kelompok: ikuti kelas</option>
            ${GRADE_GROUPS.map((g) => `<option value="${g}">${g}</option>`).join('')}
          </select>
          <input class="input" id="am-q" placeholder="Cari nama, ID atau kelas…" style="flex:1 1 200px;min-width:0">
          <select class="select" id="am-class" style="max-width:150px"><option value="">Semua kelas</option></select>
        </div>
        <div id="am-list" style="max-height:46vh;overflow:auto;border:1px solid var(--ink-200);border-radius:13px"></div>
        <div class="row between mt-8" style="margin-top:10px">
          <span class="hint" id="am-count">0 dipilih</span>
          <button class="btn btn-sm btn-ghost" type="button" id="am-all">Pilih semua yang tampil</button>
        </div>`,
      onMount(api) {
        const listEl = api.body.querySelector('#am-list');
        const qEl = api.body.querySelector('#am-q');
        const classEl = api.body.querySelector('#am-class');
        const countEl = api.body.querySelector('#am-count');

        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.body.querySelector('#am-all').addEventListener('click', () => {
          const allOn = candidates.every((c) => selected.has(c.id));
          candidates.forEach((c) => (allOn ? selected.delete(c.id) : selected.add(c.id)));
          paint();
        });
        qEl.addEventListener('input', C.debounce(() => load(), 240));
        classEl.addEventListener('change', () => load());

        function paint() {
          countEl.textContent = `${selected.size} dipilih`;
          if (!candidates.length) {
            listEl.innerHTML = '<div class="empty"><div class="empty-title">Tidak ada peserta didik tersedia</div><div class="empty-text">Semua peserta didik sudah terdaftar atau filter tidak cocok.</div></div>';
            return;
          }
          listEl.innerHTML = candidates.map((c) => `
            <label class="row gap-10" style="padding:10px 13px;border-bottom:1px solid var(--ink-100);cursor:pointer">
              <input type="checkbox" data-pick="${c.id}" ${selected.has(c.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--brand)">
              <span class="grow" style="min-width:0">
                <span class="semibold text-sm">${C.esc(c.name)}</span>
                <span class="text-xs muted" style="display:block">${C.esc(c.id_number || '')} · Kelas ${C.esc(c.class_name || '—')}</span>
              </span>
              <span class="badge badge-muted">${C.esc(c.grade_group || '—')}</span>
            </label>`).join('');
          listEl.querySelectorAll('[data-pick]').forEach((cb) => cb.addEventListener('change', () => {
            if (cb.checked) selected.add(cb.dataset.pick); else selected.delete(cb.dataset.pick);
            countEl.textContent = `${selected.size} dipilih`;
          }));
        }

        async function load() {
          listEl.innerHTML = '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>';
          try {
            const d = await C.api('/admin/ec-candidates?' + new URLSearchParams({
              extracurricular_id: ec.id,
              q: qEl.value || '',
            }).toString());
            let items = d.items || [];
            if (classEl.value) items = items.filter((x) => x.class_name === classEl.value);
            candidates = items;
            if (!classEl.options.length || classEl.dataset.filled !== '1') {
              const classes = [...new Set((d.items || []).map((x) => x.class_name).filter(Boolean))].sort();
              classEl.innerHTML = '<option value="">Semua kelas</option>' + classes.map((c) => `<option value="${C.esc(c)}">Kelas ${C.esc(c)}</option>`).join('');
              classEl.dataset.filled = '1';
            }
            paint();
          } catch (err) {
            listEl.innerHTML = `<div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div>`;
          }
        }

        api.el.querySelector('[data-submit]').addEventListener('click', async () => {
          m.clearError();
          if (!selected.size) return m.error('Pilih minimal satu peserta didik.');
          api.setBusy(true, 'Menambahkan…');
          try {
            const res = await C.api('/admin/ec-members/bulk', {
              method: 'POST',
              body: {
                extracurricular_id: ec.id,
                user_ids: [...selected],
                grade_group: api.body.querySelector('#am-group').value || '',
              },
            });
            api.close();
            C.toastOk('Ditambahkan', res.message || 'Anggota ditambahkan.');
            done && done();
          } catch (err) { api.setBusy(false); m.error(err.message); }
        });

        load();
      },
    });
    return m;
  };

  /* ====================================================================== *
   *  PARENT LINKS — which parent account may follow which student
   * ====================================================================== */
  const RELATIONSHIPS = ['Ayah', 'Ibu', 'Wali'];

  function loadParents() {
    return C.api('/admin/users?role=parent&limit=200').then((r) => r.items || []).catch(() => []);
  }
  function loadStudents() {
    return C.api('/admin/users?role=student&limit=300').then((r) => r.items || []).catch(() => []);
  }

  register('parentLinks', {
    title: 'Orang Tua & Peserta Didik',
    sub: 'Hubungkan akun orang tua dengan anak yang diikutinya',
    icon: 'users',
    group: 'Sekolah',

    render(root) {
      this._root = root;
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Orang Tua &amp; Peserta Didik</div>
            <div class="view-sub">Akun orang tua hanya dapat melihat anak yang dihubungkan di sini</div>
          </div>
          <div class="row gap-8">
            <button class="btn" id="pl-parent">${C.icon('plus', 15, 2.4)} Akun Orang Tua</button>
            <button class="btn btn-primary" id="pl-add">${C.icon('link', 16, 2.4)} Hubungkan</button>
          </div>
        </div>
        <div id="pl-stats" class="mb-16"></div>
        <div id="pl-list"></div>`;
      root.querySelector('#pl-add').addEventListener('click', () => this.openForm(() => this.reload()));
      root.querySelector('#pl-parent').addEventListener('click', () => this.openParentForm(() => this.reload()));
      this.load(root);
    },

    reload() {
      if (this._list) this._list.reload();
      else if (this._root) this.load(this._root);
    },

    /* ----------------------------- statistics ----------------------------- */
    renderStats(host, stats) {
      if (!host) return;
      if (!stats || !stats.grades) {
        host.innerHTML = '<div class="stat-grid">'
          + '<div class="stat" style="min-height:96px"></div>'.repeat(4)
          + '</div>';
        return;
      }
      const st = stats || {};
      const grades = st.grades && st.grades.length ? st.grades : [];
      const TONE = { VII: 'brand', VIII: 'violet', IX: 'info' };
      const cards = grades.map((g) => `
        <div class="stat">
          <div class="stat-top">
            <div>
              <div class="stat-val">${C.num(g.students || 0)}</div>
              <div class="stat-lbl">Siswa ${C.esc(g.label)}</div>
            </div>
            <div class="stat-ico badge-${TONE[g.grade] || 'brand'}">${C.icon('users', 18, 2.1)}</div>
          </div>
        </div>`);
      cards.push(`
        <div class="stat">
          <div class="stat-top">
            <div>
              <div class="stat-val">${C.num(st.parents_total || 0)}</div>
              <div class="stat-lbl">Orang Tua / Wali</div>
            </div>
            <div class="stat-ico badge-pink">${C.icon('users', 18, 2.1)}</div>
          </div>
        </div>`);
      const pct = st.students_total
        ? Math.round(((st.students_with_parent || 0) / st.students_total) * 100) : 0;
      host.innerHTML = `
        <div class="stat-grid mb-12">${cards.join('')}</div>
        <div class="kpi-strip">
          <div class="kpi-cell"><div class="kpi-v">${C.num(st.students_total || 0)}</div><div class="kpi-l">Total Peserta Didik</div></div>
          <div class="kpi-cell"><div class="kpi-v" style="color:var(--ok,#15803d)">${C.num(st.students_with_parent || 0)}</div><div class="kpi-l">Sudah Terhubung</div></div>
          <div class="kpi-cell"><div class="kpi-v" style="color:var(--warn,#b45309)">${C.num(st.students_without_parent || 0)}</div><div class="kpi-l">Belum Terhubung</div></div>
          <div class="kpi-cell"><div class="kpi-v">${C.num(st.links_total || 0)}</div><div class="kpi-l">Total Hubungan</div></div>
          <div class="kpi-cell"><div class="kpi-v">${pct}%</div><div class="kpi-l">Cakupan</div></div>
        </div>`;
    },

    /* -------------------------------- table ------------------------------- */
    load(root) {
      const host = root.querySelector('#pl-list');
      if (!host) return;
      const statsHost = root.querySelector('#pl-stats');
      this.renderStats(statsHost, null);

      const self = this;
      this._list = L.createList({
        el: host,
        endpoint: '/admin/parent-links',
        limit: 12,
        search: true,
        searchPlaceholder: 'Cari nama, NIS, kelas, orang tua…',
        filters: [
          {
            name: 'grade',
            placeholder: 'Semua Tingkat',
            options: [
              { value: 'VII', label: 'Kelas VII' },
              { value: 'VIII', label: 'Kelas VIII' },
              { value: 'IX', label: 'Kelas IX' },
            ],
          },
          { name: 'relationship', placeholder: 'Semua Hubungan', options: RELATIONSHIPS },
        ],
        empty: {
          icon: 'link',
          title: 'Belum ada hubungan',
          text: 'Buat akun orang tua terlebih dahulu, lalu hubungkan dengan peserta didik.',
        },
        columns: [
          {
            label: 'Peserta Didik',
            key: 'student',
            render: (r) => `<div class="row gap-10" style="min-width:0">
              ${C.avatarHTML(r.student, '')}
              <div style="min-width:0">
                <div class="semibold ellipsis">${C.esc(r.student ? r.student.name : '-')}</div>
                <div class="text-xs muted mono">${C.esc(r.student ? r.student.id_number || '' : '')}</div>
              </div>
            </div>`,
          },
          {
            label: 'Kelas',
            key: 'class_name',
            width: '110px',
            render: (r) => `<span class="badge badge-brand">${C.esc(r.student ? r.student.class_name || '-' : '-')}</span>`,
          },
          {
            label: 'Orang Tua / Wali',
            key: 'parent',
            render: (r) => `<div style="min-width:0">
              <div class="text-sm semibold ellipsis">${C.esc(r.parent ? r.parent.name : '-')}</div>
              <div class="text-xs muted mono">${C.esc(r.parent ? r.parent.id_number || '' : '')}</div>
            </div>`,
          },
          {
            label: 'Hubungan',
            key: 'relationship',
            width: '110px',
            render: (r) => {
              const rel = r.relationship || 'Wali';
              const tone = rel === 'Ayah' ? 'info' : rel === 'Ibu' ? 'pink' : 'muted';
              return `<span class="badge badge-${tone}">${C.esc(rel)}</span>`;
            },
          },
          {
            label: 'Kontak',
            key: 'phone',
            width: '170px',
            render: (r) => {
              const ph = r.parent ? r.parent.phone : '';
              return ph
                ? `<a class="text-sm mono" href="tel:${C.esc(ph)}">${C.esc(ph)}</a>`
                : '<span class="text-xs muted">—</span>';
            },
          },
        ],
        rowActions: (r) => `
          <button class="icon-btn btn-sm" data-pl-edit="${C.esc(r.id)}" title="Ubah data">${C.icon('edit', 15, 2.2)}</button>
          <button class="icon-btn btn-sm danger" data-pl-del="${C.esc(r.id)}" title="Putuskan hubungan">${C.icon('trash', 15, 2.2)}</button>`,
        onLoaded(data) {
          self.renderStats(statsHost, data && data.stats);
        },
        onRowMount(tr, row) {
          const e = tr.querySelector('[data-pl-edit]');
          if (e) e.addEventListener('click', (ev) => {
            ev.stopPropagation();
            self.openEdit(row, () => self.reload());
          });
          const d = tr.querySelector('[data-pl-del]');
          if (d) d.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const ok = await C.confirmDialog({
              title: 'Putuskan hubungan?',
              text: 'Orang tua tidak lagi dapat mengikuti peserta didik ini.',
              okText: 'Ya, putuskan',
              danger: true,
            });
            if (!ok) return;
            try {
              await self._list.optimistic(row.id,
                () => C.api('/admin/parent-links/' + row.id, { method: 'DELETE' }),
                { remove: true, success: { title: 'Dihapus', text: 'Hubungan diputus.' } });
            } catch (_err) { /* the engine already surfaced the error */ }
          });
        },
      });
      this._list.load();
    },

    /** Link an existing parent account to a student. */
    openForm(done) {
      const m = C.modal({
        title: 'Hubungkan orang tua',
        sub: 'Pilih akun orang tua dan peserta didik',
        body: `
          <div class="form-row">
            <label class="fl">Akun orang tua</label>
            <select class="input" id="pl-f-parent"><option value="">Memuat…</option></select>
          </div>
          <div class="form-row">
            <label class="fl">Peserta didik</label>
            <select class="input" id="pl-f-student"><option value="">Memuat…</option></select>
          </div>
          <div class="form-row">
            <label class="fl">Hubungan</label>
            <select class="input" id="pl-f-rel">
              ${RELATIONSHIPS.map((r) => `<option value="${r}">${r}</option>`).join('')}
            </select>
          </div>`,
        okText: 'Hubungkan',
        onMount(api) {
          Promise.all([loadParents(), loadStudents()]).then(([parents, students]) => {
            const ps = api.body.querySelector('#pl-f-parent');
            const ss = api.body.querySelector('#pl-f-student');
            ps.innerHTML = parents.length
              ? parents.map((p) => `<option value="${C.esc(p.id)}">${C.esc(p.name)} — ${C.esc(p.id_number || '')}</option>`).join('')
              : '<option value="">Belum ada akun orang tua</option>';
            ss.innerHTML = students.length
              ? students.map((s) => `<option value="${C.esc(s.id)}">${C.esc(s.name)} — ${C.esc(s.class_name || s.id_number || '')}</option>`).join('')
              : '<option value="">Belum ada peserta didik</option>';
          });
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            const parent_id = api.body.querySelector('#pl-f-parent').value;
            const student_id = api.body.querySelector('#pl-f-student').value;
            const relationship = api.body.querySelector('#pl-f-rel').value || 'Wali';
            if (!parent_id || !student_id) { api.error('Pilih akun orang tua dan peserta didik.'); return; }
            api.clearError();
            api.setBusy(true, 'Menghubungkan…');
            try {
              const res = await C.api('/admin/parent-links', { method: 'POST', body: { parent_id, student_id, relationship } });
              api.close();
              C.toastOk('Terhubung', res.message || 'Hubungan dibuat.');
              done && done();
            } catch (err) { api.setBusy(false); api.error(err.message); }
          });
        },
      });
      return m;
    },

    /** Edit an existing link — relationships and the parent's own contact data. */
    openEdit(row, done) {
      const m = C.modal({
        title: 'Ubah data orang tua & peserta didik',
        sub: 'Perubahan kontak berlaku pada akun orang tua yang bersangkutan',
        body: `
          <div class="text-xs muted mb-8" style="font-weight:700;letter-spacing:.06em;text-transform:uppercase">Hubungan</div>
          <div class="form-row">
            <label class="fl">Peserta didik</label>
            <select class="input" id="pl-e-student"><option value="">Memuat…</option></select>
          </div>
          <div class="form-row">
            <label class="fl">Akun orang tua</label>
            <select class="input" id="pl-e-parent"><option value="">Memuat…</option></select>
          </div>
          <div class="form-row">
            <label class="fl">Hubungan</label>
            <select class="input" id="pl-e-rel">
              ${RELATIONSHIPS.map((r) => `<option value="${r}">${r}</option>`).join('')}
            </select>
          </div>
          <div class="text-xs muted mb-8 mt-8" style="font-weight:700;letter-spacing:.06em;text-transform:uppercase">Data orang tua</div>
          <div class="form-row">
            <label class="fl">Nama lengkap</label>
            <input class="input" id="pl-e-name" value="${C.esc(row.parent ? row.parent.name : '')}">
          </div>
          <div class="form-row">
            <label class="fl">Nomor telepon</label>
            <input class="input" id="pl-e-phone" placeholder="mis. +62 812 3456 7890" value="${C.esc(row.parent ? row.parent.phone || '' : '')}">
          </div>
          <div class="form-row">
            <label class="fl">Email</label>
            <input class="input" type="email" id="pl-e-email" placeholder="nama@contoh.sch.id" value="${C.esc(row.parent && row.parent.email ? row.parent.email : '')}">
          </div>`,
        okText: 'Simpan perubahan',
        onMount(api) {
          api.body.querySelector('#pl-e-rel').value = row.relationship || 'Wali';
          Promise.all([loadParents(), loadStudents()]).then(([parents, students]) => {
            const ps = api.body.querySelector('#pl-e-parent');
            const ss = api.body.querySelector('#pl-e-student');
            ps.innerHTML = parents.map((p) => `<option value="${C.esc(p.id)}">${C.esc(p.name)} — ${C.esc(p.id_number || '')}</option>`).join('');
            ss.innerHTML = students.map((s) => `<option value="${C.esc(s.id)}">${C.esc(s.name)} — ${C.esc(s.class_name || s.id_number || '')}</option>`).join('');
            if (row.parent_id) ps.value = row.parent_id;
            if (row.student_id) ss.value = row.student_id;
          });
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            const student_id = api.body.querySelector('#pl-e-student').value;
            const parent_id = api.body.querySelector('#pl-e-parent').value;
            const relationship = api.body.querySelector('#pl-e-rel').value;
            const name = api.body.querySelector('#pl-e-name').value.trim();
            const phone = api.body.querySelector('#pl-e-phone').value.trim();
            const email = api.body.querySelector('#pl-e-email').value.trim();
            if (!student_id || !parent_id) { api.error('Pilih akun orang tua dan peserta didik.'); return; }
            if (!name) { api.error('Nama orang tua tidak boleh kosong.'); return; }
            api.clearError();
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = await C.api('/admin/parent-links/' + row.id, {
                method: 'PUT',
                body: { student_id, parent_id, relationship, parent: { name, phone, email } },
              });
              api.close();
              C.toastOk('Tersimpan', res.message || 'Data hubungan diperbarui.');
              done && done();
            } catch (err) { api.setBusy(false); api.error(err.message); }
          });
        },
      });
      return m;
    },

    /** Create a parent account inline — the link comes right after. */
    openParentForm(done) {
      const m = C.modal({
        title: 'Akun orang tua baru',
        sub: 'Akun ini hanya dapat mengikuti anaknya, tidak dapat absensi',
        body: `
          <div class="form-row">
            <label class="fl">Nama lengkap</label>
            <input class="input" id="pl-n-name" placeholder="mis. Budi Santoso">
          </div>
          <div class="form-row">
            <label class="fl">ID / Nomor orang tua</label>
            <input class="input" id="pl-n-id" placeholder="mis. SP1TAP004">
          </div>
          <div class="form-row">
            <label class="fl">Nomor telepon</label>
            <input class="input" id="pl-n-phone" placeholder="mis. +62 812 3456 7890">
          </div>
          <div class="form-row">
            <label class="fl">Email</label>
            <input class="input" type="email" id="pl-n-email" placeholder="nama@sp1yogyakarta.sch.id">
          </div>
          <div class="form-row">
            <label class="fl">Kata sandi</label>
            <input class="input" id="pl-n-pass" value="demo123">
            <div class="text-xs muted mt-4">Dapat diganti orang tua melalui menu Profil.</div>
          </div>`,
        okText: 'Buat akun',
        onMount(api) {
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            const name = api.body.querySelector('#pl-n-name').value.trim();
            const id_number = api.body.querySelector('#pl-n-id').value.trim();
            const phone = api.body.querySelector('#pl-n-phone').value.trim();
            const email = api.body.querySelector('#pl-n-email').value.trim();
            const password = api.body.querySelector('#pl-n-pass').value.trim() || 'demo123';
            if (name.length < 2) { api.error('Nama minimal 2 karakter.'); return; }
            if (!id_number) { api.error('ID orang tua wajib diisi.'); return; }
            api.clearError();
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = await C.api('/admin/users', {
                method: 'POST',
                body: { name, id_number, phone, email, password, role: 'parent', position: 'Wali', status: 'active' },
              });
              api.close();
              C.toastOk('Dibuat', res.message || 'Akun orang tua dibuat.');
              done && done();
            } catch (err) { api.setBusy(false); api.error(err.message); }
          });
        },
      });
      return m;
    },
  });

  global.PagesHelpers = Object.assign({}, H, { register });
})(window);
