/* ==========================================================================
   Mobile PWA — parent mode
   --------------------------------------------------------------------------
   A parent account (role `parent`) never records anything: it follows its
   own children. This module owns the whole shell for that role — header,
   bottom nav and pages — so the student/teacher app stays untouched.

   Everything shown comes from /api/parent/*, which is scoped server-side to
   the children the account is linked to.
   ========================================================================== */
(function (global) {
  'use strict';
  const M = global.MCore;
  const { icon, esc, api, store, toast, sheet } = M;

  const P = global.MParent = {};

  /** Bottom bar for a parent: four real sections, no centre action button. */
  const NAV = [
    { key: 'phome', label: 'Beranda', icon: 'home' },
    { key: 'pschool', label: 'Sekolah', icon: 'attendance' },
    { key: 'pec', label: 'Ekskul', icon: 'star' },
    { key: 'pletters', label: 'Surat', icon: 'requests' },
  ];

  const PAGES = {};
  let current = 'phome';
  let children = [];
  let activeId = '';
  let overview = null;
  let bound = false;

  /* ------------------------------ helpers ------------------------------ */

  function kids() { return Array.isArray(children) ? children : []; }

  function activeChild() {
    return kids().find((c) => c.id === activeId) || kids()[0] || null;
  }

  const STATUS_BADGE = {
    present: 'badge-ok', late: 'badge-warn', absent: 'badge-muted', leave: 'badge-brand',
  };

  function statusBadge(s) {
    return `<span class="badge ${STATUS_BADGE[s] || 'badge-muted'}"><i class="badge-dot"></i>${esc(M.STATUS_LABEL[s] || s || '-')}</span>`;
  }

  function clock(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const off = M.offsetMinutes();
    return new Date(d.getTime() + off * 60000).toISOString().slice(11, 16);
  }

  function dateLabel(iso) {
    if (!iso) return '—';
    const parts = String(iso).split('-');
    if (parts.length !== 3) return String(iso);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1] || ''} ${parts[0]}`;
  }

  /** Big status card: where the child is right now. */
  function todayCard(o) {
    if (!o) return '';
    const t = o.today || {};
    const st = o.student || {};
    const inAt = clock(t.check_in_at);
    const outAt = t.check_out_at ? clock(t.check_out_at) : '';
    const inSchool = t.at_school;
    const mood = inSchool ? 'ok' : (t.has_record ? 'muted' : 'warn');
    const headline = inSchool
      ? 'Sedang di sekolah'
      : (t.has_record ? (outAt ? 'Sudah pulang' : 'Belum tercatat') : 'Belum ada absensi hari ini');

    return `
      <div class="card slide-up" style="overflow:hidden">
        <div class="card-body" style="padding:0">
          <div class="p-today ${mood}">
            <div class="p-today-top">
              <div style="min-width:0">
                <div class="p-today-name">${esc(st.name || '')}</div>
                <div class="p-today-meta">${esc([st.class_name, st.id_number].filter(Boolean).join(' · '))}</div>
              </div>
              <div class="p-today-av">${M.avatarHTML(st, '')}</div>
            </div>
            <div class="p-today-state">${esc(headline)}</div>
            <div class="p-today-row">
              <div class="p-clock">
                <span class="p-clock-lbl">Masuk</span>
                <span class="p-clock-val ${t.check_in_at ? '' : 'is-empty'}">${esc(inAt)}</span>
              </div>
              <div class="p-clock-sep">→</div>
              <div class="p-clock">
                <span class="p-clock-lbl">Pulang</span>
                <span class="p-clock-val ${outAt ? '' : 'is-empty'}">${esc(outAt || '—')}</span>
              </div>
              <div style="margin-left:auto">${statusBadge(t.status)}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /** The switcher shown when a parent follows more than one child. */
  function switcher() {
    if (kids().length < 2) return '';
    return `
      <div class="p-switch" id="p-switch">
        ${kids().map((c) => `
          <button class="p-chip ${c.id === activeId ? 'is-active' : ''}" data-pkid="${esc(c.id)}">
            ${M.avatarHTML(c, 'p-chip-av')}
            <span class="p-chip-n">${esc(String(c.name || '').split(' ')[0])}</span>
            <span class="p-chip-s ${c.today && c.today.at_school ? 'is-in' : ''}"></span>
          </button>`).join('')}
      </div>`;
  }

  function sectionHead(title, sub, moreKey, moreLabel) {
    return `
      <div class="row between mb-8" style="margin-top:18px">
        <div style="min-width:0">
          <div class="semibold text-sm">${esc(title)}</div>
          ${sub ? `<div class="text-xs muted">${esc(sub)}</div>` : ''}
        </div>
        ${moreKey ? `<button class="more" data-pgo="${moreKey}">${esc(moreLabel || 'Lihat semua')} →</button>` : ''}
      </div>`;
  }

  /* -------------------------------- shell ------------------------------- */

  function renderNav() {
    const host = document.getElementById('m-nav');
    if (!host) return;
    host.innerHTML = `
      <div class="fnb fnb-4">
        ${NAV.map((n) => `
          <button class="fnb-item" data-pgo="${n.key}">
            <span class="fnb-ico">${icon(n.icon, 21, 2.1)}</span>
            <span>${esc(n.label)}</span>
          </button>`).join('')}
      </div>`;
    highlight();
  }

  function highlight() {
    document.querySelectorAll('[data-pgo]').forEach((b) => {
      if (NAV.some((n) => n.key === b.dataset.pgo)) b.classList.toggle('is-active', b.dataset.pgo === current);
    });
  }

  function renderHeader() {
    const u = store.data.user || {};
    const off = M.offsetMinutes();
    const d = new Date(Date.now() + off * 60000);
    const hour = d.getUTCHours();
    const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
    const head = document.getElementById('m-head');
    if (!head) return;
    head.className = 'mhead';
    head.innerHTML = `
      <div class="mhead-row">
        <button class="mhead-av-btn" id="p-av" aria-label="Buka profil saya">
          <span class="mhead-av-wrap">${M.avatarHTML(u, 'mhead-av')}</span>
        </button>
        <div class="grow" style="min-width:0">
          <div class="mhead-meta">${esc(greet)},</div>
          <div class="mhead-name ellipsis">${esc(String(u.name || '').split(',')[0])}</div>
          <div class="mhead-meta">Orang Tua / Wali${u.position ? ' · ' + esc(u.position) : ''}</div>
        </div>
        <button class="mhead-ico" id="p-info" aria-label="Informasi sekolah">${icon('bell', 19, 2.1)}</button>
        <button class="mhead-ico" id="p-refresh" aria-label="Muat ulang">${icon('refresh', 19, 2.1)}</button>
      </div>`;
    head.querySelector('#p-av').addEventListener('click', () => go('pprofile'));
    head.querySelector('#p-info').addEventListener('click', () => go('pinfo'));
    head.querySelector('#p-refresh').addEventListener('click', () => load(true));
  }

  function bindDelegation() {
    document.addEventListener('click', (e) => {
      const kid = e.target.closest && e.target.closest('[data-pkid]');
      if (kid) { selectChild(kid.dataset.pkid); return; }
      const nav = e.target.closest && e.target.closest('[data-pgo]');
      if (nav) { e.preventDefault(); go(nav.dataset.pgo); }
    });
  }

  function selectChild(id) {
    if (id === activeId) return;
    activeId = id;
    overview = null;
    render();
    load(false);
  }

  async function go(key) {
    current = PAGES[key] ? key : 'phome';
    highlight();
    render();
    window.scrollTo({ top: 0 });
  }

  function render() {
    const host = document.getElementById('m-view');
    if (!host) return;
    const page = PAGES[current] || PAGES.phome;
    try {
      host.innerHTML = page.render();
    } catch (err) {
      console.error(err);
      host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Terjadi kesalahan', text: err.message });
    }
    if (page.after) page.after(host);
  }

  /* -------------------------------- data -------------------------------- */

  async function load(force) {
    try {
      if (force || !children.length) {
        const r = await api('/parent/children');
        children = r.items || [];
        if (!activeId && children.length) activeId = children[0].id;
        renderHeader();
        renderNav();
      }
      const kid = activeChild();
      if (!kid) { overview = null; render(); return; }
      overview = await api('/parent/overview?student_id=' + encodeURIComponent(kid.id));
      render();
    } catch (e) {
      toast('error', 'Gagal memuat', e.message);
      render();
    }
  }

  /* ------------------------------- pages -------------------------------- */

  PAGES.phome = {
    render() {
      if (!kids().length) {
        return M.emptyBlock({
          icon: 'users',
          title: 'Belum ada anak terhubung',
          text: 'Akun ini belum dihubungkan dengan peserta didik mana pun. Hubungi administrator sekolah agar anak Anda ditautkan ke akun ini.',
        });
      }
      if (!overview) return M.skeletonCards(3);

      const o = overview;
      const st = o.school_time || {};
      const ecToday = (o.today && o.today.ec_schedule) || [];
      const cls = (o.today && o.today.class_schedule) || [];
      const letters = (o.letters || []).slice(0, 3);
      const anns = (o.information && o.information.announcements || []).slice(0, 3);

      return `
        ${switcher()}
        ${todayCard(o)}

        <div class="p-stats">
          <div class="p-stat"><b>${M.num((st.counts && st.counts.present) || 0)}</b><span>Hadir</span></div>
          <div class="p-stat"><b>${M.num((st.counts && st.counts.late) || 0)}</b><span>Terlambat</span></div>
          <div class="p-stat"><b>${M.num((st.counts && st.counts.leave) || 0)}</b><span>Izin</span></div>
          <div class="p-stat"><b>${esc(String(st.rate || 0))}%</b><span>Kehadiran</span></div>
        </div>

        ${sectionHead('Kegiatan setelah sekolah', ecToday.length ? 'Ada jadwal hari ini' : 'Ekstrakurikuler yang diikuti', 'pec', 'Lihat semua')}
        <div class="card">
          <div class="card-body" style="padding:14px">
            ${ecToday.length ? ecToday.map((e) => `
              <div class="p-row">
                <span class="p-row-ico is-ec">${icon('star', 15, 2.3)}</span>
                <div style="min-width:0">
                  <div class="semibold text-sm ellipsis">${esc(e.extracurricular_name)}</div>
                  <div class="text-xs muted">${esc(e.start_time)}–${esc(e.end_time)}${e.place ? ' · ' + esc(e.place) : ''}</div>
                </div>
                <span class="badge badge-ok" style="margin-left:auto">Hari ini</span>
              </div>`).join('')
              : (o.after_school || []).length
                ? (o.after_school || []).slice(0, 3).map((e) => `
                  <div class="p-row">
                    <span class="p-row-ico is-ec">${icon('star', 15, 2.3)}</span>
                    <div style="min-width:0">
                      <div class="semibold text-sm ellipsis">${esc(e.name)}</div>
                      <div class="text-xs muted">${esc((e.schedules || []).map((s) => s.day).join(', ') || 'Jadwal menyusul')} · ${M.num(e.attended || 0)}× hadir</div>
                    </div>
                  </div>`).join('')
                : `<div class="text-xs muted">Belum mengikuti ekstrakurikuler.</div>`}
          </div>
        </div>

        ${cls.length ? `
          ${sectionHead('Pelajaran hari ini', cls.length + ' jam pelajaran')}
          <div class="card">
            <div class="card-body" style="padding:14px">
              ${cls.map((c) => `
                <div class="p-row">
                  <span class="p-row-ico">${icon('timetable', 15, 2.3)}</span>
                  <div style="min-width:0">
                    <div class="semibold text-sm ellipsis">${esc(c.subject)}</div>
                    <div class="text-xs muted">${esc(c.start_time)}–${esc(c.end_time)}${c.teacher ? ' · ' + esc(c.teacher) : ''}</div>
                  </div>
                </div>`).join('')}
            </div>
          </div>` : ''}

        ${sectionHead('Surat & izin', letters.length ? letters.length + ' pengajuan terakhir' : 'Belum ada pengajuan', 'pletters', 'Lihat semua')}
        <div class="card">
          <div class="card-body" style="padding:14px">
            ${letters.length ? letters.map((r) => `
              <div class="p-row">
                <span class="p-row-ico">${icon('requests', 15, 2.3)}</span>
                <div style="min-width:0">
                  <div class="semibold text-sm ellipsis">${esc(r.title || r.type)}</div>
                  <div class="text-xs muted">${esc(r.start_date ? dateLabel(r.start_date) : '')}${r.end_date && r.end_date !== r.start_date ? ' – ' + esc(dateLabel(r.end_date)) : ''}</div>
                </div>
                <span class="badge ${r.status === 'approved' ? 'badge-ok' : r.status === 'pending' ? 'badge-warn' : 'badge-danger'}" style="margin-left:auto">${esc(r.status)}</span>
              </div>`).join('')
              : '<div class="text-xs muted">Belum ada surat atau pengajuan izin.</div>'}
          </div>
        </div>

        ${sectionHead('Informasi sekolah', 'Pengumuman dan berita terbaru', 'pinfo', 'Lihat semua')}
        <div class="card">
          <div class="card-body" style="padding:14px">
            ${anns.length ? anns.map((a) => `
              <div class="p-row" data-pann="${esc(a.id)}" style="cursor:pointer">
                <span class="p-row-ico">${icon('news', 15, 2.3)}</span>
                <div style="min-width:0">
                  <div class="semibold text-sm ellipsis">${a.is_pinned ? '📌 ' : ''}${esc(a.title)}</div>
                  <div class="text-xs muted">${esc(dateLabel(a.date))}</div>
                </div>
                ${icon('chevronRight', 16, 2.3)}
              </div>`).join('')
              : '<div class="text-xs muted">Belum ada pengumuman.</div>'}
          </div>
        </div>`;
    },
    after(host) {
      host.querySelectorAll('[data-pann]').forEach((row) => {
        row.addEventListener('click', () => {
          const a = (overview && overview.information && overview.information.announcements || []).find((x) => x.id === row.dataset.pann);
          if (a) openInfo(a, 'announcement');
        });
      });
    },
  };

  /** School hours: the week at a glance plus the recent history. */
  PAGES.pschool = {
    render() {
      if (!overview) return M.skeletonCards(2);
      const st = overview.school_time || {};
      const days = (st.week && st.week.days) || [];
      const recent = st.recent || [];
      const dotClass = { present: 'is-ok', late: 'is-warn', absent: 'is-bad', leave: 'is-info' };
      return `
        ${switcher()}
        <div class="card slide-up">
          <div class="card-body">
            <div class="semibold mb-8">${icon('attendance', 15, 2.3)} Tujuh hari terakhir</div>
            <div class="p-week">
              ${days.map((d) => `
                <div class="p-day">
                  <span class="p-day-d ${dotClass[d.status] || 'is-empty'}"></span>
                  <span class="p-day-n">${esc(d.dow.slice(0, 3))}</span>
                  <span class="p-day-t">${esc(clock(d.check_in) === '—' ? '' : clock(d.check_in))}</span>
                </div>`).join('')}
            </div>
            <div class="text-xs muted" style="margin-top:10px">
              ${esc(String((st.week && st.week.counts && st.week.counts.present) || 0))} hadir ·
              ${esc(String((st.week && st.week.counts && st.week.counts.late) || 0))} terlambat ·
              tingkat kehadiran ${esc(String((st.week && st.week.rate) || 0))}%
            </div>
          </div>
        </div>

        ${sectionHead('Riwayat absensi', recent.length + ' hari tercatat', 'pschool', null)}
        <div class="card">
          <div class="card-body" style="padding:14px">
            ${recent.length ? recent.map((r) => `
              <div class="p-row">
                <div style="min-width:74px">
                  <div class="semibold text-sm">${esc(r.dow.slice(0, 3))}, ${esc(String(r.date).slice(8, 10))}</div>
                  <div class="text-xs muted">${esc(dateLabel(r.date))}</div>
                </div>
                <div style="min-width:0" class="grow">
                  <div class="text-xs">${esc(clock(r.check_in_at))} – ${esc(r.check_out_at ? clock(r.check_out_at) : 'belum pulang')}</div>
                  <div class="text-xs muted">${r.work_hours ? esc(String(r.work_hours)) + ' jam kerja' : ''} ${r.check_in_method ? '· ' + esc(r.check_in_method) : ''}</div>
                </div>
                <div style="margin-left:auto">${statusBadge(r.status)}</div>
              </div>`).join('')
              : '<div class="text-xs muted">Belum ada riwayat absensi.</div>'}
          </div>
        </div>`;
    },
  };

  /** After school: what they joined, when it meets, and whether they went. */
  PAGES.pec = {
    render() {
      if (!overview) return M.skeletonCards(2);
      const list = overview.after_school || [];
      const todayName = (overview.today && overview.today.day) || '';
      if (!list.length) {
        return M.emptyBlock({
          icon: 'star',
          title: 'Belum ada kegiatan',
          text: 'Anak Anda belum terdaftar pada ekstrakurikuler mana pun.',
        });
      }
      return `
        ${switcher()}
        ${list.map((e) => `
          <div class="card slide-up mb-12">
            <div class="card-body">
              <div class="row between gap-8 mb-8">
                <div style="min-width:0">
                  <div class="row gap-6 wrap mb-4">
                    <span class="badge badge-violet">${esc(e.category || 'Umum')}</span>
                    ${e.meets_today ? '<span class="badge badge-ok"><i class="badge-dot"></i>Hari ini</span>' : ''}
                  </div>
                  <h3 style="font-size:1rem">${esc(e.name)}</h3>
                  ${e.description ? `<div class="text-xs muted mt-4">${esc(e.description)}</div>` : ''}
                </div>
                <div class="text-right" style="flex:none">
                  <div class="semibold">${M.num(e.attended || 0)}<span class="muted text-sm">/${M.num(e.total_sessions || 0)}</span></div>
                  <div class="text-xs muted">kali hadir</div>
                </div>
              </div>

              ${(e.schedules || []).length ? `
                <div class="text-xs muted mb-4">Jadwal</div>
                <div class="row gap-4 wrap mb-8">
                  ${e.schedules.map((s) => `<span class="badge ${s.day === todayName ? 'badge-brand' : 'badge-muted'}">${esc(s.day)} ${esc(s.start_time)}–${esc(s.end_time)}${s.place && s.place.name ? ' · ' + esc(s.place.name) : ''}</span>`).join('')}
                </div>` : ''}

              ${(e.records || []).length ? `
                <div class="text-xs muted mb-4">Kehadiran terakhir</div>
                ${e.records.slice(0, 6).map((r) => `
                  <div class="p-row">
                    <div style="min-width:0" class="grow">
                      <div class="text-sm">${esc(dateLabel(r.date))}</div>
                      <div class="text-xs muted">${esc(r.place_name || 'Tanpa lokasi')}${r.has_selfie ? ' · 📷' : ''}</div>
                    </div>
                    <span class="badge ${r.status === 'present' ? 'badge-ok' : 'badge-muted'}"><i class="badge-dot"></i>${esc(r.status === 'present' ? 'Hadir' : 'Tidak hadir')}</span>
                  </div>`).join('')}`
                : '<div class="text-xs muted">Belum ada kehadiran tercatat.</div>'}
            </div>
          </div>`).join('')}`;
    },
  };

  /** Letters: sick notes, family agenda, official duty… with their status. */
  PAGES.pletters = {
    render() {
      if (!overview) return M.skeletonCards(2);
      const list = overview.letters || [];
      if (!list.length) {
        return M.emptyBlock({
          icon: 'requests',
          title: 'Belum ada surat',
          text: 'Pengajuan izin, sakit atau tugas dari anak Anda akan muncul di sini beserta statusnya.',
        });
      }
      return `
        ${switcher()}
        ${list.map((r) => `
          <div class="card slide-up mb-12">
            <div class="card-body">
              <div class="row between gap-8 mb-8">
                <div style="min-width:0">
                  <span class="badge badge-brand">${esc(r.type || 'Lainnya')}</span>
                  <h3 style="font-size:1rem;margin-top:6px">${esc(r.title || 'Tanpa judul')}</h3>
                  <div class="text-xs muted mt-4">
                    ${esc(r.start_date ? dateLabel(r.start_date) : '')}${r.end_date && r.end_date !== r.start_date ? ' – ' + esc(dateLabel(r.end_date)) : ''}
                    ${r.created_at ? ' · diajukan ' + esc(dateLabel(String(r.created_at).slice(0, 10))) : ''}
                  </div>
                </div>
                <span class="badge ${r.status === 'approved' ? 'badge-ok' : r.status === 'pending' ? 'badge-warn' : 'badge-danger'}" style="flex:none">
                  ${esc(r.status === 'approved' ? 'Disetujui' : r.status === 'pending' ? 'Menunggu' : 'Ditolak')}
                </span>
              </div>
              ${r.details ? `<div class="text-sm" style="line-height:1.7">${esc(r.details)}</div>` : ''}
              ${r.review_note ? `<div class="text-xs muted mt-8">Catatan sekolah: ${esc(r.review_note)}</div>` : ''}
            </div>
          </div>`).join('')}`;
    },
  };

  /** School information aimed at students. */
  PAGES.pinfo = {
    render() {
      if (!overview) return M.skeletonCards(2);
      const info = overview.information || {};
      const anns = info.announcements || [];
      const news = info.news || [];
      return `
        ${switcher()}
        <div class="seg mb-12" id="p-info-tab">
          <button class="is-active" data-pit="ann">Pengumuman</button>
          <button data-pit="news">Berita</button>
        </div>
        <div id="p-info-body"></div>
        <script type="application/json" id="p-info-data">${JSON.stringify({ anns, news }).replace(/</g, '\\u003c')}</script>`;
    },
    after(host) {
      const data = JSON.parse(host.querySelector('#p-info-data').textContent || '{}');
      const body = host.querySelector('#p-info-body');
      let tab = 'ann';
      const paint = () => {
        const rows = tab === 'ann' ? (data.anns || []) : (data.news || []);
        body.innerHTML = rows.length ? rows.map((a) => `
          <div class="card slide-up mb-12" data-popen="${esc(a.id)}" data-ptab="${esc(tab)}" style="cursor:pointer">
            <div class="card-body">
              <div class="row between gap-8 mb-4">
                <span class="badge ${tab === 'ann' ? 'badge-brand' : 'badge-violet'}">${esc((a.category) || (tab === 'ann' ? 'Pengumuman' : 'Berita'))}</span>
                ${a.is_pinned ? '<span class="badge badge-warn">📌</span>' : ''}
              </div>
              <div class="semibold">${esc(a.title)}</div>
              <div class="text-xs muted mt-4">${esc(dateLabel(a.date))}${a.location ? ' · ' + esc(a.location) : ''}</div>
              <div class="text-sm mt-8" style="line-height:1.7">${esc(String(a.details || '').slice(0, 160))}${String(a.details || '').length > 160 ? '…' : ''}</div>
            </div>
          </div>`).join('')
          : M.emptyBlock({ icon: 'news', title: 'Belum ada', text: 'Belum ada ' + (tab === 'ann' ? 'pengumuman' : 'berita') + ' untuk peserta didik.' });
        body.querySelectorAll('[data-popen]').forEach((c) => {
          c.addEventListener('click', () => {
            const rows2 = c.dataset.ptab === 'ann' ? (data.anns || []) : (data.news || []);
            const item = rows2.find((x) => x.id === c.dataset.popen);
            if (item) openInfo(item, c.dataset.ptab === 'ann' ? 'announcement' : 'news');
          });
        });
      };
      host.querySelectorAll('#p-info-tab button').forEach((b) => {
        b.addEventListener('click', () => {
          host.querySelectorAll('#p-info-tab button').forEach((x) => x.classList.toggle('is-active', x === b));
          tab = b.dataset.pit;
          paint();
        });
      });
      paint();
    },
  };

  /** A parent's own profile: account details plus the children they follow. */
  PAGES.pprofile = {
    render() {
      const u = store.data.user || {};
      return `
        <div class="card slide-up">
          <div class="card-body text-center" style="padding:22px">
            ${M.avatarHTML(u, 'p-av-lg')}
            <div class="semibold" style="font-size:1.05rem;margin-top:10px">${esc(u.name || '')}</div>
            <div class="text-xs muted">Orang Tua / Wali · ${esc(u.id_number || '')}</div>
            <div class="text-xs muted mt-4">${esc(u.email || '')}${u.phone ? ' · ' + esc(u.phone) : ''}</div>
          </div>
        </div>

        ${sectionHead('Anak yang terhubung', kids().length + ' peserta didik')}
        <div class="card">
          <div class="card-body" style="padding:14px">
            ${kids().length ? kids().map((c) => `
              <div class="p-row">
                ${M.avatarHTML(c, 'p-chip-av')}
                <div style="min-width:0">
                  <div class="semibold text-sm ellipsis">${esc(c.name)}</div>
                  <div class="text-xs muted">${esc(c.class_name || '')} · ${esc(c.id_number || '')}</div>
                </div>
                <span class="badge ${c.today && c.today.at_school ? 'badge-ok' : 'badge-muted'}" style="margin-left:auto">
                  <i class="badge-dot"></i>${c.today && c.today.at_school ? 'Di sekolah' : esc(M.STATUS_LABEL[c.today && c.today.status] || '-')}
                </span>
              </div>`).join('')
              : '<div class="text-xs muted">Belum ada anak yang terhubung.</div>'}
          </div>
        </div>

        <button class="btn btn-block" id="p-logout" style="margin-top:18px;height:48px;border-radius:15px">
          ${icon('logout', 16, 2.4)} Keluar
        </button>`;
    },
    after(host) {
      const b = host.querySelector('#p-logout');
      if (b) b.addEventListener('click', () => { store.clear(); location.reload(); });
    },
  };

  /* --------------------------- detail sheets ---------------------------- */

  /** Reuse the app's announcement/news reader when it is available. */
  function openInfo(item, kind) {
    const open = kind === 'news' ? global.App.openNewsDetail : global.App.openAnnouncementDetail;
    if (typeof open === 'function') { open(item); return; }
    sheet({
      title: item.title || '',
      sub: dateLabel(item.date),
      okText: 'Tutup',
      body: `<div class="text-sm" style="line-height:1.8">${esc(String(item.details || '').replace(/\n/g, '<br>'))}</div>`,
    });
  }

  /* -------------------------------- boot -------------------------------- */

  /** Called by app.js instead of the member shell when the role is `parent`. */
  P.start = async function () {
    const login = document.getElementById('m-login');
    if (login) login.classList.add('hidden');
    const app = document.getElementById('m-app');
    app.classList.remove('hidden');
    if (!bound) { bindDelegation(); bound = true; }
    renderHeader();
    renderNav();
    render();
    await load(true);
  };

  /** Exposed so tests can drive a page without clicking through the nav. */
  P.go = go;
  P.state = () => ({ current, activeId, children: kids(), hasOverview: !!overview });
})(window);
