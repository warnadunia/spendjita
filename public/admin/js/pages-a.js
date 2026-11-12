/* ==========================================================================
   Admin pages — Dashboard, Users, Attendance
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.Core;
  const L = global.ListEngine;
  const Pages = global.Pages = global.Pages || {};
  Pages.defs = Pages.defs || [];
  function register(key, def) { def.key = key; Pages.defs.push(def); Pages[key] = def; }

  /* ============================== helpers =============================== */
  function userCell(u) {
    return `<div class="row gap-10" style="min-width:0">
      ${C.avatarHTML(u, '')}
      <div style="min-width:0">
        <div class="semibold ellipsis" style="color:var(--ink-900);max-width:210px">${C.esc(u.name)}</div>
        <div class="text-xs muted ellipsis">${C.esc(u.id_number || u.email || '')}</div>
      </div>
    </div>`;
  }
  function statusBadge(s) {
    return `<span class="badge ${C.STATUS_BADGE[s] || 'badge-muted'}"><i class="badge-dot"></i>${C.STATUS_LABEL[s] || s}</span>`;
  }
  function roleBadge(r) {
    return `<span class="badge ${C.ROLE_BADGE[r] || 'badge-muted'}">${C.ROLE_LABEL[r] || r}</span>`;
  }
  function reqStatusBadge(s) {
    return `<span class="badge ${C.REQ_STATUS_BADGE[s] || 'badge-muted'}"><i class="badge-dot"></i>${C.REQ_STATUS_LABEL[s] || s}</span>`;
  }
  function iconBtn(action, name, title, cls) {
    return `<button class="icon-btn btn-sm ${cls || ''}" data-act="${action}" title="${C.esc(title)}" aria-label="${C.esc(title)}">${C.icon(name, 15, 2.2)}</button>`;
  }

  /* ============================== DASHBOARD ============================= */
  register('dashboard', {
    title: 'Dasbor',
    sub: 'Ringkasan kehadiran secara real time',
    icon: 'dashboard',
    group: 'Utama',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Selamat datang kembali 👋</div>
            <div class="view-sub" id="dash-date">Memuat ringkasan hari ini…</div>
          </div>
          <div class="row gap-8 wrap">
            <a class="btn" href="/kiosk" target="_blank" rel="noopener">${C.icon('qr', 16, 2.3)} Buka Kios QR</a>
            <button class="btn btn-primary" id="dash-add-user">${C.icon('plus', 16, 2.4)} Tambah Pengguna</button>
          </div>
        </div>

        <div class="stat-grid" id="dash-stats"></div>

        <div class="grid-2-1 mt-16">
          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">Tren kehadiran 7 hari</div>
                <div class="card-sub">Perbandingan jumlah hadir dengan target warga sekolah</div>
              </div>
              <span class="badge badge-brand" id="trend-badge">7 hari</span>
            </div>
            <div class="card-body"><div class="spark" id="dash-trend"></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Kehadiran per kelas</div></div>
            <div class="card-body" id="dash-classes"></div>
          </div>
        </div>

        <div class="grid-1-2 mt-16">
          <div class="card">
            <div class="card-head"><div class="card-title">Komposisi hari ini</div></div>
            <div class="card-body" id="dash-donut"></div>
          </div>
          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">Aktivitas terbaru</div>
                <div class="card-sub">Diperbarui otomatis setiap 15 detik</div>
              </div>
              <span class="badge badge-ok"><i class="badge-dot"></i>Live</span>
            </div>
            <div class="feed" id="dash-activity"></div>
          </div>
        </div>

        <div class="grid-3 mt-16">
          <div class="card">
            <div class="card-head">
              <div class="card-title">Permohonan menunggu</div>
              <a class="btn btn-sm btn-ghost" href="#/requests">Semua →</a>
            </div>
            <div class="feed" id="dash-requests"></div>
          </div>
          <div class="card">
            <div class="card-head">
              <div class="card-title">Pengumuman terbaru</div>
              <a class="btn btn-sm btn-ghost" href="#/announcements">Semua →</a>
            </div>
            <div class="feed" id="dash-ann"></div>
          </div>
          <div class="card">
            <div class="card-head">
              <div class="card-title">Agenda mendatang</div>
              <a class="btn btn-sm btn-ghost" href="#/calendar">Kalender →</a>
            </div>
            <div class="feed" id="dash-events"></div>
          </div>
        </div>`;

      const addBtn = root.querySelector('#dash-add-user');
      if (addBtn) addBtn.addEventListener('click', () => location.hash = '#/users');

      this.load(root);
      this._timer = setInterval(() => { if (!document.hidden) this.load(root, true); }, 15000);
    },
    unmount() { if (this._timer) clearInterval(this._timer); },
    async load(root, silent) {
      try {
        const d = await C.api('/admin/dashboard', { silent });
        renderDashboard(root, d);
      } catch (err) {
        if (!silent) C.toastErr('Gagal memuat dasbor', err.message);
      }
    },
  });

  function renderDashboard(root, d) {
    const off = C.localOffset();
    const dateEl = root.querySelector('#dash-date');
    if (dateEl) {
      dateEl.innerHTML = `${C.dow(d.date)}, ${C.fmtDate(d.date)} · diperbarui ${C.timeAgo(d.generated_at)}`;
    }

    /* ---- stat cards ---- */
    const c = d.counters || {};
    const stats = [
      { label: 'Sudah absen masuk', value: C.num(c.checked_in), ico: 'attendance', tone: 'brand', sub: `${c.present_rate}% dari warga sekolah` },
      { label: 'Terlambat', value: C.num(c.late), ico: 'clock', tone: 'warn', sub: 'Melewati batas waktu' },
      { label: 'Belum absen', value: C.num(Math.max(0, c.not_checked_in)), ico: 'users', tone: 'ink', sub: 'Perlu ditindaklanjuti' },
      { label: 'Sudah absen pulang', value: C.num(c.checked_out), ico: 'logout', tone: 'ok', sub: 'Selesai hari ini' },
    ];
    const tones = {
      brand: ['var(--brand-50)', 'var(--brand)'],
      warn: ['var(--warn-50)', 'var(--warn)'],
      ok: ['var(--ok-50)', 'var(--ok)'],
      ink: ['var(--ink-100)', 'var(--ink-600)'],
    };
    root.querySelector('#dash-stats').innerHTML = stats.map((s) => {
      const [bg, fg] = tones[s.tone];
      return `<div class="stat">
        <div class="stat-top">
          <div>
            <div class="stat-lbl">${C.esc(s.label)}</div>
            <div class="stat-val mt-8">${s.value}</div>
          </div>
          <div class="stat-ico" style="background:${bg};color:${fg}">${C.icon(s.ico, 20, 2.1)}</div>
        </div>
        <div class="text-xs muted">${C.esc(s.sub)}</div>
      </div>`;
    }).join('');

    /* ---- trend chart ---- */
    const trend = d.trend || [];
    const maxRate = Math.max(60, ...trend.map((t) => t.rate));
    root.querySelector('#dash-trend').innerHTML = trend.map((t) => {
      const h = Math.max(4, Math.round((t.rate / maxRate) * 100));
      const isToday = t.date === d.date;
      return `<div class="spark-col">
        <div class="spark-bar-wrap">
          <div class="spark-bar ${isToday ? 'is-today' : ''}" style="height:${h}%"
               data-tip="${C.dowShort(t.date)} · ${t.present} hadir · ${t.rate}%"></div>
        </div>
        <div class="spark-pct">${t.rate}%</div>
        <div class="spark-lbl">${C.dowShort(t.date)}</div>
      </div>`;
    }).join('');

    /* ---- per class ---- */
    const classes = d.classes || [];
    root.querySelector('#dash-classes').innerHTML = classes.length
      ? classes.map((cl) => {
        const pct = cl.total ? Math.round((cl.present / cl.total) * 100) : 0;
        const color = pct >= 90 ? 'var(--ok)' : pct >= 75 ? 'var(--accent)' : 'var(--danger)';
        return `<div class="rank-row">
          <div class="rank-name">${C.esc(cl.name)}</div>
          <div class="rank-bar"><div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>
          <div class="rank-val">${cl.present}/${cl.total}</div>
        </div>`;
      }).join('')
      : C.emptyRow(1, { icon: 'school', title: 'Belum ada data kelas', text: 'Data kehadiran per kelas muncul setelah ada absensi masuk.' });

    /* ---- donut ---- */
    const roles = d.by_role || [];
    const totalPresent = roles.reduce((s, r) => s + r.present, 0);
    const totalPool = roles.reduce((s, r) => s + r.total, 0) || 1;
    const pct = Math.round((totalPresent / totalPool) * 100);
    const R = 52, CIRC = 2 * Math.PI * R;
    const dash = (CIRC * pct) / 100;
    root.querySelector('#dash-donut').innerHTML = `
      <div class="donut-wrap">
        <div class="donut">
          <svg width="132" height="132" viewBox="0 0 132 132">
            <circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--ink-200)" stroke-width="14"/>
            <circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--brand)" stroke-width="14"
              stroke-linecap="round" stroke-dasharray="${dash} ${CIRC}"/>
          </svg>
          <div class="donut-c">
            <div>
              <div style="font-size:1.5rem;font-weight:800;letter-spacing:-.03em">${pct}%</div>
              <div class="text-xs muted">kehadiran</div>
            </div>
          </div>
        </div>
        <div class="donut-legend">
          ${roles.map((r) => `<div class="lg-item">
            <span class="lg-dot" style="background:${r.role === 'teacher' ? 'var(--info)' : r.role === 'student' ? 'var(--brand)' : 'var(--ok)'}"></span>
            <span class="grow">${C.esc(r.label)}</span>
            <span class="semibold">${r.present}/${r.total}</span>
          </div>`).join('')}
          <div class="lg-item" style="border-top:1px solid var(--ink-200);padding-top:8px;margin-top:2px">
            <span class="lg-dot" style="background:var(--ink-300)"></span>
            <span class="grow muted">Tidak hadir</span>
            <span class="semibold">${Math.max(0, totalPool - totalPresent)}</span>
          </div>
        </div>
      </div>`;

    /* ---- activity feed ---- */
    const acts = d.activity || [];
    root.querySelector('#dash-activity').innerHTML = acts.length
      ? acts.map((a) => {
        const map = {
          CHECK_IN: ['ok', 'attendance', 'Absen masuk'],
          CHECK_OUT: ['info', 'logout', 'Absen pulang'],
          LOGIN: ['brand', 'lock', 'Masuk aplikasi'],
          REQUEST_CREATE: ['warn', 'requests', 'Permohonan baru'],
          REQUEST_REVIEW: ['violet', 'check', 'Tinjauan permohonan'],
          EC_ATTEND: ['pink', 'star', 'Ekstrakurikuler'],
          USER_CREATE: ['info', 'users', 'Pengguna baru'],
          ANNOUNCEMENT_CREATE: ['warn', 'megaphone', 'Pengumuman'],
          NEWS_CREATE: ['info', 'news', 'Berita baru'],
          PASSWORD_RESET: ['danger', 'lock', 'Reset kata sandi'],
        };
        const [tone, ico, label] = map[a.action] || ['muted', 'activity', a.action];
        const toneBg = { ok: 'var(--ok-50);color:var(--ok)', info: 'var(--info-50);color:var(--info)', warn: 'var(--warn-50);color:var(--warn)', brand: 'var(--brand-50);color:var(--brand)', violet: 'var(--violet-50);color:var(--violet)', pink: 'var(--pink-50);color:var(--pink)', danger: 'var(--danger-50);color:var(--danger)', muted: 'var(--ink-100);color:var(--ink-500)' }[tone];
        return `<div class="feed-item">
          <div class="feed-ico" style="background:${toneBg}">${C.icon(ico, 16, 2.2)}</div>
          <div class="feed-main">
            <div class="feed-title">${C.esc(a.target || a.actor)} <span class="muted medium" style="font-weight:500">· ${label}</span></div>
            <div class="feed-meta"><span>${C.esc(a.detail || '')}</span><span>·</span><span>${C.timeAgo(a.at)}</span></div>
          </div>
        </div>`;
      }).join('')
      : C.emptyRow(1, { icon: 'activity', title: 'Belum ada aktivitas', text: 'Aktivitas absensi akan muncul di sini secara real time.' });

    /* ---- pending requests ---- */
    const reqs = d.pending_requests || [];
    root.querySelector('#dash-requests').innerHTML = reqs.length
      ? reqs.map((r) => `<div class="feed-item">
          <div class="feed-ico" style="background:var(--warn-50);color:var(--warn)">${C.icon('requests', 16, 2.2)}</div>
          <div class="feed-main">
            <div class="feed-title">${C.esc(r.user_name)}</div>
            <div class="feed-meta">
              <span class="badge ${C.REQ_TYPE_BADGE[r.type] || 'badge-muted'}">${C.esc(r.type)}</span>
              <span>${C.fmtDate(r.from_date, { short: true })}</span>
            </div>
            <div class="feed-text">${C.esc(r.title)}</div>
          </div>
        </div>`).join('')
      : C.emptyRow(1, { icon: 'check', title: 'Tidak ada yang menunggu', text: 'Semua permohonan sudah ditinjau. Kerja bagus!' });

    /* ---- announcements ---- */
    const anns = d.announcements || [];
    root.querySelector('#dash-ann').innerHTML = anns.length
      ? anns.map((a) => `<div class="feed-item">
          <div class="feed-ico" style="background:var(--brand-50);color:var(--brand)">${C.icon('megaphone', 16, 2.2)}</div>
          <div class="feed-main">
            <div class="feed-title">${a.is_pinned ? '<span class="ann-pin">📌 </span>' : ''}${C.esc(a.title)}</div>
            <div class="feed-meta"><span>${C.fmtDate(a.date, { short: true })}</span><span>·</span><span>${C.esc(a.location || '—')}</span></div>
          </div>
        </div>`).join('')
      : C.emptyRow(1, { icon: 'megaphone', title: 'Belum ada pengumuman', text: 'Buat pengumuman pertama untuk warga sekolah.' });

    /* ---- upcoming events ---- */
    const evs = d.upcoming || [];
    root.querySelector('#dash-events').innerHTML = evs.length
      ? evs.map((e) => {
        const tone = { academic: 'badge-brand', exam: 'badge-danger', holiday: 'badge-ok', meeting: 'badge-warn' }[e.type] || 'badge-muted';
        return `<div class="feed-item">
          <div class="feed-ico" style="background:var(--violet-50);color:var(--violet)">${C.icon('calendar', 16, 2.2)}</div>
          <div class="feed-main">
            <div class="feed-title">${C.esc(e.title)}</div>
            <div class="feed-meta">
              <span class="badge ${tone}">${C.esc(e.type)}</span>
              <span>${C.fmtDate(e.date, { short: true })}${e.end_date && e.end_date !== e.date ? ' – ' + C.fmtDate(e.end_date, { short: true }) : ''}</span>
            </div>
          </div>
        </div>`;
      }).join('')
      : C.emptyRow(1, { icon: 'calendar', title: 'Tidak ada agenda', text: 'Tambahkan acara ke kalender akademik.' });
  }

  /* ================================ USERS =============================== */
  register('users', {
    title: 'Manajemen Pengguna',
    sub: 'Guru, peserta didik dan karyawan',
    icon: 'users',
    group: 'Sekolah',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Pengguna</div>
            <div class="view-sub">Kelola akun guru, peserta didik dan karyawan</div>
          </div>
        </div>
        <div id="users-list"></div>`;

      const list = L.createList({
        el: root.querySelector('#users-list'),
        endpoint: '/admin/users',
        limit: 25,
        search: true,
        searchPlaceholder: 'Cari nama, ID, email…',
        pollMs: 0,
        filters: [
          { name: 'role', label: 'Role', placeholder: 'Semua role', options: [
            { value: 'teacher', label: 'Guru' },
            { value: 'student', label: 'Peserta Didik' },
            { value: 'employee', label: 'Karyawan' },
            { value: 'admin', label: 'Administrator' },
          ] },
          { name: 'status', label: 'Status', placeholder: 'Semua status', options: [
            { value: 'active', label: 'Aktif' },
            { value: 'inactive', label: 'Nonaktif' },
          ] },
        ],
        columns: [
          { label: 'Nama', key: 'name', render: (u) => userCell(u) },
          { label: 'Role', key: 'role', width: '120px', render: (u) => roleBadge(u.role) },
          { label: 'Kelas / Mata Pelajaran', key: 'class_name', render: (u) => `<span class="text-sm">${C.esc(u.class_name || u.subject || u.position || '—')}</span>` },
          { label: 'Kontak', key: 'email', render: (u) => `<div class="text-sm">
              <div class="ellipsis" style="max-width:190px">${C.esc(u.email || '—')}</div>
              <div class="muted text-xs">${C.esc(u.phone || '')}</div>
            </div>` },
          { label: 'Poin', key: 'score_points', width: '92px', align: 'right', render: (u) => `<b>${C.num(u.score_points)}</b>` },
          { label: 'Status', key: 'status', width: '104px', render: (u) => u.status === 'active'
            ? '<span class="badge badge-ok"><i class="badge-dot"></i>Aktif</span>'
            : '<span class="badge badge-muted"><i class="badge-dot"></i>Nonaktif</span>' },
        ],
        rowActions: (u) => `
          ${iconBtn('edit', 'edit', 'Ubah data')}
          ${iconBtn('detail', 'eye', 'Lihat detail')}
          ${u.role !== 'admin' ? iconBtn('delete', 'trash', 'Hapus') : ''}`,
        onCreate: () => this.openForm(null, list),
        createLabel: 'Tambah Pengguna',
        onRowClick: (u) => this.openDetail(u, list),
        empty: { icon: 'users', title: 'Belum ada pengguna', text: 'Tambahkan guru, peserta didik atau karyawan untuk mulai mengelola absensi.' },
      });

      root.querySelector('#users-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const id = tr && tr.dataset.id;
        const user = (list.state.data.items || []).find((u) => u.id === id);
        if (!user) return;
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'edit') this.openForm(user, list);
        if (act === 'detail') this.openDetail(user, list);
        if (act === 'delete') this.remove(user, list);
      });

      list.load();
    },

    openForm(user, list) {
      const isEdit = !!user;
      const roleOpts = ['teacher', 'student', 'employee', 'admin'].map((r) =>
        `<option value="${r}" ${user && user.role === r ? 'selected' : ''}>${C.ROLE_LABEL[r]}</option>`).join('');
      const m = C.modal({
        title: isEdit ? 'Ubah Pengguna' : 'Tambah Pengguna',
        sub: isEdit ? user.name : 'Akun baru akan langsung dapat login',
        wide: true,
        okText: isEdit ? 'Simpan Perubahan' : 'Tambahkan',
        body: `
          <div class="form-grid">
            <div class="field span-2">
              <label class="label">Nama lengkap <span class="req">*</span></label>
              <input class="input" name="name" data-autofocus placeholder="mis. Dra. Sugiarti, M.Pd" value="${C.esc(user ? user.name : '')}">
            </div>
            <div class="field">
              <label class="label">ID Pengguna <span class="req">*</span></label>
              <input class="input" name="id_number" placeholder="mis. SP1TAT001" value="${C.esc(user ? user.id_number : '')}">
              <span class="hint">Digunakan untuk login bersama kata sandi</span>
            </div>
            <div class="field">
              <label class="label">Role <span class="req">*</span></label>
              <select class="select" name="role">${roleOpts}</select>
            </div>
            <div class="field">
              <label class="label">Email</label>
              <input class="input" type="email" name="email" placeholder="nama@sp1yogyakarta.sch.id" value="${C.esc(user ? user.email : '')}">
            </div>
            <div class="field">
              <label class="label">Nomor telepon</label>
              <input class="input" name="phone" placeholder="+62 8xx xxxx xxxx" value="${C.esc(user ? user.phone : '')}">
            </div>
            <div class="field" data-only="student">
              <label class="label">Kelas</label>
              <input class="input" name="class_name" placeholder="mis. X-A" value="${C.esc(user ? user.class_name : '')}">
            </div>
            <div class="field" data-only="teacher">
              <label class="label">Mata pelajaran</label>
              <input class="input" name="subject" placeholder="mis. Matematika" value="${C.esc(user ? user.subject : '')}">
            </div>
            <div class="field span-2">
              <label class="label">Jabatan</label>
              <input class="input" name="position" placeholder="mis. Wakil Kepala Urusan Kurikulum" value="${C.esc(user ? user.position : '')}">
            </div>
            <div class="field">
              <label class="label">Jenis kelamin</label>
              <select class="select" name="gender">
                <option value="">—</option>
                <option value="L" ${user && user.gender === 'L' ? 'selected' : ''}>Laki-laki</option>
                <option value="P" ${user && user.gender === 'P' ? 'selected' : ''}>Perempuan</option>
              </select>
            </div>
            <div class="field">
              <label class="label">Status</label>
              <select class="select" name="status">
                <option value="active" ${!user || user.status === 'active' ? 'selected' : ''}>Aktif</option>
                <option value="inactive" ${user && user.status === 'inactive' ? 'selected' : ''}>Nonaktif</option>
              </select>
            </div>
            <div class="field span-2">
              <label class="label">${isEdit ? 'Kata sandi baru (opsional)' : 'Kata sandi'}</label>
              <input class="input" type="text" name="password" placeholder="${isEdit ? 'Biarkan kosong bila tidak diubah' : 'minimal 6 karakter'}" value="">
            </div>
          </div>
          ${isEdit ? `<div id="u-ec" style="margin-top:16px">
            <div class="semibold text-sm mb-8" style="margin-bottom:8px">Ekstrakurikuler &amp; penugasan</div>
            <div class="hint">Memuat…</div>
          </div>` : ''}`,
        onMount(api) {
          if (isEdit) {
            C.api('/admin/users/' + user.id + '/extracurriculars').then((d) => {
              const host = api.el.querySelector('#u-ec');
              if (!host) return;
              const rows = d.items || [];
              host.innerHTML = `<div class="semibold text-sm mb-8" style="margin-bottom:8px">Ekstrakurikuler &amp; penugasan</div>` + (rows.length
                ? rows.map((e) => `
                  <div class="row between gap-8" style="padding:9px 12px;background:var(--ink-50);border-radius:11px;margin-bottom:6px">
                    <div class="grow" style="min-width:0">
                      <div class="text-sm semibold ellipsis">${C.esc(e.name)}</div>
                      <div class="text-xs muted">${(e.schedule_days || []).join(', ') || 'Belum ada jadwal'}</div>
                    </div>
                    <div class="row gap-6">
                      ${e.grade_group ? `<span class="badge badge-violet">${C.esc(e.grade_group)}</span>` : ''}
                      ${e.as_mentor ? `<span class="badge badge-brand">${C.esc(e.mentor_role || 'Pembina')}</span>` : '<span class="badge badge-muted">Anggota</span>'}
                    </div>
                  </div>`).join('')
                : `<div class="hint">Belum terdaftar pada ekstrakurikuler dan belum ditugaskan sebagai pembina.
                   Tambahkan melalui halaman <b>Ekstrakurikuler</b> → <b>Anggota</b> atau <b>Pembina</b>.</div>`);
            }).catch(() => { const h = api.el.querySelector('#u-ec'); if (h) h.innerHTML = '<div class="hint">Tidak dapat memuat data ekstrakurikuler.</div>'; });
          }
          const sel = api.el.querySelector('[name="role"]');
          function sync() {
            const r = sel.value;
            api.el.querySelectorAll('[data-only]').forEach((el) => {
              el.style.display = el.dataset.only === r ? '' : 'none';
            });
          }
          sel.addEventListener('change', sync);
          sync();
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', submit);
          async function submit() {
            m.clearError();
            const v = C.formValues(api.body);
            if (!v.name || v.name.trim().length < 2) return m.error('Nama lengkap minimal 2 karakter.');
            if (!v.id_number || !v.id_number.trim()) return m.error('ID pengguna wajib diisi.');
            if (!isEdit && (!v.password || v.password.length < 6)) return m.error('Kata sandi minimal 6 karakter.');
            if (isEdit && v.password === '') delete v.password;
            api.setBusy(true, isEdit ? 'Menyimpan…' : 'Menambahkan…');
            try {
              const res = isEdit
                ? await C.api('/admin/users/' + user.id, { method: 'PUT', body: v })
                : await C.api('/admin/users', { method: 'POST', body: v });
              api.close();
              C.toastOk(isEdit ? 'Perubahan disimpan' : 'Pengguna ditambahkan', res.message || `${v.name} berhasil ${isEdit ? 'diperbarui' : 'ditambahkan'}.`);
              // A long list sorts by name, so the new row may be off-page —
              // filter to it so the result of the action is visible at once.
              if (isEdit) list.load();
              else list.setQuery(v.id_number);
            } catch (err) {
              api.setBusy(false);
              m.error(err.message);
            }
          }
        },
      });
      return m;
    },

    async remove(user, list) {
      const ok = await C.confirmDialog({
        title: 'Hapus pengguna?',
        text: `Pengguna "${user.name}" akan dihapus permanen beserta riwayat kehadirannya. Tindakan ini tidak dapat dibatalkan.`,
        okText: 'Ya, hapus',
        danger: true,
      });
      if (!ok) return;
      list.optimistic(user.id, () => C.api('/admin/users/' + user.id, { method: 'DELETE' }), {
        remove: true,
        success: { title: 'Pengguna dihapus', text: `${user.name} telah dihapus dari sistem.` },
      }).catch(() => {});
    },

    async openDetail(user, list) {
      C.modal({
        title: user.name,
        sub: `${C.ROLE_LABEL[user.role]} · ${user.id_number || '—'}`,
        wide: true,
        footer: `<button class="btn" data-cancel>Tutup</button>
                 <button class="btn btn-primary" data-edit>${C.icon('edit', 15, 2.3)} Ubah data</button>`,
        body: `<div class="empty" style="padding:40px"><span class="spinner" style="color:var(--brand);width:26px;height:26px"></span></div>`,
        onMount(api) {
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-edit]').addEventListener('click', () => {
            api.close();
            Pages.users.openForm(user, list);
          });
          C.api('/admin/users/' + user.id).then((d) => {
            const u = d.user;
            api.body.innerHTML = `
              <div class="row gap-16 mb-16 wrap">
                ${C.avatarHTML(u, 'avatar-xl')}
                <div class="grow" style="min-width:180px">
                  <div style="font-size:1.1rem;font-weight:800">${C.esc(u.name)}</div>
                  <div class="row gap-8 wrap mt-4">
                    ${roleBadge(u.role)}
                    <span class="badge ${u.status === 'active' ? 'badge-ok' : 'badge-muted'}">${u.status === 'active' ? 'Aktif' : 'Nonaktif'}</span>
                    <span class="badge badge-brand">${C.icon('award', 11, 2.6)} ${C.num(u.score_points)} poin</span>
                  </div>
                </div>
              </div>
              <dl class="kv">
                <dt>ID Pengguna</dt><dd class="mono">${C.esc(u.id_number || '—')}</dd>
                <dt>Email</dt><dd>${C.esc(u.email || '—')}</dd>
                <dt>Telepon</dt><dd>${C.esc(u.phone || '—')}</dd>
                <dt>Kelas</dt><dd>${C.esc(u.class_name || '—')}</dd>
                <dt>Mata pelajaran</dt><dd>${C.esc(u.subject || '—')}</dd>
                <dt>Jabatan</dt><dd>${C.esc(u.position || '—')}</dd>
                <dt>Wali</dt><dd>${C.esc(u.guardian || '—')} ${u.guardian_phone ? '· ' + C.esc(u.guardian_phone) : ''}</dd>
                <dt>Alamat</dt><dd>${C.esc(u.home_address || '—')}</dd>
              </dl>
              <div class="divider"></div>
              <div class="card-title mb-8">Riwayat kehadiran terakhir</div>
              ${d.attendance.length ? `<table class="data"><thead><tr><th>Tanggal</th><th>Masuk</th><th>Pulang</th><th>Status</th></tr></thead><tbody>
                ${d.attendance.slice(0, 8).map((a) => `<tr>
                  <td>${C.fmtDate(a.date, { short: true })}</td>
                  <td>${a.check_in_at ? C.fmtTime(a.check_in_at, C.localOffset()) : '—'}</td>
                  <td>${a.check_out_at ? C.fmtTime(a.check_out_at, C.localOffset()) : '—'}</td>
                  <td>${statusBadge(a.status)}</td>
                </tr>`).join('')}
              </tbody></table>` : '<div class="muted text-sm">Belum ada riwayat kehadiran.</div>'}
              ${d.requests.length ? `<div class="card-title mt-16 mb-8">Permohonan terakhir</div>
                ${d.requests.slice(0, 5).map((r) => `<div class="row between gap-8" style="padding:7px 0;border-bottom:1px solid var(--ink-100)">
                  <div><div class="semibold text-sm">${C.esc(r.title)}</div><div class="text-xs muted">${C.fmtDate(r.from_date, { short: true })} · ${C.esc(r.type)}</div></div>
                  ${reqStatusBadge(r.status)}
                </div>`).join('')}` : ''}`;
          }).catch((err) => { api.body.innerHTML = `<div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div>`; });
        },
      });
    },
  });

  /* ============================== ATTENDANCE =========================== */
  register('attendance', {
    title: 'Data Kehadiran',
    sub: 'Rekam absensi masuk dan pulang',
    icon: 'attendance',
    group: 'Sekolah',
    render(root) {
      const today = C.todayStr();
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Kehadiran</div>
            <div class="view-sub">Seluruh rekam absensi masuk dan pulang warga sekolah</div>
          </div>
          <div class="row gap-8 wrap">
            <a class="btn" href="/api/admin/reports/export.csv?from=${C.addDays(today, -30)}&to=${today}" download>
              ${C.icon('download', 16, 2.3)} Unduh CSV
            </a>
          </div>
        </div>
        <div class="kpi-strip mb-16" id="att-kpi"></div>
        <div id="att-list"></div>`;

      const list = L.createList({
        el: root.querySelector('#att-list'),
        endpoint: '/admin/attendance',
        limit: 25,
        search: true,
        searchPlaceholder: 'Cari nama, ID, kelas…',
        pollMs: 30000,
        filters: [
          { name: 'role', label: 'Role', placeholder: 'Semua role', options: [
            { value: 'teacher', label: 'Guru' }, { value: 'student', label: 'Peserta Didik' }, { value: 'employee', label: 'Karyawan' }] },
          { name: 'status', label: 'Status', placeholder: 'Semua status', options: [
            { value: 'present', label: 'Hadir' }, { value: 'late', label: 'Terlambat' }, { value: 'absent', label: 'Tidak Hadir' }, { value: 'leave', label: 'Izin' }] },
          { name: 'from', label: 'Dari', type: 'date', value: C.addDays(today, -7) },
          { name: 'to', label: 'Sampai', type: 'date', value: today },
        ],
        onLoaded: (d) => {
          const s = d.stats || {};
          root.querySelector('#att-kpi').innerHTML = [
            ['Rekaman', C.num(d.total), 'var(--brand)'],
            ['Hadir', C.num(s.present), 'var(--ok)'],
            ['Terlambat', C.num(s.late), 'var(--warn)'],
            ['Tingkat kehadiran', (s.rate || 0) + '%', 'var(--info)'],
            ['Rata-rata jam kerja', (s.avg_work_hours || 0) + ' j', 'var(--violet)'],
          ].map(([l, v, c]) => `<div class="kpi-cell"><div class="kpi-v" style="color:${c}">${v}</div><div class="kpi-l">${l}</div></div>`).join('');
        },
        columns: [
          { label: 'Tanggal', key: 'date', width: '112px', render: (a) => `<div>
              <div class="semibold">${C.fmtDate(a.date, { short: true })}</div>
              <div class="text-xs muted">${C.dowShort(a.date)}</div></div>` },
          { label: 'Nama', key: 'user_name', render: (a) => userCell({ name: a.user_name, id_number: a.id_number, avatar: '' }) },
          { label: 'Role', key: 'role', width: '112px', render: (a) => roleBadge(a.role) },
          { label: 'Kelas', key: 'class_name', width: '86px', render: (a) => C.esc(a.class_name || '—') },
          { label: 'Masuk', key: 'check_in_at', width: '104px', render: (a) => `<div>
              <div class="semibold">${a.check_in_at ? C.fmtTime(a.check_in_at, C.localOffset()) : '—'}</div>
              <div class="text-xs muted">${(a.check_in_method || '').toUpperCase()}${a.check_in_dist ? ' · ' + Math.round(a.check_in_dist) + ' m' : ''}</div></div>` },
          { label: 'Pulang', key: 'check_out_at', width: '104px', render: (a) => `<div>
              <div class="semibold">${a.check_out_at ? C.fmtTime(a.check_out_at, C.localOffset()) : '<span class="dim">belum</span>'}</div>
              <div class="text-xs muted">${a.work_hours ? a.work_hours + ' jam' : ''}</div></div>` },
          { label: 'Status', key: 'status', width: '118px', render: (a) => statusBadge(a.status) },
        ],
        rowActions: (a) => `${iconBtn('edit', 'edit', 'Ubah')} ${iconBtn('delete', 'trash', 'Hapus')}`,
        onCreate: () => this.openManual(list),
        createLabel: 'Input Manual',
        empty: { icon: 'attendance', title: 'Tidak ada data kehadiran', text: 'Ubah rentang tanggal atau filter untuk melihat data lainnya.' },
      });

      root.querySelector('#att-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const rec = (list.state.data.items || []).find((r) => r.id === tr.dataset.id);
        if (!rec) return;
        if (btn.dataset.act === 'edit') this.openEdit(rec, list);
        if (btn.dataset.act === 'delete') this.remove(rec, list);
      });

      list.load();
    },

    async openManual(list) {
      const users = await C.api('/admin/users?limit=200');
      const opts = users.items.map((u) => `<option value="${u.id}">${C.esc(u.name)} — ${u.id_number}</option>`).join('');
      const m = C.modal({
        title: 'Input kehadiran manual',
        sub: 'Untuk kondisi darurat atau koreksi data',
        narrow: true,
        okText: 'Simpan',
        body: `
          <div class="field mb-12">
            <label class="label">Pengguna <span class="req">*</span></label>
            <select class="select" name="user_id" data-autofocus>${opts}</select>
          </div>
          <div class="field mb-12">
            <label class="label">Tanggal</label>
            <input class="input" type="date" name="date" value="${C.todayStr()}">
          </div>
          <div class="field">
            <label class="label">Catatan</label>
            <input class="input" name="note" placeholder="opsional">
          </div>`,
        onMount(api) {
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = C.formValues(api.body);
            if (!v.user_id) return m.error('Pilih pengguna terlebih dahulu.');
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = await C.api('/admin/attendance', { method: 'POST', body: v });
              api.close();
              C.toastOk('Kehadiran dicatat', res.message);
              list.load();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      return m;
    },

    openEdit(rec, list) {
      const m = C.modal({
        title: 'Ubah rekam kehadiran',
        sub: `${rec.user_name} · ${C.fmtDate(rec.date)}`,
        narrow: true,
        okText: 'Simpan',
        body: `
          <div class="field mb-12">
            <label class="label">Status</label>
            <select class="select" name="status" data-autofocus>
              ${['present', 'late', 'absent', 'leave'].map((s) => `<option value="${s}" ${rec.status === s ? 'selected' : ''}>${C.STATUS_LABEL[s]}</option>`).join('')}
            </select>
          </div>
          <div class="field mb-12">
            <label class="label">Jam pulang</label>
            <input class="input" type="datetime-local" name="check_out_at" value="${rec.check_out_at ? rec.check_out_at.slice(0, 16) : ''}">
            <span class="hint">Kosongkan bila belum absen pulang</span>
          </div>
          <div class="field">
            <label class="label">Catatan</label>
            <input class="input" name="note" value="${C.esc(rec.note || '')}">
          </div>`,
        onMount(api) {
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = C.formValues(api.body);
            if (v.check_out_at) v.check_out_at = new Date(v.check_out_at).toISOString();
            else delete v.check_out_at;
            api.setBusy(true, 'Menyimpan…');
            try {
              await C.api('/admin/attendance/' + rec.id, { method: 'PUT', body: v });
              api.close();
              C.toastOk('Disimpan', 'Rekam kehadiran diperbarui.');
              list.load();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      return m;
    },

    async remove(rec, list) {
      const ok = await C.confirmDialog({
        title: 'Hapus rekam kehadiran?',
        text: `Rekam kehadiran ${rec.user_name} pada ${C.fmtDate(rec.date)} akan dihapus.`,
        okText: 'Ya, hapus', danger: true,
      });
      if (!ok) return;
      list.optimistic(rec.id, () => C.api('/admin/attendance/' + rec.id, { method: 'DELETE' }), {
        remove: true, success: { title: 'Dihapus', text: 'Rekam kehadiran berhasil dihapus.' },
      }).catch(() => {});
    },
  });

  global.PagesHelpers = { userCell, statusBadge, roleBadge, reqStatusBadge, iconBtn, register };
})(window);
