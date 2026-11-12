/* ==========================================================================
   Admin app — authentication, routing and shell
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.Core;
  const Pages = global.Pages;

  const NAV_ORDER = ['Utama', 'Sekolah', 'Komunikasi', 'Analitik', 'Sistem'];

  /* ------------------------------- theme -------------------------------- */
  function applyTheme(s) {
    if (!s) return;
    if (s.theme_primary) document.documentElement.style.setProperty('--brand', s.theme_primary);
    if (s.theme_accent) document.documentElement.style.setProperty('--accent', s.theme_accent);
  }

  /* ------------------------------- clock -------------------------------- */
  function startClock() {
    const el = document.getElementById('clock-time');
    if (!el) return;
    function tick() {
      const off = C.localOffset();
      const d = new Date(Date.now() + off * 60000);
      el.textContent = `${C.pad(d.getUTCHours())}:${C.pad(d.getUTCMinutes())}:${C.pad(d.getUTCSeconds())}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ------------------------------- login -------------------------------- */
  function renderLogin() {
    const root = document.getElementById('login-root');
    document.getElementById('app-root').classList.add('hidden');
    root.classList.remove('hidden');

    root.innerHTML = `
      <div class="login-page">
        <div class="login-art">
          <div class="login-brand">
            <img id="lg-logo" src="/api/assets/default-logo.svg" alt="Logo">
            <div>
              <div class="login-brand-name" id="lg-name">SMP Negeri 1 Yogyakarta</div>
              <div class="login-brand-sub" id="lg-sub">Sistem Absensi Digital</div>
            </div>
          </div>
          <div class="login-hero">
            <h1>Kelola kehadiran warga sekolah dengan satu dasbor.</h1>
            <p>Pantau absensi masuk dan pulang secara real time, tinjau permohonan izin, kelola kalender akademik dan publikasikan pengumuman — semuanya dalam satu tempat.</p>
            <div class="login-stats">
              <div><div class="login-stat-b" id="lg-s1">—</div><div class="login-stat-l">Pengguna</div></div>
              <div><div class="login-stat-b" id="lg-s2">—</div><div class="login-stat-l">Rekam kehadiran</div></div>
              <div><div class="login-stat-b" id="lg-s3">—</div><div class="login-stat-l">Ekstrakurikuler</div></div>
            </div>
          </div>
        </div>

        <div class="login-panel">
          <div class="login-card">
            <div class="login-card-head">
              <img class="mobile-logo" src="/api/assets/default-logo.svg" alt="Logo" style="width:56px;height:56px;border-radius:16px;margin-bottom:12px">
              <h2>Masuk Panel Admin</h2>
              <p>Gunakan ID pengguna dan kata sandi sekolah Anda</p>
            </div>

            <form class="card card-pad" id="login-form" autocomplete="on">
              <div class="field mb-16">
                <label class="label">ID Pengguna atau Email</label>
                <input class="input" name="idNumber" data-autofocus placeholder="mis. SP1TAADM" autocomplete="username" required>
              </div>
              <div class="field mb-8">
                <label class="label">Kata Sandi</label>
                <input class="input" type="password" name="password" placeholder="••••••••" autocomplete="current-password" required>
              </div>
              <div class="row between mb-16">
                <label class="check"><input type="checkbox" name="remember" checked> Ingat saya</label>
                <button type="button" class="btn btn-sm btn-ghost" id="lg-forgot">Lupa kata sandi?</button>
              </div>
              <button class="btn btn-primary btn-lg btn-block" type="submit" id="lg-submit">Masuk ke Dasbor</button>
              <div id="lg-error" class="hidden" style="margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--danger-50);color:#b91c1c;font-size:.82rem;font-weight:600"></div>
            </form>

            <div class="login-demo">
              <div class="login-demo-t">Akun demo — klik untuk mengisi</div>
              <div id="lg-demos"><div class="skeleton skel-line" style="height:44px;margin-bottom:6px"></div></div>
              <div class="hint mt-8">Kata sandi semua akun demo: <b>demo123</b></div>
            </div>
          </div>
        </div>
      </div>`;

    const form = root.querySelector('#login-form');
    const errBox = root.querySelector('#lg-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = root.querySelector('#lg-submit');
      const v = C.formValues(form);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:16px;height:16px"></span> Memverifikasi…';
      errBox.classList.add('hidden');
      try {
        const d = await C.api('/auth/login', { method: 'POST', body: { idNumber: v.idNumber, password: v.password } });
        if (d.user.role !== 'admin') {
          errBox.textContent = 'Akun ini bukan administrator. Silakan buka aplikasi seluler di /mobile.';
          errBox.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Masuk ke Dasbor';
          return;
        }
        C.store.set({ token: d.token, user: d.user, school: d.school, settings: d.settings });
        boot();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Masuk ke Dasbor';
      }
    });

    root.querySelector('#lg-forgot').addEventListener('click', () => forgotPassword());

    /* school branding + demo accounts */
    fetch('/api/public/school').then((r) => r.json()).then((j) => {
      const s = j.data;
      if (!s) return;
      C.store.set({ school: s.school, settings: s.settings });
      applyTheme(s.settings);
      const st = s.settings || {};
      document.getElementById('lg-name').textContent = st.school_name || s.school.name;
      document.getElementById('lg-sub').textContent = st.app_tagline || 'Sistem Absensi Digital';
      document.getElementById('lg-logo').src = st.logo ? '/api/assets/logo.svg' : '/api/assets/default-logo.svg';
      document.title = `${st.app_name || s.school.name} — Panel Administrator`;
    }).catch(() => {});

    fetch('/api/auth/demo-accounts').then((r) => r.json()).then((j) => {
      const items = (j.data || []).filter((x) => x.role === 'admin');
      const host = document.getElementById('lg-demos');
      host.innerHTML = items.map((a) => `
        <button type="button" class="demo-acc" data-id="${C.esc(a.id_number)}">
          <span style="font-size:1.1rem">${a.role === 'admin' ? '🛡️' : '👤'}</span>
          <span class="grow" style="min-width:0">
            <span class="demo-acc-n">${C.esc(C.ROLE_LABEL[a.role] || a.role)}</span>
            <span class="demo-acc-i">${C.esc(a.id_number)}</span>
          </span>
          <span class="text-xs muted">isi →</span>
        </button>`).join('');
      host.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
        form.querySelector('[name="idNumber"]').value = b.dataset.id;
        form.querySelector('[name="password"]').value = 'demo123';
        form.querySelector('[name="password"]').focus();
      }));
    }).catch(() => {
      document.getElementById('lg-demos').innerHTML = '<div class="hint">Akun demo tidak tersedia.</div>';
    });
  }

  function forgotPassword() {
    const m = C.modal({
      title: 'Pemulihan kata sandi',
      sub: 'Masukkan ID pengguna dan email terdaftar',
      narrow: true,
      okText: 'Kirim Kode',
      body: `
        <div class="field mb-12">
          <label class="label">ID Pengguna</label>
          <input class="input" name="idNumber" data-autofocus placeholder="mis. SP1TAADM">
        </div>
        <div class="field">
          <label class="label">Email terdaftar</label>
          <input class="input" type="email" name="email" placeholder="nama@sp1yogyakarta.sch.id">
        </div>
        <div id="fp-res" class="hidden mt-12"></div>`,
      onMount(api) {
        let step = 1;
        api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
        api.el.querySelector('[data-submit]').addEventListener('click', async () => {
          m.clearError();
          const v = C.formValues(api.body);
          const box = api.el.querySelector('#fp-res');
          try {
            if (step === 1) {
              if (!v.idNumber) return m.error('ID pengguna wajib diisi.');
              api.setBusy(true, 'Memverifikasi…');
              const r = await C.api('/auth/forgot-password', { method: 'POST', body: { idNumber: v.idNumber, email: v.email } });
              api.setBusy(false);
              step = 2;
              api.body.innerHTML = `
                <div style="padding:12px 14px;border-radius:12px;background:var(--ok-50);color:#15803d;font-size:.84rem;font-weight:600;margin-bottom:14px">
                  Kode pemulihan telah dibuat. (Demo) Kode Anda: <b>${C.esc(String(r.token))}</b>
                </div>
                <div class="field mb-12"><label class="label">Kode 6 angka</label><input class="input" name="token" data-autofocus placeholder="000000" maxlength="6"></div>
                <div class="field"><label class="label">Kata sandi baru</label><input class="input" type="password" name="password" placeholder="minimal 6 karakter"></div>`;
              api.el.querySelector('[data-submit]').textContent = 'Ubah Kata Sandi';
              // keep a reference to the entered id
              api.el.dataset.idNumber = v.idNumber;
            } else {
              const idn = api.el.dataset.idNumber;
              const vals = C.formValues(api.body);
              if (!/^\d{6}$/.test(vals.token || '')) return m.error('Kode harus 6 angka.');
              if (!vals.password || vals.password.length < 6) return m.error('Kata sandi baru minimal 6 karakter.');
              api.setBusy(true, 'Menyimpan…');
              await C.api('/auth/reset-password', { method: 'POST', body: { idNumber: idn, token: vals.token, password: vals.password } });
              api.close();
              C.toastOk('Kata sandi diubah', 'Silakan masuk dengan kata sandi baru Anda.');
            }
          } catch (err) { api.setBusy(false); m.error(err.message); }
        });
      },
    });
    return m;
  }

  /* ------------------------------- shell -------------------------------- */
  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    const groups = {};
    Pages.defs.forEach((d) => {
      if (d.group === false) return;
      const g = d.group || 'Lainnya';
      (groups[g] = groups[g] || []).push(d);
    });
    let html = '';
    NAV_ORDER.concat(Object.keys(groups).filter((g) => !NAV_ORDER.includes(g))).forEach((g) => {
      if (!groups[g]) return;
      html += `<div class="nav-group"><div class="nav-label">${C.esc(g)}</div>`;
      groups[g].forEach((d) => {
        html += `<a class="nav-item" href="#/${d.key}" data-nav="${d.key}">
          <span class="nav-ico">${C.icon(d.icon, 18, 2.1)}</span>
          <span class="grow ellipsis">${C.esc(d.title)}</span>
          ${d.badgeKey ? `<span class="nav-count hidden" data-badge="${d.key}">0</span>` : ''}
        </a>`;
      });
      html += '</div>';
    });
    nav.innerHTML = html;

    const u = C.store.data.user;
    document.getElementById('side-user').innerHTML = `
      ${C.avatarHTML(u)}
      <div class="grow" style="min-width:0">
        <div class="side-user-n ellipsis">${C.esc(u ? u.name : 'Administrator')}</div>
        <div class="side-user-r ellipsis">${u ? C.ROLE_LABEL[u.role] : ''}</div>
      </div>
      <button class="icon-btn btn-sm" id="side-logout" title="Keluar">${C.icon('logout', 15, 2.2)}</button>`;
    const lb = document.getElementById('side-logout');
    if (lb) lb.addEventListener('click', logout);
  }

  function setActive(key) {
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('is-active', a.dataset.nav === key);
    });
  }

  async function refreshBadges() {
    try {
      const d = await C.api('/admin/requests?status=pending&limit=1', { silent: true });
      const el = document.querySelector('[data-badge="requests"]');
      if (el) {
        const n = d.counts ? d.counts.pending : 0;
        el.textContent = n > 99 ? '99+' : n;
        el.classList.toggle('hidden', !n);
      }
    } catch (e) { /* ignore */ }
  }

  let currentPage = null;
  function route() {
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const key = hash.split('/')[0].split('?')[0];
    const page = Pages[key] || Pages.dashboard;

    if (currentPage && currentPage.unmount) currentPage.unmount();
    currentPage = page;

    setActive(page.key);
    document.getElementById('page-title').textContent = page.title;
    document.getElementById('page-sub').textContent = page.sub || '';

    const view = document.getElementById('view');
    view.innerHTML = '';
    view.classList.remove('slide-up');
    void view.offsetWidth;
    view.classList.add('slide-up');

    try {
      page.render(view);
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="card"><div class="empty">
        <div class="empty-ico">${C.icon('alert', 26, 1.8)}</div>
        <div class="empty-title">Terjadi kesalahan</div>
        <div class="empty-text">${C.esc(err.message)}</div>
        <button class="btn btn-primary mt-8" onclick="location.reload()">Muat ulang halaman</button>
      </div></div>`;
    }
    window.scrollTo({ top: 0 });
    closeSidebar();
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('is-open');
    document.getElementById('scrim').classList.remove('is-open');
  }

  function logout() {
    C.store.clear();
    location.hash = '';
    renderLogin();
  }

  /* -------------------------------- boot -------------------------------- */
  function boot() {
    const s = C.store.data;
    if (!s.token || !s.user) return renderLogin();
    document.getElementById('login-root').innerHTML = '';
    document.getElementById('login-root').classList.add('hidden');
    document.getElementById('app-root').classList.remove('hidden');

    applyTheme(s.settings);
    const st = s.settings || {};
    const sc = s.school || {};
    document.getElementById('side-name').textContent = st.school_name || sc.name || 'Absensi Sekolah';
    document.getElementById('side-sub').textContent = st.app_tagline || 'Panel Administrator';
    document.getElementById('side-logo').src = st.logo ? '/api/assets/logo.svg?v=' + Date.now() : '/api/assets/default-logo.svg';
    document.title = `${st.app_name || sc.name || 'Absensi Sekolah'} — Panel Administrator`;

    buildSidebar();
    startClock();
    if (!location.hash) location.hash = '#/dashboard';
    route();
    refreshBadges();
    setInterval(refreshBadges, 60000);

    document.getElementById('btn-burger').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('is-open');
      document.getElementById('scrim').classList.toggle('is-open');
    });
    document.getElementById('scrim').addEventListener('click', closeSidebar);
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-refresh').addEventListener('click', () => {
      if (currentPage && currentPage.render) {
        const view = document.getElementById('view');
        currentPage.render(view);
        C.toastInfo('Memuat ulang…', 'Data terbaru sedang diambil.');
      }
    });
  }

  window.addEventListener('hashchange', () => {
    if (C.store.data.token && C.store.data.user) route();
  });

  /* expose a global action so pages' "Tambah" buttons work from anywhere */
  global.adminAction = function (page, action) {
    if (Pages[page] && Pages[page][action]) Pages[page][action]();
  };

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})(window);
