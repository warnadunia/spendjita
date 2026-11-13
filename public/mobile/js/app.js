/* ==========================================================================
   Mobile PWA app — splash, login, floating bottom nav, 3D check-in, pages
   ========================================================================== */
(function (global) {
  'use strict';
  const M = global.MCore;
  const { icon, esc, api, store, toast, sheet, confirmSheet, formValues } = M;

  const App = global.App = {};

  /* ============================== state ================================ */
  /**
   * Bottom navigation — exactly five icons:
   *   Beranda · Kalender · (+) · Riwayat · Jadwal
   * "Info" is not a tab because the bell at the top of the screen already
   * opens it, and the profile is not a tab because the avatar box sits at the
   * top of the profile section. Only real sections occupy the bar.
   */
  const NAV = [
    { key: 'home', label: 'Beranda', icon: 'home' },
    { key: 'calendar', label: 'Kalender', icon: 'calendar' },
    { key: 'history', label: 'Riwayat', icon: 'attendance' },
    { key: 'schedule', label: 'Jadwal', icon: 'timetable' },
  ];
  const PROFILE_NAV = { key: 'profile', label: 'Profil', icon: 'user' };

  const cache = {};
  let current = 'home';
  let routeArg = '';

  /* ============================== splash =============================== */
  function showSplash(opts) {
    const o = opts || {};
    let el = document.getElementById('m-splash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'm-splash';
      el.className = 'splash';
      document.body.appendChild(el);
    }
    const settings = store.data.settings || {};
    const quotes = (settings.splash_quotes && settings.splash_quotes.length)
      ? settings.splash_quotes
      : ['Semangat pagi! Setiap langkah kecil adalah awal dari pencapaian besar.'];
    const quote = o.quote || quotes[Math.floor(Math.random() * quotes.length)];

    el.innerHTML = `
      ${o.iconHTML || `<img class="splash-logo" src="${settings.logo ? '/api/assets/logo.svg' : '/api/assets/default-logo.svg'}" alt="Logo">`}
      ${o.title ? `<div class="splash-name">${esc(o.title)}</div>` : ''}
      ${o.sub ? `<div class="splash-tag">${esc(o.sub)}</div>` : ''}
      <div class="splash-quote">${esc(quote)}</div>
      ${o.time ? `<div class="splash-time">${esc(o.time)}</div>` : ''}
      ${o.badge ? `<div class="splash-badge">${esc(o.badge)}</div>` : ''}
      ${o.autoClose !== false ? '<div class="pull-hint" style="color:rgba(255,255,255,.7)">Ketuk di mana saja untuk melanjutkan</div>' : ''}`;
    el.classList.remove('is-out');
    el.style.display = '';

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeEventListener('click', finish);
      el.classList.add('is-out');
      setTimeout(() => { el.style.display = 'none'; }, 420);
      if (o.onClose) o.onClose();
    };
    const timer = setTimeout(finish, o.duration || 3400);
    if (o.autoClose !== false) el.addEventListener('click', finish);
    return { close: finish };
  }

  /* =============================== boot ================================ */
  function boot() {
    loadBranding().then(() => {
      if (store.data.token && store.data.user) {
        const quotes = ((store.data.settings || {}).splash_quotes || []);
        showSplash({
          duration: 1500,
          title: (store.data.settings || {}).app_short_name || 'Absensi',
          sub: (store.data.settings || {}).app_tagline || '',
          quote: quotes.length ? quotes[0] : 'Selamat datang kembali!',
        });
        startApp();
      } else {
        if (store.data.settings && store.data.settings.app_short_name) {
          showSplash({
            duration: 1200,
            title: store.data.settings.app_short_name,
            sub: store.data.settings.app_tagline || '',
            quote: '',
            onClose: renderLogin,
          });
        } else {
          renderLogin();
        }
      }
    });
  }

  async function loadBranding() {
    try {
      const d = await api('/public/school');
      store.set({ school: d.school, settings: d.settings });
      applyTheme(d.settings);
    } catch (e) {
      try {
        const d = await api('/auth/me');
        store.set({ settings: d.settings, school: d.school });
        applyTheme(d.settings);
      } catch (e2) { /* offline — use cached branding */ }
    }
    applyTheme(store.data.settings);
  }

  function applyTheme(s) {
    if (!s) return;
    if (s.theme_primary) document.documentElement.style.setProperty('--brand', s.theme_primary);
    if (s.theme_accent) document.documentElement.style.setProperty('--accent', s.theme_accent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && s.theme_primary) meta.setAttribute('content', s.theme_primary);
  }

  /* =============================== login =============================== */
  function renderLogin() {
    document.getElementById('m-app').classList.add('hidden');
    let host = document.getElementById('m-login');
    if (!host) {
      host = document.createElement('div');
      host.id = 'm-login';
      document.body.appendChild(host);
    }
    host.classList.remove('hidden');
    const s = store.data.settings || {};
    const sc = store.data.school || {};

    host.className = 'login';
    host.innerHTML = `
      <div class="login-head">
        <img src="${s.logo ? '/api/assets/logo.svg' : '/api/assets/default-logo.svg'}" alt="Logo">
        <h1>${esc(s.app_name || sc.name || 'Absensi Sekolah')}</h1>
        <p>${esc(s.app_tagline || 'Silakan masuk untuk melanjutkan')}</p>
      </div>

      <div class="login-card">
        <div class="lfield">
          <label for="li-id">ID Pengguna</label>
          <input class="input" id="li-id" placeholder="mis. SP1TA7A01" autocomplete="username"
                 autocapitalize="characters" spellcheck="false" autocorrect="off">
        </div>
        <div class="lfield">
          <label for="li-pass">Kata Sandi</label>
          <input class="input" id="li-pass" type="password" placeholder="••••••••" autocomplete="current-password">
        </div>
        <label style="display:flex;align-items:center;gap:9px;font-size:.84rem;color:var(--ink-600);margin-bottom:16px">
          <input type="checkbox" id="li-remember" checked style="width:18px;height:18px;accent-color:var(--brand)">
          Ingat saya di perangkat ini
        </label>
        <button class="login-btn" id="li-go">
          <span id="li-go-t">Masuk</span>
        </button>
        <div class="login-err" id="li-err"></div>
        <div style="text-align:center;margin-top:14px">
          <button id="li-forgot" style="background:none;border:none;color:var(--brand);font-weight:700;font-size:.84rem;text-decoration:underline">
            Lupa kata sandi?
          </button>
        </div>
      </div>

      <div class="demo-strip">
        <div class="demo-strip-t">Akun demo — ketuk untuk mengisi</div>
        <div id="li-demos"><div class="skeleton" style="height:44px;border-radius:14px;margin-bottom:7px;opacity:.3"></div></div>
        <div style="text-align:center;font-size:.72rem;opacity:.85;margin-top:8px">Kata sandi: <b>demo123</b></div>
      </div>

      <div class="login-foot">
        <button id="li-kiosk">Buka kios QR sekolah</button>
      </div>`;

    const errBox = host.querySelector('#li-err');
    const btn = host.querySelector('#li-go');
    const idEl = host.querySelector('#li-id');
    const passEl = host.querySelector('#li-pass');

    async function submit() {
      errBox.classList.remove('show');
      const idNumber = idEl.value.trim();
      const password = passEl.value;
      if (!idNumber || !password) {
        errBox.textContent = 'Mohon isi ID pengguna dan kata sandi.';
        errBox.classList.add('show');
        return;
      }
      btn.disabled = true;
      host.querySelector('#li-go-t').textContent = 'Memverifikasi…';
      try {
        const d = await api('/auth/login', { method: 'POST', body: { idNumber, password } });
        if (d.user.role === 'admin') {
          errBox.textContent = 'Akun administrator hanya dapat masuk melalui panel web.';
          errBox.classList.add('show');
          btn.disabled = false;
          host.querySelector('#li-go-t').textContent = 'Masuk';
          return;
        }
        store.set({ token: d.token, user: d.user, school: d.school, settings: d.settings });
        applyTheme(d.settings);
        const quotes = (d.settings.splash_quotes || []);
        host.classList.add('hidden');
        startApp();
        showSplash({
          duration: 2200,
          title: 'Selamat datang',
          sub: d.user.name,
          quote: quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : 'Semoga hari Anda menyenangkan!',
        });
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
        btn.disabled = false;
        host.querySelector('#li-go-t').textContent = 'Masuk';
      }
    }
    btn.addEventListener('click', submit);
    passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    idEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') passEl.focus(); });

    host.querySelector('#li-forgot').addEventListener('click', () => forgotFlow());
    host.querySelector('#li-kiosk').addEventListener('click', () => { location.href = '/kiosk'; });

    api('/auth/demo-accounts').then((list) => {
      const items = (list || []).filter((a) => a.role !== 'admin');
      const demos = host.querySelector('#li-demos');
      if (!items.length) { demos.innerHTML = ''; return; }
      const DEMO_ICON = { teacher: '👩‍🏫', student: '🎓', employee: '🧾', parent: '👪' };
      const DEMO_LABEL = { parent: 'Orang Tua / Wali' };
      demos.innerHTML = items.map((a) => `
        <button class="demo-chip" data-demo="${esc(a.role)}" data-id="${esc(a.id_number)}">
          <span style="font-size:1.15rem">${DEMO_ICON[a.role] || '🧾'}</span>
          <span style="min-width:0">
            <span class="demo-chip-n">${esc(DEMO_LABEL[a.role] || M.ROLE_LABEL[a.role] || a.role)}</span>
            <span class="demo-chip-i" style="display:block">${esc(a.id_number)}</span>
          </span>
        </button>`).join('');
      demos.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
        idEl.value = b.dataset.id;
        passEl.value = 'demo123';
        passEl.focus();
      }));
    }).catch(() => { host.querySelector('#li-demos').innerHTML = ''; });
  }

  function forgotFlow() {
    let stage = 1;
    let idNumber = '';
    const s = sheet({
      title: 'Pemulihan kata sandi',
      sub: 'Langkah 1 dari 2 — verifikasi identitas',
      okText: 'Kirim Kode',
      body: `
        <div class="lfield">
          <label>ID Pengguna</label>
          <input class="input" name="idNumber" data-autofocus placeholder="mis. SP1TA7A01" autocapitalize="characters">
        </div>
        <div class="lfield">
          <label>Email terdaftar</label>
          <input class="input" type="email" name="email" placeholder="nama@sp1yogyakarta.sch.id">
        </div>
        <div id="fp-hint" style="font-size:.78rem;color:var(--ink-500);line-height:1.6"></div>`,
      onMount(s2) {
        s2.el.querySelector('[data-cancel]').addEventListener('click', () => s2.close());
        s2.el.querySelector('[data-submit]').addEventListener('click', async () => {
          s2.clearError();
          const v = formValues(s2.body);
          try {
            if (stage === 1) {
              if (!v.idNumber) return s2.error('ID pengguna wajib diisi.');
              idNumber = v.idNumber;
              s2.setBusy(true, 'Memverifikasi…');
              const r = await api('/auth/forgot-password', { method: 'POST', body: { idNumber: v.idNumber, email: v.email } });
              s2.setBusy(false);
              stage = 2;
              s2.el.querySelector('.sheet-sub').textContent = 'Langkah 2 dari 2 — kode & kata sandi baru';
              s2.body.innerHTML = `
                <div style="padding:13px 15px;border-radius:14px;background:var(--ok-50);color:#15803d;font-size:.84rem;font-weight:600;margin-bottom:16px;line-height:1.6">
                  Kode pemulihan dibuat. <b>Demo:</b> kode Anda <b>${esc(String(r.token))}</b>
                </div>
                <div class="lfield">
                  <label>Kode 6 angka</label>
                  <input class="input" name="token" data-autofocus placeholder="000000" maxlength="6" inputmode="numeric">
                </div>
                <div class="lfield">
                  <label>Kata sandi baru</label>
                  <input class="input" type="password" name="password" placeholder="minimal 6 karakter">
                </div>`;
              s2.el.querySelector('[data-submit]').textContent = 'Ubah Kata Sandi';
            } else {
              const v2 = formValues(s2.body);
              if (!/^\d{6}$/.test(v2.token || '')) return s2.error('Kode pemulihan harus 6 angka.');
              if (!v2.password || v2.password.length < 6) return s2.error('Kata sandi baru minimal 6 karakter.');
              s2.setBusy(true, 'Menyimpan…');
              await api('/auth/reset-password', { method: 'POST', body: { idNumber, token: v2.token, password: v2.password } });
              s2.close();
              toast('ok', 'Kata sandi diubah', 'Silakan masuk dengan kata sandi baru Anda.');
            }
          } catch (err) { s2.setBusy(false); s2.error(err.message); }
        });
      },
    });
    return s;
  }

  /* ============================== app shell ============================ */
  function startApp() {
    const login = document.getElementById('m-login');
    if (login) login.classList.add('hidden');
    const app = document.getElementById('m-app');
    app.classList.remove('hidden');

    /**
     * A parent account gets its own shell. It must not run the member
     * bootstrap: /mobile/* refuses the role, so calling it would only fill
     * the console with 403s.
     */
    if ((store.data.user || {}).role === 'parent' && global.MParent) {
      global.MParent.start();
      return;
    }

    if (!App.__bound) { bindDelegation(); App.__bound = true; }
    renderNav();
    renderHeader();
    go(store.data.lastRoute || 'home');
    refreshBadges();
    refreshEcToday();
    setInterval(refreshBadges, 60000);
    setInterval(refreshEcToday, 300000);
    registerSW();
  }

  /**
   * Today's extracurricular sessions. The floating QR button exists only when
   * there is something to scan for, so this drives its visibility.
   */
  async function refreshEcToday() {
    try {
      const me = await api('/mobile/me');
      store.set({ ecToday: me.ec_today || [] });
    } catch (e) { /* offline — keep what we have */ }
    updateFab();
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  function renderNav() {
    const host = document.getElementById('m-nav');
    host.innerHTML = `
      <div class="fnb">
        ${NAV.slice(0, 2).map(navBtn).join('')}
        <button class="fnb-fab" id="nav-fab" aria-label="Tindakan cepat">${icon('plus', 24, 2.6)}</button>
        ${NAV.slice(2).map(navBtn).join('')}
      </div>`;
    document.getElementById('nav-fab').addEventListener('click', openQuickActions);
    highlightNav();
  }

  /**
   * The profile shortcut is the avatar box in the header — the bottom bar
   * keeps its five icons. Re-rendered after a photo change.
   */
  function avatarHeadBtn() {
    const u = store.data.user || {};
    return `<button class="mhead-av-btn" id="hd-av" aria-label="Buka profil saya" title="Profil saya">
      <span class="mhead-av-wrap">${M.avatarHTML(u, 'mhead-av')}</span>
    </button>`;
  }

  /** Re-render the header avatar (after a profile photo change). */
  function refreshNavAvatar() {
    const old = document.getElementById('hd-av');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = avatarHeadBtn();
    old.replaceWith(tmp.firstElementChild);
    document.getElementById('hd-av').addEventListener('click', () => go('profile'));
  }

  /**
   * Single delegated handler for every [data-nav] link (bottom nav plus the
   * "see all" links inside cards). Delegation means the links keep working no
   * matter how many times a page re-renders.
   */
  function bindDelegation() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-nav]');
      if (!el) return;
      e.preventDefault();
      go(el.dataset.nav);
    });
  }
  function navBtn(n) {
    return `<button class="fnb-item" data-nav="${n.key}">
      <span class="fnb-ico">${icon(n.icon, 21, 2.1)}</span>
      <span>${esc(n.label)}</span>
    </button>`;
  }
  function highlightNav() {
    document.querySelectorAll('[data-nav]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.nav === current);
    });
    // The header avatar is the profile shortcut — light it up on that page.
    const hd = document.getElementById('hd-av');
    if (hd) hd.classList.toggle('is-active', current === 'profile');
  }

  function renderHeader() {
    const u = store.data.user || {};
    const s = store.data.settings || {};
    const sc = store.data.school || {};
    const off = M.offsetMinutes();
    const d = new Date(Date.now() + off * 60000);
    const hour = d.getUTCHours();
    const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

    document.getElementById('m-head').innerHTML = `
      <div class="mhead-row">
        ${avatarHeadBtn()}
        <div class="grow" style="min-width:0">
          <div class="mhead-meta">${esc(greet)},</div>
          <div class="mhead-name ellipsis">${esc(String(u.name || '').split(',')[0])}</div>
          <div class="mhead-meta">${esc(M.ROLE_LABEL[u.role] || '')}${u.class_name ? ' · ' + esc(u.class_name) : u.subject ? ' · ' + esc(u.subject) : ''}</div>
          <div class="pts">${icon('award', 12, 2.6)} ${M.num(u.score_points)} poin · ${esc((u.level && u.level.name) || 'Pemula')}</div>
        </div>
        <button class="mhead-ico" id="hd-bell" aria-label="Pengumuman">
          ${icon('bell', 19, 2.1)}<span class="dot hidden" id="hd-dot"></span>
        </button>
        <button class="mhead-ico" id="hd-refresh" aria-label="Muat ulang">${icon('refresh', 19, 2.1)}</button>
      </div>`;
    document.getElementById('hd-bell').addEventListener('click', () => openInfoSheet());
    document.getElementById('hd-av').addEventListener('click', () => go('profile'));
    highlightNav(); // the header is rebuilt, so re-apply the profile highlight
    document.getElementById('hd-refresh').addEventListener('click', () => {
      cache[current] = null;
      go(current, true);
      toast('info', 'Menyegarkan…', 'Mengambil data terbaru.');
    });
  }

  function go(key, force) {
    current = key;
    routeArg = '';
    store.set({ lastRoute: key });
    highlightNav();
    updateFab();
    const host = document.getElementById('m-view');
    host.innerHTML = M.skeletonCards(3);
    const page = PAGES[key] || PAGES.home;
    document.getElementById('m-head').className = 'mhead' + (page.tallHeader ? ' profile' : '');
    try {
      page.render(host, force);
    } catch (err) {
      console.error(err);
      host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Terjadi kesalahan', text: err.message });
    }
    window.scrollTo({ top: 0 });
  }

  function updateFab() {
    let fab = document.getElementById('m-fab');
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'm-fab';
      fab.className = 'fab';
      document.body.appendChild(fab);
    }
    // The floating button is reserved for extracurricular attendance, and it
    // only appears when the member actually has a session today.
    const ecToday = Array.isArray(store.data.ecToday) ? store.data.ecToday : [];
    if (!ecToday.length) {
      fab.hidden = true;
      fab.onclick = null;
      return;
    }
    fab.hidden = false;
    const many = ecToday.length > 1;
    fab.innerHTML = `${icon('qr', 23, 2.4)}${many ? `<span class="fab-badge">${ecToday.length}</span>` : ''}`;
    fab.className = 'fab is-ec';
    fab.setAttribute('aria-label', many
      ? `Absen ekstrakurikuler — ${ecToday.length} jadwal hari ini`
      : 'Absen ekstrakurikuler');
    fab.title = many ? `${ecToday.length} jadwal ekstrakurikuler hari ini` : ecToday[0].extracurricular_name || '';
    fab.onclick = () => {
      if (ecToday.length === 1) openEcAttendance(ecToday[0]);
      else openEcPicker();
    };
  }

  async function refreshBadges() {
    try {
      const r = await api('/mobile/requests');
      const pending = (r.counts && r.counts.pending) || 0;
      const dot = document.getElementById('hd-dot');
      if (dot) dot.classList.toggle('hidden', !pending);
    } catch (e) { /* silent */ }
  }

  App.logout = function () {
    store.clear();
    location.reload();
  };

  /* ========================= quick actions ============================= */
  function openQuickActions() {
    sheet({
      title: 'Tindakan cepat',
      sub: 'Pilih yang ingin Anda lakukan',
      footer: null,
      body: `
        <button class="pset-item" data-qa="scan">
          <span class="pset-ico" style="background:var(--brand-50);color:var(--brand)">${icon('qr', 19, 2.2)}</span>
          <span class="pset-main"><span class="pset-t">Pindai kode QR</span>
          <span class="pset-d">Absen masuk atau pulang melalui kode di sekolah</span></span>
          ${icon('chevronRight', 17, 2.3)}
        </button>
        <button class="pset-item" data-qa="request">
          <span class="pset-ico" style="background:var(--warn-50);color:var(--warn)">${icon('requests', 19, 2.2)}</span>
          <span class="pset-main"><span class="pset-t">Ajukan permohonan</span>
          <span class="pset-d">Sakit, agenda keluarga, dinas dan lainnya</span></span>
          ${icon('chevronRight', 17, 2.3)}
        </button>
        <button class="pset-item" data-qa="ec">
          <span class="pset-ico" style="background:var(--pink-50);color:#db2777">${icon('star', 19, 2.2)}</span>
          <span class="pset-main"><span class="pset-t">Absen ekstrakurikuler</span>
          <span class="pset-d">Rekam kehadiran dengan GPS Lock dan selfie</span></span>
          ${icon('chevronRight', 17, 2.3)}
        </button>`,
      onMount(s) {
        s.el.querySelector('[data-qa="scan"]').addEventListener('click', () => { s.close(); setTimeout(openScanner, 260); });
        s.el.querySelector('[data-qa="request"]').addEventListener('click', () => {
          s.close();
          setTimeout(() => openRequestForm(() => { cache.historyData = null; go('history', true); }), 260);
        });
        s.el.querySelector('[data-qa="ec"]').addEventListener('click', () => { s.close(); setTimeout(openEcPicker, 260); });
      },
    });
  }

  /* ============================ geolocation ============================ */
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Perangkat tidak mendukung GPS. Aktifkan layanan lokasi.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => reject(new Error(
          err.code === 1 ? 'Izin lokasi ditolak. Aktifkan GPS untuk melanjutkan.'
            : err.code === 2 ? 'Posisi tidak tersedia. Coba lagi beberapa saat.'
              : 'Waktu pencarian lokasi habis. Coba lagi.'
        )),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
      );
    });
  }
  function distMeters(a, b, c, d) {
    const R = 6371000, t = (x) => (x * Math.PI) / 180;
    const dLat = t(c - a), dLng = t(d - b);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function compressImage(input, maxDim, quality) {
    const dim = maxDim || 480;
    const q = quality == null ? 0.70 : quality;
    return new Promise((resolve, reject) => {
      function processSrc(src) {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > dim || h > dim) {
            if (w >= h) {
              h = Math.round((h * dim) / w);
              w = dim;
            } else {
              w = Math.round((w * dim) / h);
              h = dim;
            }
          }
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const cx = cv.getContext('2d');
          cx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', q));
        };
        img.onerror = () => reject(new Error('Gagal memproses gambar.'));
        img.src = src;
      }
      if (typeof input === 'string') {
        processSrc(input);
      } else if (input instanceof Blob || input instanceof File) {
        const rd = new FileReader();
        rd.onload = (e) => processSrc(e.target.result);
        rd.onerror = () => reject(new Error('Gagal membaca berkas.'));
        rd.readAsDataURL(input);
      } else {
        reject(new Error('Format berkas tidak didukung.'));
      }
    });
  }

  /* ============================ QR scanner ============================= */
  /* ===================== live selfie (camera only) ==================== */
  /**
   * Live selfie capture. The frame is fed straight from getUserMedia, so a
   * picture can only be produced by the camera at that moment — a file from
   * the gallery can never be attached. An oval face guide is drawn over the
   * preview to help with framing.
   */
  function openLiveSelfie(done) {
    let stream = null;
    let shot = '';
    let loop = null;

    const s = sheet({
      title: 'Ambil selfie',
      sub: 'Posisikan wajah di dalam bingkai oval',
      footer: null,
      body: `
        <div class="selfie-cam" id="sf-cam">
          <video id="sf-video" playsinline autoplay muted></video>
          <svg class="selfie-frame" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <mask id="sf-mask">
                <rect x="0" y="0" width="300" height="400" fill="#fff"/>
                <ellipse cx="150" cy="176" rx="88" ry="116" fill="#000"/>
              </mask>
            </defs>
            <rect x="0" y="0" width="300" height="400" fill="rgba(8,15,30,.58)" mask="url(#sf-mask)"/>
            <ellipse cx="150" cy="176" rx="88" ry="116" fill="none"
                     stroke="rgba(255,255,255,.95)" stroke-width="3" stroke-dasharray="12 9"/>
            <circle cx="150" cy="176" r="3" fill="rgba(255,255,255,.5)"/>
            <path d="M150 306v30" stroke="rgba(255,255,255,.85)" stroke-width="3" stroke-linecap="round"/>
            <path d="M104 336h92" stroke="rgba(255,255,255,.85)" stroke-width="3" stroke-linecap="round"/>
            <text x="150" y="374" text-anchor="middle" fill="rgba(255,255,255,.9)"
                  font-size="15" font-weight="700" font-family="system-ui,sans-serif">Pusatkan wajah di oval</text>
          </svg>
          <div class="selfie-hint" id="sf-hint">Menyiapkan kamera…</div>
        </div>
        <div class="selfie-prev hidden" id="sf-prev"></div>
        <div class="row gap-8" style="margin-top:14px">
          <button class="btn btn-sm grow hidden" id="sf-retake">${icon('refresh', 15, 2.3)} Ulangi</button>
          <button class="btn btn-sm btn-primary grow" id="sf-shoot">${icon('camera', 15, 2.3)} Ambil Foto</button>
          <button class="btn btn-sm btn-primary grow hidden" id="sf-use">${icon('check', 15, 2.3)} Gunakan Foto</button>
        </div>
        <div class="text-xs dim" style="margin-top:10px;line-height:1.65">
          ${icon('alert', 12, 2.4)} Foto diambil langsung dari kamera. Berkas dari galeri tidak dapat dilampirkan.
        </div>`,
      onMount(s2) {
        const video = s2.el.querySelector('#sf-video');
        const hint = s2.el.querySelector('#sf-hint');
        const camBox = s2.el.querySelector('#sf-cam');
        const prev = s2.el.querySelector('#sf-prev');
        const bShoot = s2.el.querySelector('#sf-shoot');
        const bUse = s2.el.querySelector('#sf-use');
        const bRetake = s2.el.querySelector('#sf-retake');

        function stop() {
          if (loop) { cancelAnimationFrame(loop); loop = null; }
          if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        }
        s2.close = ((orig) => function (r) { stop(); return orig.call(s2, r); })(s2.close);
        s2.el.querySelector('.modal-close').addEventListener('click', () => s2.close());

        async function start() {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            hint.className = 'selfie-hint err';
            hint.textContent = 'Kamera tidak tersedia pada perangkat ini.';
            bShoot.disabled = true;
            return;
          }
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
              audio: false,
            });
            video.srcObject = stream;
            await video.play().catch(() => {});
            hint.textContent = 'Kamera siap';
            hint.className = 'selfie-hint ok';
            hintWatch();
          } catch (err) {
            hint.className = 'selfie-hint err';
            hint.textContent = 'Kamera ditolak: ' + err.message;
            bShoot.disabled = true;
          }
        }

        /** Best-effort face detection — advisory only, never blocking. */
        function hintWatch() {
          const FD = global.FaceDetector;
          if (!FD || !video) return;
          let fd;
          try { fd = new FD({ fastMode: true, maxDetectedFaces: 1 }); } catch (e) { return; }
          const check = async () => {
            if (!stream) return;
            try {
              const faces = await fd.detect(video);
              if (!stream) return;
              if (faces && faces.length && !shot) {
                hint.textContent = 'Wajah terdeteksi — tekan Ambil Foto';
                hint.className = 'selfie-hint ok';
              }
            } catch (e) { /* ignore */ }
            loop = setTimeout(check, 900);
          };
          check();
        }

        function capture() {
          if (!video || !video.videoWidth) { toast('error', 'Kamera belum siap', 'Tunggu hingga pratinjau muncul.'); return; }
          const W = 480, H = Math.round((video.videoHeight / video.videoWidth) * W) || 640;
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          const cx = cv.getContext('2d');
          cx.translate(W, 0);      // mirror so it matches what the member saw
          cx.scale(-1, 1);
          cx.drawImage(video, 0, 0, W, H);
          shot = cv.toDataURL('image/jpeg', 0.70);
          prev.innerHTML = `<img src="${shot}" alt="Selfie">`;
          prev.classList.remove('hidden');
          camBox.classList.add('hidden');
          bShoot.classList.add('hidden');
          bUse.classList.remove('hidden');
          bRetake.classList.remove('hidden');
          hint.textContent = 'Periksa hasil foto sebelum digunakan';
          hint.className = 'selfie-hint';
        }

        function retake() {
          shot = '';
          prev.classList.add('hidden');
          camBox.classList.remove('hidden');
          bShoot.classList.remove('hidden');
          bUse.classList.add('hidden');
          bRetake.classList.add('hidden');
          hint.textContent = 'Kamera siap';
          hint.className = 'selfie-hint ok';
        }

        bShoot.addEventListener('click', capture);
        bRetake.addEventListener('click', retake);
        bUse.addEventListener('click', () => {
          if (!shot) return;
          const out = shot;
          s2.close();
          if (done) done(out);
        });
        start();
      },
    });
    return s;
  }

  /* ======================= kiosk QR scanning =========================== */
  /**
   * The kiosk shows a single QR that rotates every minute. The server decides
   * whether this scan is a check-in or a check-out by looking at today's
   * record, so one code serves both directions.
   */
  function parseKioskPayload(raw) {
    const t = String(raw || '').trim();
    if (!t) return null;
    // A URL produced by the kiosk:  .../scan.html?k=<token>
    try {
      if (/[?&]k=/.test(t)) {
        const u = new URL(t);
        const k = u.searchParams.get('k');
        if (k) return { token: k };
      }
    } catch (e) { /* not a URL — fall through */ }
    // A bare signed token (also accepting an "SAS1:" prefix).
    const m = t.match(/^(?:SAS1[|.:])?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (m) return { token: m[1] };
    // Nothing else is accepted: the school code is never used, so a foreign
    // barcode (a product code, a poster, a Wi-Fi login) can never send an
    // attendance on its own.
    return null;
  }

  /**
   * The camera decoder. `BarcodeDetector` is missing on iOS Safari and on
   * Firefox, so a bundled jsQR build is used as the fallback — the scanner
   * must actually work on a phone, otherwise "open the scanner" is a dead end.
   * Returns null when nothing was decoded.
   */
  let jsQRLoaded = null;
  function loadJsQR() {
    if (jsQRLoaded) return jsQRLoaded;
    jsQRLoaded = new Promise((resolve) => {
      if (global.jsQR) return resolve(global.jsQR);
      const s = document.createElement('script');
      s.src = '/vendor/jsQR.js';
      s.onload = () => resolve(global.jsQR || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return jsQRLoaded;
  }

  /** Decode one video frame through jsQR. */
  async function jsQRDecode(video) {
    const fn = await loadJsQR();
    if (!fn) return null;
    const w = 320;
    const h = Math.max(1, Math.round((video.videoHeight / (video.videoWidth || 1)) * w));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try { ctx.drawImage(video, 0, 0, w, h); } catch (e) { return null; }
    const img = ctx.getImageData(0, 0, w, h);
    try {
      const r = fn(img.data, w, h, { inversionAttempts: 'dontInvert' });
      return r && r.data ? r.data : null;
    } catch (e) { return null; }
  }

  /**
   * Classify the link so a scan knows whether it may fire on its own.
   * Network Information is used when the browser exposes it; otherwise a
   * single round trip to /api/health decides.
   */
  async function probeConnection() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const t = String(conn.effectiveType || '');
      if (conn.saveData || t === 'slow-2g' || t === '2g' || t === '3g') return { slow: true, how: 'network:' + (t || 'save-data') };
      if (t === '4g') return { slow: false, how: 'network:' + t };
    }
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const ms = Date.now() - t0;
      return { slow: !(r && r.ok) || ms > 1000, ms, how: 'ping' };
    } catch (e) {
      return { slow: true, ms: Date.now() - t0, how: 'ping-failed' };
    }
  }

  /**
   * The kiosk scanner. Only the QR rendered by the kiosk screen is accepted —
   * there is no school-code field any more. On a healthy link the scan records
   * the attendance by itself; on a slow link the decoded code is held and the
   * member presses "Proses Absen" to send it.
   */
  function openKioskScan() {
    let stream = null;
    let detector = null;
    let raf = null;
    let busy = false;
    let auto = true;      // set from the connection probe
    let held = null;      // credential waiting for the manual button
    let heldAt = 0;
    let tick = null;
    let scanning = false;

    const s = sheet({
      title: 'Pindai QR kiosk',
      sub: 'Hanya kode QR yang tampil di layar kiosk',
      footer: null,
      body: `
        <div class="scan-box" id="ks-box">
          <div class="scan-frame"><div class="scan-line"></div></div>
          <div class="selfie-hint" id="ks-hint">Menyiapkan kamera…</div>
        </div>
        <div class="scan-state" id="ks-state">
          <span class="scan-state-dot"></span>
          <span class="grow" id="ks-state-t">Memeriksa koneksi…</span>
        </div>
        <div id="ks-msg" style="margin-top:12px"></div>
        <button class="btn btn-primary btn-block hidden" id="ks-go" style="height:52px;border-radius:15px;margin-top:14px">
          ${icon('check', 17, 2.4)} Proses Absen
        </button>
        <button class="btn btn-block hidden" id="ks-again" style="height:46px;border-radius:15px;margin-top:10px">
          ${icon('refresh', 16, 2.4)} Pindai Ulang
        </button>
        <div class="text-xs dim" style="margin-top:12px;line-height:1.7">
          ${icon('alert', 12, 2.4)} Hanya kode QR kiosk yang diterima. Kode berganti setiap
          60 detik, sehingga tangkapan layar yang lama tidak berlaku.
        </div>`,
      onMount(s2) {
        const video = document.createElement('video');
        video.playsInline = true; video.muted = true; video.autoplay = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
        s2.el.querySelector('#ks-box').prepend(video);

        const hint = s2.el.querySelector('#ks-hint');
        const state = s2.el.querySelector('#ks-state');
        const stateT = s2.el.querySelector('#ks-state-t');
        const msg = s2.el.querySelector('#ks-msg');
        const goBtn = s2.el.querySelector('#ks-go');
        const againBtn = s2.el.querySelector('#ks-again');

        function say(text, tone) {
          msg.innerHTML = text
            ? `<div class="cio-status ${tone || ''}">${icon(tone === 'err' ? 'alert' : 'clock', 14, 2.4)} ${esc(text)}</div>`
            : '';
        }
        function setState(text, tone) {
          state.className = 'scan-state' + (tone ? ' ' + tone : '');
          stateT.textContent = text;
        }
        function stop() {
          scanning = false;
          if (raf) {
            cancelAnimationFrame(raf);
            clearTimeout(raf);
            raf = null;
          }
          if (tick) { clearInterval(tick); tick = null; }
          if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        }
        s2.close = ((orig) => function (r) { stop(); return orig.call(s2, r); })(s2.close);
        s2.el.querySelector('.modal-close').addEventListener('click', () => s2.close());

        /** Called after a failed attempt — let the member scan again. */
        function offerRescan(text) {
          say(text, 'err');
          againBtn.classList.remove('hidden');
          goBtn.classList.add('hidden');
          held = null;
          busy = false;
          if (detector && video) loop();
        }

        async function submit(cred) {
          if (busy) return;
          busy = true;
          stop();
          goBtn.disabled = true;
          say('Mengunci posisi GPS…');
          setState('Merekam kehadiran…', 'busy');
          let geo = null;
          try { geo = await getPosition(); } catch (e) { /* the server decides */ }
          say('Memproses absensi…');
          try {
            const d = await api('/public/scan-attend', {
              method: 'POST',
              body: Object.assign({}, cred, {
                lat: geo && geo.lat, lng: geo && geo.lng, accuracy: geo && geo.accuracy,
              }),
            });
            s2.close();
            attendanceSplash(d.mode, d.record, d.points);
            cache.homeData = null; cache.historyData = null;
            refreshEcToday();
            go('home', true);
          } catch (err) {
            busy = false;
            goBtn.disabled = false;
            const expired = /kedaluwarsa/i.test(err.message || '');
            if (expired) offerRescan('Kode QR sudah berganti. Pindai ulang kode yang tampil saat ini.');
            else offerRescan(err.message || 'Gagal mengirim absensi. Pindai ulang.');
          }
        }

        /** Hold the decoded credential for the manual button. */
        function hold(cred) {
          held = cred;
          heldAt = Date.now();
          busy = false;
          goBtn.classList.remove('hidden');
          goBtn.disabled = false;
          if (tick) clearInterval(tick);
          tick = setInterval(() => {
            const left = 55 - Math.floor((Date.now() - heldAt) / 1000);
            if (!held) { clearInterval(tick); tick = null; return; }
            if (left <= 0) {
              held = null;
              goBtn.classList.add('hidden');
              clearInterval(tick); tick = null;
              setState('Kode kedaluwarsa — arahkan kamera ke kode terbaru.', 'warn');
              say('');
              if ((detector || global.jsQR) && video) loop();
              return;
            }
            setState(`Kode terbaca — tekan Proses Absen (berlaku ${left} dtk)`, 'ok');
          }, 1000);
          setState('Kode terbaca — tekan Proses Absen', 'ok');
        }

        /**
         * One decode attempt. `detector` is the native BarcodeDetector when the
         * browser has it; otherwise a canvas frame is handed to jsQR. Anything
         * that is not a signed kiosk token is ignored, so a foreign barcode can
         * never trigger an attendance.
         */
        async function attemptDecode() {
          if (!video || video.readyState < 2) return null;
          if (detector) {
            try {
              const codes = await detector.detect(video);
              if (codes && codes.length) return codes[0].rawValue || null;
            } catch (e) { /* keep scanning */ }
            return null;
          }
          return await jsQRDecode(video);
        }

        async function loop() {
          if (busy || held || scanning) { raf = requestAnimationFrame(loop); return; }
          if (!video || video.readyState < 2) { raf = requestAnimationFrame(loop); return; }
          scanning = true;
          try {
            const raw = await attemptDecode();
            if (busy || held) return;
            const cred = parseKioskPayload(raw);
            if (cred && cred.token) {
              if (auto) await submit(cred);
              else hold(cred);
              return;
            }
          } catch (e) { /* keep scanning */ }
          finally { scanning = false; }
          // jsQR is CPU-bound: sample a few frames a second instead of all of them.
          raf = setTimeout(loop, detector ? 0 : 220);
        }

        async function start() {
          const BD = global.BarcodeDetector;
          if (BD) {
            try {
              const fmts = await BD.getSupportedFormats();
              if (fmts && fmts.includes('qr_code')) detector = new BD({ formats: ['qr_code'] });
            } catch (e) { detector = null; }
          }
          // iOS Safari and Firefox have no BarcodeDetector — load jsQR instead.
          if (!detector) await loadJsQR();

          const probe = await probeConnection();
          auto = !probe.slow;
          if (auto) {
            setState('Koneksi lancar — absen tercatat otomatis saat kode terbaca', 'ok');
          } else {
            setState('Koneksi lambat — pindai kode, lalu tekan Proses Absen', 'warn');
          }

          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            hint.className = 'selfie-hint err';
            hint.textContent = 'Kamera tidak tersedia pada perangkat ini.';
            return;
          }
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
            video.srcObject = stream;
            await video.play().catch(() => {});
            const engine = detector || global.jsQR;
            hint.className = 'selfie-hint ' + (engine ? 'ok' : 'err');
            hint.textContent = engine
              ? 'Arahkan kamera ke kode QR kiosk'
              : 'Pemindai QR tidak dapat dimuat. Periksa koneksi lalu buka ulang.';
            if (engine) loop();
          } catch (err) {
            hint.className = 'selfie-hint err';
            hint.textContent = 'Kamera tidak dapat diakses — izinkan kamera lalu buka ulang.';
          }
        }

        goBtn.addEventListener('click', () => {
          if (!held) return;
          submit(held);
        });
        againBtn.addEventListener('click', () => {
          againBtn.classList.add('hidden');
          say('');
          setState(auto
            ? 'Koneksi lancar — absen tercatat otomatis saat kode terbaca'
            : 'Koneksi lambat — pindai kode, lalu tekan Proses Absen', auto ? 'ok' : 'warn');
          if (!stream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
              .then((st) => { stream = st; video.srcObject = st; return video.play().catch(() => {}); })
              .then(() => { if (detector || global.jsQR) loop(); })
              .catch(() => {});
          } else if (detector || global.jsQR) {
            loop();
          }
        });

        start();
      },
    });
    return s;
  }

  /** Kept so older entry points keep working. */
  function openScanner() { return openKioskScan(); }

  /* ======================= check-in / check-out ======================== */
  /** The confirmation splash shown after any successful attendance record. */
  function attendanceSplash(mode, rec, points) {
    const settings = store.data.settings || {};
    const quotes = settings.splash_quotes || [];
    const specific = mode === 'checkin' ? settings.checkin_splash_quote : settings.checkout_splash_quote;
    const quote = specific || (quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : 'Terima kasih, tetap semangat!');
    const isLate = mode === 'checkin' && rec && rec.status === 'late';
    const at = mode === 'checkin' ? rec.check_in_at : rec.check_out_at;
    showSplash({
      iconHTML: `<div class="splash-ico">${mode === 'checkin' ? '🎉' : '🏠'}</div>`,
      title: mode === 'checkin' ? 'Absen masuk berhasil' : 'Absen pulang berhasil',
      sub: isLate ? 'Anda tercatat hadir terlambat' : (mode === 'checkin' ? 'Anda hadir tepat waktu' : 'Sampai jumpa esok!'),
      quote,
      time: M.fmtTime(at),
      badge: `${M.dow(rec.date)}, ${M.fmtDate(rec.date, true)}${points ? ` · +${points} poin` : ''}`,
      duration: 4200,
    });
    api('/mobile/me').then((me) => {
      store.set({ user: me.user, settings: me.settings, ecToday: me.ec_today || [] });
      renderHeader();
      updateFab();
    }).catch(() => {});
  }

  function doAttendance(mode, geo, method) {
    return new Promise(async (resolve) => {
      try {
        const body = Object.assign({ method: method || 'gps' }, geo || {});
        const d = mode === 'checkin'
          ? await api('/mobile/checkin', { method: 'POST', body })
          : await api('/mobile/checkout', { method: 'POST', body });
        const rec = d.record;
        attendanceSplash(mode, rec, d.points);
        resolve(rec);
      } catch (err) {
        toast('error', 'Gagal', err.message);
        resolve(null);
      }
    });
  }

  /* ========================= request form ============================== */
  function openRequestForm(done) {
    const types = ['Sickness', 'Family Agenda', 'Official Duty', 'Personal', 'Other'];
    const typeLabel = { Sickness: 'Sakit', 'Family Agenda': 'Agenda Keluarga', 'Official Duty': 'Dinas / Tugas', Personal: 'Keperluan Pribadi', Other: 'Lainnya' };
    const s = sheet({
      title: 'Ajukan permohonan',
      sub: 'Permohonan akan ditinjau administrator sekolah',
      okText: 'Kirim Permohonan',
      body: `
        <div class="lfield">
          <label>Jenis permohonan</label>
          <select class="select" name="type" data-autofocus style="height:50px;border-radius:15px">
            ${types.map((t) => `<option value="${t}">${typeLabel[t]}</option>`).join('')}
          </select>
        </div>
        <div class="lfield">
          <label>Perihal</label>
          <input class="input" name="title" placeholder="mis. Demam berdahak" style="height:50px;border-radius:15px">
        </div>
        <div class="row gap-8">
          <div class="lfield grow">
            <label>Tanggal mulai</label>
            <input class="input" type="date" name="from_date" value="${M.todayStr()}" style="height:50px;border-radius:15px">
          </div>
          <div class="lfield grow">
            <label>Tanggal selesai</label>
            <input class="input" type="date" name="to_date" value="${M.todayStr()}" style="height:50px;border-radius:15px">
          </div>
        </div>
        <div class="lfield">
          <label>Keterangan</label>
          <textarea class="textarea" name="details" rows="4" placeholder="Jelaskan alasan permohonan Anda…" style="border-radius:15px"></textarea>
        </div>`,
      onMount(s2) {
        s2.el.querySelector('[data-cancel]').addEventListener('click', () => s2.close());
        s2.el.querySelector('[data-submit]').addEventListener('click', async () => {
          s2.clearError();
          const v = formValues(s2.body);
          if (!v.title || v.title.trim().length < 3) return s2.error('Perihal permohonan minimal 3 karakter.');
          if (v.to_date < v.from_date) return s2.error('Tanggal selesai tidak boleh sebelum tanggal mulai.');
          s2.setBusy(true, 'Mengirim…');
          try {
            const r = await api('/mobile/requests', { method: 'POST', body: v });
            s2.close();
            toast('ok', 'Permohonan dikirim', r.message || 'Menunggu peninjauan administrator.');
            refreshBadges();
            if (done) done();
          } catch (err) { s2.setBusy(false); s2.error(err.message); }
        });
      },
    });
    return s;
  }

  /* ====================== extracurricular picker ======================= */
  async function openEcPicker() {
    let list = [];
    try { list = (await api('/mobile/extracurriculars')).items || []; } catch (e) { toast('error', 'Gagal', e.message); return; }
    const s = sheet({
      title: 'Absen ekstrakurikuler',
      sub: 'Pilih kegiatan yang Anda ikuti',
      footer: null,
      body: list.length ? list.map((ec) => `
        <button class="pset-item" data-ec="${ec.id}">
          <span class="pset-ico" style="background:var(--violet-50);color:#7c3aed">${icon('star', 19, 2.2)}</span>
          <span class="pset-main">
            <span class="pset-t">${esc(ec.name)}</span>
            <span class="pset-d">${(ec.schedule_days || []).join(', ')} · ${esc(ec.start_time)}–${esc(ec.end_time)} · ${esc(ec.room || '')}</span>
          </span>
          ${ec.today ? '<span class="badge badge-ok">Hari ini</span>' : icon('chevronRight', 17, 2.3)}
        </button>`).join('') : M.emptyBlock({ icon: 'star', title: 'Belum ada kegiatan', text: (store.data.user || {}).role === 'student' ? 'Anda belum terdaftar pada ekstrakurikuler. Hubungi administrator sekolah.' : 'Anda belum ditugaskan sebagai pembina ekstrakurikuler.' }),
      onMount(s2) {
        s2.el.querySelectorAll('[data-ec]').forEach((b) => b.addEventListener('click', () => {
          const ec = list.find((x) => x.id === b.dataset.ec);
          s2.close();
          // Prefer today's session so GPS Lock is measured against the right venue.
          const session = (ec.today_sessions || [])[0] || null;
          setTimeout(() => openEcAttendance(Object.assign({}, ec, {
            location_lat: session && session.place ? session.place.lat : ec.location_lat,
            location_lng: session && session.place ? session.place.lng : ec.location_lng,
            _scheduleId: session ? session.id : '',
            _placeName: session && session.place ? session.place.name : (ec.room || ''),
          })), 260);
        }));
      },
    });
    return s;
  }

  function openEcAttendance(raw) {
    // Accept either a full extracurricular object (from the picker) or a
    // compact "today's session" row (from the floating button).
    const ec = Object.assign({}, raw, {
      name: raw.extracurricular_name || raw.name || 'Kegiatan',
      _placeName: (raw.place && raw.place.name) || raw._placeName || raw.room || '',
      _scheduleId: raw._scheduleId || raw.id || '',
    });
    let geo = null;
    let selfie = '';
    const s = sheet({
      title: 'Absen ' + ec.name,
      sub: [ec._placeName || ec.room || '', (ec.schedule_days || []).join(', '), ec.start_time ? ec.start_time + '–' + ec.end_time : '']
        .filter(Boolean).join(' · '),
      okText: 'Kirim Kehadiran',
      body: `
        <div class="card" style="box-shadow:none;background:var(--ink-50);margin-bottom:14px">
          <div class="card-body" style="padding:14px">
            <div class="row between mb-8">
              <span class="semibold text-sm row gap-6">${icon('target', 15, 2.3)} GPS Lock</span>
              <span class="badge badge-muted" id="ec-badge">Belum terkunci</span>
            </div>
            <div class="text-xs muted mb-8">Posisi harus berada dalam radius kegiatan${ec._placeName ? ` · <b>${esc(ec._placeName)}</b>` : ''}</div>
            <button class="btn btn-sm btn-primary btn-block" id="ec-gps" style="height:44px">${icon('map', 15, 2.3)} Ambil Posisi GPS</button>
            <div class="mono text-xs mt-8" id="ec-gps-d">—</div>
          </div>
        </div>
        <div class="card" style="box-shadow:none;background:var(--ink-50);margin-bottom:14px">
          <div class="card-body" style="padding:14px">
            <div class="row between mb-8">
              <span class="semibold text-sm row gap-6">${icon('camera', 15, 2.3)} Foto selfie</span>
              <span class="badge badge-danger">Wajib · Live</span>
            </div>
            <div class="text-xs muted mb-8">Diambil langsung dari kamera dengan bingkai wajah — berkas dari galeri tidak dapat dipakai.</div>
            <div id="ec-selfie"></div>
            <button class="btn btn-sm btn-block" id="ec-shot" style="height:44px">${icon('camera', 15, 2.3)} Ambil Selfie</button>
          </div>
        </div>
        <div class="seg" id="ec-status">
          <button class="is-active" data-st="present">Hadir</button>
          <button data-st="absent">Tidak hadir</button>
        </div>`,
      onMount(s2) {
        let status = 'present';
        s2.el.querySelectorAll('#ec-status button').forEach((b) => b.addEventListener('click', () => {
          status = b.dataset.st;
          s2.el.querySelectorAll('#ec-status button').forEach((x) => x.classList.toggle('is-active', x === b));
        }));
        s2.el.querySelector('#ec-gps').addEventListener('click', async () => {
          s2.el.querySelector('#ec-badge').className = 'badge badge-warn';
          s2.el.querySelector('#ec-badge').textContent = 'Menautkan…';
          try {
            geo = await getPosition();
            const d = distMeters(geo.lat, geo.lng, ec.location_lat, ec.location_lng);
            const radius = (store.data.settings || {}).ec_radius_m || 60;
            const inside = d <= radius;
            s2.el.querySelector('#ec-badge').className = 'badge ' + (inside ? 'badge-ok' : 'badge-danger');
            s2.el.querySelector('#ec-badge').textContent = `${Math.round(d)} m · radius ${radius} m`;
            s2.el.querySelector('#ec-gps-d').textContent = `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}${geo.accuracy ? ' (±' + Math.round(geo.accuracy) + ' m)' : ''}`;
            toast(inside ? 'ok' : 'warn', inside ? 'GPS terkunci' : 'Di luar radius', `${Math.round(d)} m dari lokasi kegiatan.`);
          } catch (err) {
            s2.el.querySelector('#ec-badge').className = 'badge badge-danger';
            s2.el.querySelector('#ec-badge').textContent = 'Gagal';
            toast('error', 'GPS gagal', err.message);
          }
        });
        // Live capture only — a gallery file can never be attached.
        s2.el.querySelector('#ec-shot').addEventListener('click', () => {
          openLiveSelfie((dataUrl) => {
            selfie = dataUrl;
            s2.el.querySelector('#ec-selfie').innerHTML =
              `<img src="${selfie}" style="width:100%;border-radius:14px;display:block;margin-bottom:8px">`;
            s2.el.querySelector('#ec-shot').innerHTML = `${icon('camera', 15, 2.3)} Ubah Selfie`;
            toast('ok', 'Selfie tersimpan', 'Foto diambil langsung dari kamera.');
          });
        });
        s2.el.querySelector('[data-cancel]').addEventListener('click', () => s2.close());
        s2.el.querySelector('[data-submit]').addEventListener('click', async () => {
          s2.clearError();
          if (!geo) return s2.error('Kunci posisi GPS terlebih dahulu.');
          if (!selfie) return s2.error('Foto selfie wajib diambil langsung dari kamera.');
          s2.setBusy(true, 'Mengirim…');
          try {
            await api(`/mobile/extracurriculars/${ec.id}/attendance`, {
              method: 'POST',
              body: { status, gps_lat: geo.lat, gps_lng: geo.lng, gps_accuracy: geo.accuracy, selfie, ec_schedule_id: ec._scheduleId || '' },
            });
            s2.close();
            showSplash({
              iconHTML: `<div class="splash-ico">⚽</div>`,
              title: 'Kehadiran tercatat',
              sub: ec.name,
              quote: 'Teruslah berkarya — kehadiran Anda menginspirasi yang lain.',
              duration: 2600,
            });
            cache.historyData = null; cache.homeData = null;
            refreshEcToday();
          } catch (err) { s2.setBusy(false); s2.error(err.message); }
        });
      },
    });
    return s;
  }

  /* ===================== extracurricular detail ======================== */
  const EC_DOW_ORDER = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

  function ecScheduleLine(sc) {
    const bits = [`${esc(sc.start_time)}–${esc(sc.end_time)}`];
    if (sc.place && sc.place.name) bits.push(esc(sc.place.name));
    if (sc.grade_group) bits.push(`Kelompok ${esc(sc.grade_group)}`);
    if (sc.note) bits.push(esc(sc.note));
    return bits.join(' · ');
  }

  /** Full view of one assigned extracurricular. */
  async function openEcDetail(ecId) {
    const s = sheet({
      title: 'Ekstrakurikuler',
      sub: 'Memuat detail kegiatan…',
      footer: null,
      body: '<div class="empty-m"><span class="spinner" style="color:var(--brand)"></span></div>',
    });
    let d;
    try { d = await api('/mobile/extracurriculars/' + encodeURIComponent(ecId)); }
    catch (err) { s.body.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); return; }

    const ec = d.extracurricular || {};
    const u = store.data.user || {};
    const stats = d.my_stats || {};
    const today = d.today || [];
    s.el.querySelector('.sheet-title').textContent = ec.name || 'Ekstrakurikuler';
    s.el.querySelector('.sheet-sub').textContent = [ec.category, d.my_grade_group ? 'Kelompok ' + d.my_grade_group : '', d.my_role || ''].filter(Boolean).join(' · ');

    const schedules = (ec.schedules || []).slice().sort(
      (a, b) => EC_DOW_ORDER.indexOf(a.day) - EC_DOW_ORDER.indexOf(b.day) || String(a.start_time).localeCompare(String(b.start_time)));
    const grouped = {};
    schedules.forEach((sc) => { (grouped[sc.day] = grouped[sc.day] || []).push(sc); });

    s.body.innerHTML = `
      <div class="kpi-strip mb-16" style="margin-bottom:16px">
        <div class="kpi-cell"><div class="kpi-v">${stats.total || 0}</div><div class="kpi-l">Pertemuan</div></div>
        <div class="kpi-cell"><div class="kpi-v" style="color:var(--ok)">${stats.present || 0}</div><div class="kpi-l">Hadir</div></div>
        <div class="kpi-cell"><div class="kpi-v" style="color:var(--danger)">${stats.absent || 0}</div><div class="kpi-l">Tidak hadir</div></div>
        <div class="kpi-cell"><div class="kpi-v" style="color:var(--brand)">${stats.rate || 0}%</div><div class="kpi-l">Kehadiran</div></div>
      </div>

      ${ec.description ? `<p class="text-sm" style="line-height:1.7;color:var(--ink-600);margin-bottom:16px">${esc(ec.description)}</p>` : ''}

      <div class="ec-block">
        <div class="ec-block-t">${icon('calendar', 15, 2.3)} Jadwal kegiatan</div>
        ${schedules.length ? Object.keys(grouped).map((day) => `
          <div class="ec-sched-day">
            <div class="ec-sched-dow">${esc(day)}</div>
            ${grouped[day].map((sc) => `<div class="ec-sched-row">
              <b>${esc(sc.start_time)}–${esc(sc.end_time)}</b>
              <span>${esc(sc.place && sc.place.name ? sc.place.name : '—')}</span>
              ${sc.grade_group ? `<span class="badge badge-violet">${esc(sc.grade_group)}</span>` : ''}
            </div>`).join('')}
          </div>`).join('') : '<div class="day-empty">Belum ada jadwal yang diatur administrator.</div>'}
      </div>

      <div class="ec-block">
        <div class="ec-block-t">${icon('map', 15, 2.3)} Tempat kegiatan (${(ec.places || []).length})</div>
        ${(ec.places || []).length ? (ec.places || []).map((p) => `
          <div class="ec-place">
            <div class="grow" style="min-width:0">
              <div class="semibold text-sm">${esc(p.name)}</div>
              ${p.note ? `<div class="text-xs muted">${esc(p.note)}</div>` : ''}
            </div>
            <div class="mono text-xs muted">${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}</div>
          </div>`).join('') : '<div class="day-empty">Belum ada tempat yang didaftarkan.</div>'}
      </div>

      <div class="ec-block">
        <div class="ec-block-t">${icon('users', 15, 2.3)} Pembina &amp; pelatih (${(ec.mentors || []).length})</div>
        ${(ec.mentors || []).length ? (ec.mentors || []).map((m) => `
          <div class="hrow">
            ${M.avatarHTML({ name: m.user_name }, 'avatar')}
            <div class="hrow-m">
              <div class="t">${esc(m.user_name)}</div>
              <div class="s">${esc(M.ROLE_LABEL[m.user_role] || m.user_role || '')}</div>
            </div>
            <span class="badge ${m.is_primary ? 'badge-brand' : 'badge-muted'}">${esc(m.mentor_role || '')}</span>
          </div>`).join('') : '<div class="day-empty">Belum ada pembina yang ditugaskan.</div>'}
      </div>

      ${u.role === 'student' ? `
      <div class="ec-block">
        <div class="ec-block-t">${icon('users', 15, 2.3)} Anggota kelompok ${esc(d.my_grade_group || '—')} (${(d.peers || []).length})</div>
        ${(d.peers || []).length ? `<div class="chip-row">${(d.peers || []).slice(0, 24).map((p) => `<span class="chip" style="cursor:default">${esc(p.user_name)}</span>`).join('')}</div>`
        : '<div class="day-empty">Belum ada anggota lain pada kelompok Anda.</div>'}
      </div>` : `
      <div class="ec-block">
        <div class="ec-block-t">${icon('users', 15, 2.3)} Anggota terdaftar (${ec.member_count || 0})</div>
        ${(ec.members || []).length ? `<div class="chip-row">${(ec.members || []).slice(0, 24).map((p) => `<span class="chip" style="cursor:default">${esc(p.user_name)} · ${esc(p.grade_group || '')}</span>`).join('')}</div>`
        : '<div class="day-empty">Belum ada anggota terdaftar.</div>'}
      </div>`}

      <div class="ec-block">
        <div class="ec-block-t">${icon('attendance', 15, 2.3)} Riwayat kehadiran saya</div>
        ${(d.my_attendance || []).length ? (d.my_attendance || []).slice(0, 8).map((a) => `
          <div class="hrow">
            <div class="hrow-d">${M.fmtDate(a.date, true)}</div>
            <div class="hrow-m">
              <div class="t">${a.status === 'present' ? 'Hadir' : 'Tidak hadir'}</div>
              <div class="s">${esc(a.place_name || '')}${a.distance_m != null ? ' · ' + Math.round(a.distance_m) + ' m' : ''}</div>
            </div>
            <span class="badge ${a.status === 'present' ? 'badge-ok' : 'badge-danger'}">${a.has_selfie ? '📷' : ''}</span>
          </div>`).join('') : '<div class="day-empty">Belum ada rekam kehadiran.</div>'}
      </div>

      <button class="btn btn-primary btn-block btn-lg" id="ec-detail-att" style="border-radius:15px;margin-top:6px">
        ${icon('target', 17, 2.4)} ${today.length ? 'Absen sesi hari ini' : 'Rekam kehadiran'}
      </button>`;

    s.body.querySelector('#ec-detail-att').addEventListener('click', () => {
      s.close();
      setTimeout(() => openEcAttendance(Object.assign({}, ec, {
        location_lat: today.length && today[0].place ? today[0].place.lat : ec.location_lat,
        location_lng: today.length && today[0].place ? today[0].place.lng : ec.location_lng,
        _scheduleId: today.length ? today[0].id : '',
      })), 280);
    });
    return s;
  }

  /** All extracurriculars assigned to this member. */
  async function openMyExtracurriculars() {
    const s = sheet({
      title: 'Ekstrakurikuler saya',
      sub: 'Memuat kegiatan…',
      footer: null,
      body: '<div class="empty-m"><span class="spinner" style="color:var(--brand)"></span></div>',
    });
    let d;
    try { d = await api('/mobile/extracurriculars'); }
    catch (err) { s.body.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); return; }
    const items = d.items || [];
    s.el.querySelector('.sheet-sub').textContent = d.scope ? d.scope.label : '';
    s.body.innerHTML = items.length ? items.map((ec) => `
      <button class="pset-item" data-ec="${ec.id}">
        <span class="pset-ico" style="background:var(--pink-50);color:#db2777">${icon('star', 19, 2.2)}</span>
        <span class="pset-main">
          <span class="pset-t">${esc(ec.name)}</span>
          <span class="pset-d">${esc((ec.schedules || []).map((x) => x.day).filter((v, i2, a2) => a2.indexOf(v) === i2).join(', ') || 'Belum ada jadwal')} · ${esc(ec.my_grade_group || ec.my_role || '')}</span>
        </span>
        ${ec.today ? '<span class="badge badge-ok">Hari ini</span>' : icon('chevronRight', 17, 2.3)}
      </button>`).join('') : M.emptyBlock({
      icon: 'star',
      title: 'Belum ada kegiatan',
      text: (store.data.user || {}).role === 'student'
        ? 'Anda belum terdaftar pada ekstrakurikuler. Hubungi administrator sekolah.'
        : 'Anda belum ditugaskan sebagai pembina ekstrakurikuler.',
    });
    s.body.querySelectorAll('[data-ec]').forEach((b) => b.addEventListener('click', () => {
      s.close();
      setTimeout(() => openEcDetail(b.dataset.ec), 280);
    }));
    return s;
  }

  /** Weekly timetable — role scoped by the server. */
  /* ----------------- attachments & external links ---------------------- */
  /** Compact chips shown on a list card when the item carries media. */
  function mediaChips(r) {
    const a = r.attachment;
    const out = [];
    if (a && a.data) out.push(`<span class="mchip${isPdfAttachment(a) ? ' is-pdf' : ''}">${icon(isPdfAttachment(a) ? 'news' : 'paperclip', 12, 2.4)} ${esc(a.name || 'Lampiran')}</span>`);
    if (r.link_url) out.push(`<span class="mchip">${icon('link', 12, 2.4)} ${esc(r.link_label || M.hostOf(r.link_url))}</span>`);
    return out.length ? `<div class="mchip-row">${out.join('')}</div>` : '';
  }

  /** True when the attachment is a PDF — the usual case for a circular letter. */
  function isPdfAttachment(a) {
    return !!(a && a.data && (/^data:application\/pdf/i.test(a.data) || (a.type && /pdf/i.test(a.type)) || /\.pdf(\?.*)?$/i.test(a.data || a.name || '')));
  }

  /** Full attachment block: PDF gets a reader, images a preview, the rest a download row. */
  function attachmentBlock(r) {
    const a = r.attachment;
    if (!a || !a.data) return '';
    if (isPdfAttachment(a)) {
      return `<div class="mpdf">
        <div class="mpdf-head">
          <span class="mpdf-ico">${icon('paperclip', 15, 2.4)}</span>
          <span class="grow" style="min-width:0">
            <span class="mpdf-n ellipsis">${esc(a.name || 'Dokumen PDF')}</span>
            <span class="mpdf-s">PDF · ${esc(M.fileSize(a.size))}</span>
          </span>
          <a class="btn btn-sm" href="${esc(a.data)}" download="${esc(a.name || 'dokumen.pdf')}" target="_blank" rel="noopener">${icon('download', 14, 2.4)} Unduh</a>
        </div>
        <iframe class="mpdf-frame" src="${esc(a.data)}" title="${esc(a.name || 'Dokumen PDF')}"></iframe>
        <div class="mpdf-foot">${icon('info', 12, 2.4)} Jika pratinjau tidak muncul, gunakan tombol Unduh untuk membuka berkas.</div>
      </div>`;
    }
    if (M.isImageAttachment(a)) {
      return `<div class="mattach">
        <img class="mattach-img" src="${esc(a.data)}" alt="${esc(a.name || 'lampiran')}">
        <div class="mattach-bar">
          <span class="grow ellipsis">${icon('paperclip', 13, 2.4)} ${esc(a.name || 'Gambar')} · ${esc(M.fileSize(a.size))}</span>
          <a class="btn btn-sm" href="${esc(a.data)}" download="${esc(a.name || 'lampiran')}" target="_blank" rel="noopener">${icon('download', 14, 2.4)} Unduh</a>
        </div>
      </div>`;
    }
    return `<a class="mfile" href="${esc(a.data)}" download="${esc(a.name || 'lampiran')}" target="_blank" rel="noopener">
      <span class="mfile-ico">${icon('paperclip', 18, 2.3)}</span>
      <span class="grow" style="min-width:0">
        <span class="mfile-n ellipsis">${esc(a.name || 'Lampiran')}</span>
        <span class="mfile-s">${esc(a.type || 'Berkas')} · ${esc(M.fileSize(a.size))}</span>
      </span>
      ${icon('download', 17, 2.3)}
    </a>`;
  }

  /** External link row — opens in a new tab. */
  function linkBlock(r) {
    if (!r.link_url) return '';
    return `<a class="mlink" href="${esc(r.link_url)}" target="_blank" rel="noopener">
      <span class="mlink-ico">${icon('external', 17, 2.3)}</span>
      <span class="grow" style="min-width:0">
        <span class="mlink-n ellipsis">${esc(r.link_label || 'Buka tautan')}</span>
        <span class="mlink-s">${esc(M.hostOf(r.link_url))}</span>
      </span>
      ${icon('chevronRight', 16, 2.4)}
    </a>`;
  }

  function detailMeta(rows) {
    return `<div class="mmeta">${rows.map((r) => `<div><span>${esc(r[0])}</span><b>${r[1]}</b></div>`).join('')}</div>`;
  }

  /* --------------------------- detail pages ---------------------------- */
  /** Detail page for an announcement. */
  function openAnnouncementDetail(a) {
    return sheet({
      title: 'Detail pengumuman',
      sub: a.title,
      footer: null,
      body: `
        <div class="mhero" style="--tone:var(--brand-50);--fg:var(--brand)">
          <span class="mhero-ico">${icon('megaphone', 20, 2.2)}</span>
          <div class="grow" style="min-width:0">
            <div class="mhero-t">${esc(a.title)}</div>
            <div class="mhero-s">${esc(a.audience || 'Semua')}${a.is_pinned ? ' · 📌 Disematkan' : ''}</div>
          </div>
        </div>
        ${detailMeta([
          ['Tanggal', M.fmtDate(a.date)],
          ['Waktu', esc(a.time || '—')],
          ['Lokasi', esc(a.location || '—')],
        ])}
        <div class="mbody-text">${esc(a.details || '')}</div>
        ${attachmentBlock(a)}
        ${linkBlock(a)}
        <div class="text-xs dim" style="margin-top:14px">Diterbitkan oleh ${esc(a.author || 'Administrator')} · ${esc(M.timeAgo(a.created_at))}</div>`,
    });
  }

  /** Detail page for a news item — opening it counts as a view. */
  async function openNewsDetail(n) {
    let item = n;
    try {
      const r = await api('/mobile/news/' + n.id + '/view', { method: 'POST' });
      if (r && typeof r.views === 'number') item = Object.assign({}, n, { views: r.views });
    } catch (e) { /* offline — show the cached copy */ }
    return sheet({
      title: 'Detail berita',
      sub: item.title,
      footer: null,
      body: `
        <div class="mhero" style="--tone:var(--info-50);--fg:var(--info)">
          <span class="mhero-ico">${icon('news', 20, 2.2)}</span>
          <div class="grow" style="min-width:0">
            <div class="mhero-t">${esc(item.title)}</div>
            <div class="mhero-s">${esc(item.category || 'Umum')} · ${M.num(item.views || 0)} kali dilihat</div>
          </div>
        </div>
        ${detailMeta([
          ['Tanggal', M.fmtDate(item.date)],
          ['Waktu', esc(item.time || '—')],
          ['Penulis', esc(item.author || '—')],
        ])}
        <div class="mbody-text">${esc(item.details || '')}</div>
        ${attachmentBlock(item)}
        ${linkBlock(item)}
        <div class="text-xs dim" style="margin-top:14px">Diterbitkan ${esc(M.timeAgo(item.created_at))}</div>`,
    });
  }

  /** Open the right detail page for a calendar/list row. */
  function openMediaDetail(kind, item) {
    if (kind === 'news') openNewsDetail(item);
    else openAnnouncementDetail(item);
  }

  /* ------------------------------ info sheet --------------------------- */
  let infoTab = 'ann';

  /**
   * Pengumuman & Berita live behind the bell in the header — they are not a
   * tab in the bottom bar. Tapping a row opens its detail page.
   */
  async function openInfoSheet(preferTab) {
    if (preferTab) infoTab = preferTab;
    const s = sheet({
      title: 'Informasi sekolah',
      sub: 'Memuat…',
      footer: null,
      body: '<div class="empty-m"><span class="spinner" style="color:var(--brand)"></span></div>',
    });
    let payload = cache.infoData;
    if (!payload) {
      try {
        const [anns, news] = await Promise.all([
          api('/mobile/announcements').then((r) => r.items || []),
          api('/mobile/news').then((r) => r.items || []),
        ]);
        payload = { anns, news };
        cache.infoData = payload;
      } catch (err) {
        s.body.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message });
        return s;
      }
    }
    draw();

    function draw() {
      const anns = payload.anns;
      const news = payload.news;
      const sub = s.el.querySelector('.sheet-sub');
      if (sub) sub.textContent = infoTab === 'ann' ? `${anns.length} pengumuman untuk Anda` : `${news.length} berita terbaru`;
      s.body.innerHTML = `
        <div class="seg" id="i-tab">
          <button data-tab="ann" class="${infoTab === 'ann' ? 'is-active' : ''}">Pengumuman${anns.length ? ` (${anns.length})` : ''}</button>
          <button data-tab="news" class="${infoTab === 'news' ? 'is-active' : ''}">Berita${news.length ? ` (${news.length})` : ''}</button>
        </div>
        <div id="i-body"></div>`;
      const body = s.body.querySelector('#i-body');

      if (infoTab === 'ann') {
        body.innerHTML = anns.length ? `<div class="mlist">${anns.map((a) => `
          <div class="mitem" data-ann="${a.id}">
            <span class="mitem-ico" style="background:var(--brand-50);color:var(--brand)">${icon('megaphone', 17, 2.2)}</span>
            <div class="mitem-main">
              <div class="mitem-t">${esc(a.title)}</div>
              <div class="mitem-m">
                ${a.is_pinned ? '<span class="badge badge-warn">📌</span>' : ''}
                <span>${M.fmtDate(a.date, true)}</span>
                ${a.time ? `<span>· ${esc(a.time)}</span>` : ''}
                ${a.location ? `<span>· ${esc(a.location)}</span>` : ''}
              </div>
              <div class="mitem-d clamp">${esc(a.details || '')}</div>
              ${mediaChips(a)}
            </div>
          </div>`).join('')}</div>`
          : M.emptyBlock({ icon: 'megaphone', title: 'Belum ada pengumuman', text: 'Pengumuman dari sekolah akan tampil di sini.' });
        body.querySelectorAll('[data-ann]').forEach((b) => b.addEventListener('click', () => {
          const a = anns.find((x) => x.id === b.dataset.ann);
          if (a) openAnnouncementDetail(a);
        }));
      } else {
        body.innerHTML = news.length ? `<div class="mlist">${news.map((n) => `
          <div class="mitem" data-news="${n.id}">
            <span class="mitem-ico" style="background:var(--info-50);color:var(--info)">${icon('news', 17, 2.2)}</span>
            <div class="mitem-main">
              <div class="mitem-t">${esc(n.title)}</div>
              <div class="mitem-m">
                <span class="badge badge-info">${esc(n.category || 'Umum')}</span>
                <span>${M.fmtDate(n.date, true)}</span>
                <span class="row gap-4">${icon('eye', 12, 2.4)} ${M.num(n.views || 0)}</span>
              </div>
              <div class="mitem-d clamp">${esc(n.details || '')}</div>
              ${mediaChips(n)}
            </div>
          </div>`).join('')}</div>`
          : M.emptyBlock({ icon: 'news', title: 'Belum ada berita', text: 'Berita sekolah akan tampil di sini.' });
        body.querySelectorAll('[data-news]').forEach((b) => b.addEventListener('click', () => {
          const n = news.find((x) => x.id === b.dataset.news);
          if (n) openNewsDetail(n);
        }));
      }

      s.body.querySelectorAll('#i-tab button').forEach((b) => b.addEventListener('click', () => {
        infoTab = b.dataset.tab;
        s.body.querySelectorAll('#i-tab button').forEach((x) => x.classList.toggle('is-active', x === b));
        draw();
      }));
    }
    return s;
  }

  /** The weekly schedule is a tab now — this keeps older links working. */
  function openWeekSchedule() { go('schedule'); }

  /* =============================== PAGES =============================== */
  const PAGES = {};

  /* ------------------------------- home -------------------------------- */
  PAGES.home = {
    tallHeader: true,
    async render(host, force) {
      let d = cache.homeData;
      if (!d || force) {
        host.innerHTML = M.skeletonCards(3);
        try { d = await api('/mobile/dashboard'); }
        catch (err) { return host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); }
        cache.homeData = d;
      }
      this.build(host, d);
    },

    build(host, d) {
      const u = store.data.user || {};
      const today = d.today_record;
      const checkedIn = !!(today && today.check_in_at);
      const checkedOut = !!(today && today.check_out_at);
      const s = store.data.settings || {};
      const week = d.week || { days: [], counts: {}, rate: 0 };
      const st = d.stats || {};

      const cioClass = checkedOut ? 'cio is-done is-out' : checkedIn ? 'cio is-done' : 'cio';
      const cioIco = checkedOut ? '🏠' : checkedIn ? '✅' : '👆';
      const cioLabel = checkedOut ? 'Selesai' : checkedIn ? 'Absen Pulang' : 'Absen Masuk';
      const cioSub = checkedOut ? 'Hari ini selesai' : checkedIn ? 'Tekan untuk pulang' : 'Tekan untuk masuk';

      const statusText = checkedOut
        ? `Masuk ${M.fmtTime(today.check_in_at)} · Pulang ${M.fmtTime(today.check_out_at)}`
        : checkedIn
          ? `Masuk ${M.fmtTime(today.check_in_at)} · ${today.status === 'late' ? 'terlambat' : 'tepat waktu'}`
          : 'Anda belum absen hari ini';

      host.innerHTML = `
        <div class="mcard">
          <div class="cio-wrap">
            <div class="cio-stage" id="cio-stage">
              <button class="${cioClass}" id="cio-btn" ${checkedOut ? 'disabled' : ''}>
                <div class="cio-inner">
                  <div class="cio-ico">${cioIco}</div>
                  <div class="cio-label">${cioLabel}</div>
                  <div class="cio-sub">${cioSub}</div>
                </div>
              </button>
            </div>
            <div class="cio-status ${checkedIn ? (today.status === 'late' ? 'warn' : 'ok') : ''}" id="cio-status">
              ${icon(checkedIn ? 'check' : 'clock', 14, 2.4)} ${esc(statusText)}
            </div>
            <div class="cio-meta">
              <div><b>${M.fmtTime(today && today.check_in_at) || '--:--'}</b><span>Masuk</span></div>
              <div><b>${M.fmtTime(today && today.check_out_at) || '--:--'}</b><span>Pulang</span></div>
              <div><b>${today && today.work_hours ? today.work_hours + ' j' : '—'}</b><span>Jam kerja</span></div>
            </div>
            <div class="pull-hint" style="margin-top:8px">
              ${icon('map', 11, 2.4)} Radius ${s.checkin_radius_m || 120} m · GPS ${s.require_gps ? 'wajib' : 'opsional'}
            </div>
          </div>
        </div>

        <div class="mstats" style="margin-bottom:14px">
          <div class="mstat"><b style="color:var(--ok)">${st.present || 0}</b><span>Hadir</span></div>
          <div class="mstat"><b style="color:var(--accent)">${st.late || 0}</b><span>Terlambat</span></div>
          <div class="mstat"><b>${st.total || 0}</b><span>Total</span></div>
          <div class="mstat"><b style="color:#db2777">${st.ec || 0}</b><span>Ekskul</span></div>
        </div>

        <div class="mcard">
          <div class="mcard-t">
            <h3>Minggu ini</h3>
            <button class="more" data-nav="history">Lihat semua →</button>
          </div>
          <div class="week">
            ${week.days.map((x) => {
              const cls = x.status === 'present' ? 'p' : x.status === 'late' ? 'l' : x.status === 'leave' ? 'l' : 'a';
              const isToday = x.date === d.date;
              return `<div class="week-d">
                <div class="week-lbl">${M.dowShort(x.date)}</div>
                <div class="week-dot ${cls} ${isToday ? 't' : ''}">${x.date.slice(8)}</div>
              </div>`;
            }).join('')}
          </div>
          <div class="pull-hint" style="margin-top:10px">
            Tingkat kehadiran minggu ini <b style="color:var(--brand)">${week.rate}%</b>
          </div>
        </div>

        ${scheduleCard(d)}

        <div class="mcard">
          <div class="mcard-t">
            <h3>Pengumuman</h3>
            <button class="more" data-info-open="ann">Semua →</button>
          </div>
          ${(d.announcements || []).length ? `<div class="mlist">${(d.announcements || []).slice(0, 3).map((a) => `
            <div class="mitem" data-ann="${a.id}">
              <span class="mitem-ico" style="background:var(--brand-50);color:var(--brand)">${icon('megaphone', 17, 2.2)}</span>
              <div class="mitem-main">
                <div class="mitem-t">${esc(a.title)}</div>
                <div class="mitem-m"><span>${M.fmtDate(a.date, true)}</span><span>·</span><span>${esc(a.location || '')}</span></div>
                <div class="mitem-d clamp">${esc(a.details)}</div>
                ${mediaChips(a)}
              </div>
            </div>`).join('')}</div>`
            : M.emptyBlock({ icon: 'megaphone', title: 'Belum ada pengumuman', text: 'Pengumuman sekolah akan tampil di sini.' })}
        </div>

        <div class="mcard">
          <div class="mcard-t">
            <h3>Berita sekolah</h3>
            <button class="more" data-info-open="news">Semua →</button>
          </div>
          ${(d.news || []).length ? `<div class="mlist">${(d.news || []).slice(0, 2).map((n) => `
            <div class="mitem" data-news="${n.id}">
              <span class="mitem-ico" style="background:var(--info-50);color:var(--info)">${icon('news', 17, 2.2)}</span>
              <div class="mitem-main">
                <div class="mitem-t">${esc(n.title)}</div>
                <div class="mitem-m"><span class="badge badge-info">${esc(n.category)}</span><span>${M.fmtDate(n.date, true)}</span></div>
                <div class="mitem-d clamp">${esc(n.details)}</div>
                ${mediaChips(n)}
              </div>
            </div>`).join('')}</div>`
            : M.emptyBlock({ icon: 'news', title: 'Belum ada berita', text: 'Berita terbaru sekolah akan tampil di sini.' })}
        </div>

        <div class="mcard">
          <div class="mcard-t">
            <h3>Agenda mendatang</h3>
            <button class="more" data-nav="calendar">Kalender →</button>
          </div>
          ${(d.events || []).length ? `<div class="mlist">${(d.events || []).slice(0, 3).map((e) => `
            <div class="mitem">
              <span class="mitem-ico" style="background:var(--violet-50);color:#7c3aed">${icon('calendar', 17, 2.2)}</span>
              <div class="mitem-main">
                <div class="mitem-t">${esc(e.title)}</div>
                <div class="mitem-m"><span>${M.fmtDate(e.date, true)}${e.end_date !== e.date ? ' – ' + M.fmtDate(e.end_date, true) : ''}</span>
                <span class="badge badge-muted">${esc(e.type)}</span></div>
              </div>
            </div>`).join('')}</div>`
            : M.emptyBlock({ icon: 'calendar', title: 'Tidak ada agenda', text: 'Kalender akademik masih kosong.' })}
        </div>

        ${(d.extracurriculars || []).length ? `
        <div class="mcard">
          <div class="mcard-t"><h3>${u.role === 'student' ? 'Ekstrakurikuler saya' : 'Ekstrakurikuler binaan'}</h3>
            <button class="more" id="home-ec-all">Semua →</button></div>
          <div class="mlist">
            ${(d.extracurriculars || []).slice(0, 4).map((e) => `
              <div class="mitem" data-ec="${e.id}">
                <span class="mitem-ico" style="background:var(--pink-50);color:#db2777">${icon('star', 17, 2.2)}</span>
                <div class="mitem-main">
                  <div class="mitem-t">${esc(e.name)}</div>
                  <div class="mitem-m">
                    ${e.today ? '<span class="badge badge-ok">Ada jadwal hari ini</span>' : ''}
                    <span>${esc((e.schedules || []).map((x) => x.day).filter((v, i2, a2) => a2.indexOf(v) === i2).slice(0, 3).join(', ') || 'Belum ada jadwal')}</span>
                    ${e.my_grade_group ? `<span class="badge badge-violet">${esc(e.my_grade_group)}</span>` : ''}
                  </div>
                </div>
              </div>`).join('')}
          </div>
          ${(d.extracurriculars || []).some((e) => e.today) ? `
          <button class="btn btn-sm btn-primary btn-block" id="home-ec-absen" style="margin-top:12px;height:42px">
            ${icon('target', 15, 2.3)} Absen ekstrakurikuler hari ini
          </button>` : ''}
        </div>` : ''}`;

      /* interactions */
      const btn = host.querySelector('#cio-btn');
      if (btn && !checkedOut) btn.addEventListener('click', openKioskScan);
      if (host.querySelector('#home-ec-all')) host.querySelector('#home-ec-all').addEventListener('click', openMyExtracurriculars);
      if (host.querySelector('#home-ec-absen')) host.querySelector('#home-ec-absen').addEventListener('click', openEcPicker);
      if (host.querySelector('#home-sched')) host.querySelector('#home-sched').addEventListener('click', openWeekSchedule);
      host.querySelectorAll('[data-info-open]').forEach((b) => b.addEventListener('click', () => openInfoSheet(b.dataset.infoOpen)));
      host.querySelectorAll('[data-ann]').forEach((b) => b.addEventListener('click', () => {
        const a = (d.announcements || []).find((x) => x.id === b.dataset.ann);
        if (a) openAnnouncementDetail(a);
      }));
      host.querySelectorAll('[data-news]').forEach((b) => b.addEventListener('click', () => {
        const nItem = (d.news || []).find((x) => x.id === b.dataset.news);
        if (nItem) openNewsDetail(nItem);
      }));
      host.querySelectorAll('[data-ec]').forEach((b) => b.addEventListener('click', () => openEcDetail(b.dataset.ec)));
      setupTilt(host);
    },
  };

  /**
   * "Today's schedule" card. The server already filtered the rows by role, so
   * a student sees their class timetable, a teacher their teaching load and an
   * employee nothing beyond general information.
   */
  function scheduleCard(d) {
    const u = store.data.user || {};
    const sc = d.schedule || {};
    const cls = sc.class_schedule || [];
    const ec = sc.ec_schedule || [];
    if (u.role === 'employee') return '';
    if (!cls.length && !ec.length) return `
      <div class="mcard">
        <div class="mcard-t"><h3>Jadwal hari ini</h3><span class="badge badge-muted">${esc(sc.day || '')}</span></div>
        <div class="day-empty">Tidak ada jadwal untuk Anda hari ini.</div>
      </div>`;
    const rows = [
      ...cls.map((c) => ({
        time: `${c.start_time}–${c.end_time}`,
        title: c.subject || 'Kegiatan Kelas',
        sub: [c.class_name ? 'Kelas ' + c.class_name : '', c.room, c.teacher_name].filter(Boolean).join(' · '),
        tone: 'var(--brand-50)', color: 'var(--brand)', ic: 'school',
      })),
      ...ec.map((c) => ({
        time: `${c.start_time}–${c.end_time}`,
        title: c.extracurricular_name,
        sub: [c.grade_group, c.place && c.place.name].filter(Boolean).join(' · '),
        tone: 'var(--pink-50)', color: '#db2777', ic: 'star',
      })),
    ].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return `
      <div class="mcard">
        <div class="mcard-t">
          <h3>${u.role === 'student' ? 'Jadwal hari ini' : 'Jadwal mengajar hari ini'}</h3>
          <button class="more" id="home-sched">Minggu ini →</button>
        </div>
        <div class="mlist">
          ${rows.map((r) => `
            <div class="mitem">
              <span class="mitem-ico" style="background:${r.tone};color:${r.color}">${icon(r.ic, 17, 2.2)}</span>
              <div class="mitem-main">
                <div class="mitem-t">${esc(r.title)}</div>
                <div class="mitem-m"><span class="mitem-time">${esc(r.time)}</span>${r.sub ? `<span>· ${esc(r.sub)}</span>` : ''}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function setupTilt(host) {
    const stage = host.querySelector('#cio-stage');
    const btn = host.querySelector('#cio-btn');
    if (!stage || !btn) return;
    function move(e) {
      const r = stage.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      const x = (p.clientX - r.left) / r.width - 0.5;
      const y = (p.clientY - r.top) / r.height - 0.5;
      btn.style.transform = `rotateY(${(x * 22).toFixed(2)}deg) rotateX(${(-y * 22).toFixed(2)}deg) translateY(-3px)`;
    }
    function reset() { btn.style.transform = ''; }
    stage.addEventListener('mousemove', move);
    stage.addEventListener('mouseleave', reset);
    stage.addEventListener('touchmove', move, { passive: true });
    stage.addEventListener('touchend', reset);
  }

  /* ------------------------------ calendar ----------------------------- */
  PAGES.calendar = {
    /** Shared month cursor, initialised to the school's current month. */
    cursor() {
      if (!this._cursor) {
        const n = new Date(Date.now() + M.offsetMinutes() * 60000);
        this._cursor = { y: n.getUTCFullYear(), m: n.getUTCMonth() };
      }
      return this._cursor;
    },

    async render(host, force) {
      let events = cache.calendarData;
      if (!events || force) {
        host.innerHTML = M.skeletonCards(2);
        try { events = (await api('/mobile/events')).items || []; }
        catch (err) { return host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); }
        cache.calendarData = events;
      }
      this.build(host, events);
    },

    build(host, events) {
      const cursor = this.cursor();
      renderMonth();

      function renderMonth() {
        const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
        const startDow = first.getUTCDay();
        const dim = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
        const todayIso = M.todayStr();
        const cells = [];
        for (let i = 0; i < startDow; i++) cells.push({ out: true });
        for (let dd = 1; dd <= dim; dd++) {
          const iso = `${cursor.y}-${M.pad(cursor.m + 1)}-${M.pad(dd)}`;
          const evs = events.filter((e) => iso >= e.date && iso <= (e.end_date || e.date));
          const isHoliday = evs.some((e) => e.type === 'holiday');
          const isExam = evs.some((e) => e.type === 'exam');
          const cls = evs.length ? (isHoliday ? 'holiday' : isExam ? 'exam' : 'has') : '';
          cells.push({ out: false, iso, day: dd, evs, cls, today: iso === todayIso });
        }
        while (cells.length % 7 !== 0) cells.push({ out: true });

        const monthEvents = events.filter((e) => {
          const end = e.end_date || e.date;
          return end >= `${cursor.y}-${M.pad(cursor.m + 1)}-01` && e.date <= `${cursor.y}-${M.pad(cursor.m + 1)}-${M.pad(dim)}`;
        }).sort((a, b) => (a.date < b.date ? -1 : 1));

        host.innerHTML = `
          <div class="mcard">
            <div class="mcard-t">
              <button class="icon-btn btn-sm" id="cal-prev">${icon('chevronLeft', 16, 2.4)}</button>
              <h3 style="flex:1;text-align:center">${M.MONTHS[cursor.m]} ${cursor.y}</h3>
              <button class="icon-btn btn-sm" id="cal-next">${icon('chevronRight', 16, 2.4)}</button>
            </div>
            <div class="mcal-head">${M.DAYS_SHORT.map((x) => `<div class="mcal-dow">${x}</div>`).join('')}</div>
            <div class="mcal">
              ${cells.map((c) => c.out ? '<div class="mcal-c out"></div>' :
                `<div class="mcal-c ${c.cls} ${c.today ? 'today' : ''}" data-day="${c.iso}">
                  ${c.day}${c.evs.length ? '<span class="pip"></span>' : ''}
                </div>`).join('')}
            </div>
            <div class="chip-row mt-12" style="margin-top:12px">
              <span class="chip" style="cursor:default"><i class="badge-dot" style="background:var(--brand)"></i>Akademik</span>
              <span class="chip" style="cursor:default"><i class="badge-dot" style="background:var(--danger)"></i>Ujian</span>
              <span class="chip" style="cursor:default"><i class="badge-dot" style="background:var(--ok)"></i>Libur</span>
              <span class="chip" style="cursor:default"><i class="badge-dot" style="background:var(--warn)"></i>Rapat</span>
            </div>
          </div>

          <div class="mcard">
            <div class="mcard-t">
              <h3>Agenda bulan ini</h3>
              <span class="badge badge-brand">${monthEvents.length}</span>
            </div>
            ${monthEvents.length ? `<div class="mlist">${monthEvents.map((e) => {
              const tone = { academic: ['var(--brand-50)', 'var(--brand)'], exam: ['var(--danger-50)', 'var(--danger)'], holiday: ['var(--ok-50)', 'var(--ok)'], meeting: ['var(--warn-50)', 'var(--warn)'] }[e.type] || ['var(--ink-100)', 'var(--ink-500)'];
              return `<div class="mitem">
                <span class="mitem-ico" style="background:${tone[0]};color:${tone[1]}">${icon('calendar', 17, 2.2)}</span>
                <div class="mitem-main">
                  <div class="mitem-t">${esc(e.title)}</div>
                  <div class="mitem-m">
                    <span>${M.fmtDate(e.date, true)}${e.end_date && e.end_date !== e.date ? ' – ' + M.fmtDate(e.end_date, true) : ''}</span>
                    ${e.location ? `<span>· ${esc(e.location)}</span>` : ''}
                  </div>
                  ${e.description ? `<div class="mitem-d">${esc(e.description)}</div>` : ''}
                </div>
              </div>`;
            }).join('')}</div>` : M.emptyBlock({ icon: 'calendar', title: 'Tidak ada agenda', text: 'Tidak ada kegiatan pada bulan ini.' })}
          </div>`;

        host.querySelector('#cal-prev').addEventListener('click', () => { cursor.m--; if (cursor.m < 0) { cursor.m = 11; cursor.y--; } renderMonth(); });
        host.querySelector('#cal-next').addEventListener('click', () => { cursor.m++; if (cursor.m > 11) { cursor.m = 0; cursor.y++; } renderMonth(); });
        host.querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', () => showDay(c.dataset.day)));
      }

      /**
       * Date detail — resolved on the server against the member's role so a
       * student only ever sees their own class + extracurricular schedule, a
       * teacher only their own teaching load, and an employee general info.
       */
      async function showDay(iso) {
        const s = sheet({
          title: M.dow(iso),
          sub: M.fmtDate(iso),
          footer: null,
          body: '<div class="empty-m"><span class="spinner" style="color:var(--brand)"></span></div>',
        });
        let d;
        try {
          d = await api('/mobile/calendar/day?date=' + encodeURIComponent(iso));
        } catch (err) {
          s.body.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message });
          return;
        }
        const u0 = store.data.user || {};
        const intro = d.role === 'student'
          ? `Jadwal pelajaran kelas ${u0.class_name || 'Anda'} dan ekstrakurikuler yang Anda ikuti`
          : d.role === 'teacher'
            ? 'Jadwal mengajar dan ekstrakurikuler binaan Anda'
            : 'Informasi umum sekolah';
        const html = `
          <div class="day-intro">
            ${icon('info', 14, 2.4)}<span>${esc(intro)}</span>
          </div>
          ${(d.sections || []).map(sectionHtml).join('')}`;
        s.body.innerHTML = html;
        s.body.querySelectorAll('[data-ec-open]').forEach((b) => b.addEventListener('click', () => {
          s.close();
          setTimeout(() => openEcDetail(b.dataset.ecOpen), 280);
        }));
        s.body.querySelectorAll('[data-media]').forEach((b) => b.addEventListener('click', () => {
          const it = (d.sections || []).reduce((acc, sec) => acc || (sec.items || []).find((x) => String(x.id) === String(b.dataset.media)), null);
          if (it) { s.close(); setTimeout(() => openMediaDetail(b.dataset.kind, it), 280); }
        }));
        s.body.querySelectorAll('[data-cal-scroll]').forEach((b) => b.addEventListener('click', () => {
          b.classList.toggle('is-open');
          const body = b.nextElementSibling;
          if (body) body.classList.toggle('hidden');
        }));
      }

      function sectionHtml(sec) {
        const tone = {
          class: ['var(--brand-50)', 'var(--brand)', 'school'],
          ec: ['var(--pink-50)', '#db2777', 'star'],
          general: ['var(--info-50)', 'var(--info)', 'info'],
        }[sec.key] || ['var(--ink-100)', 'var(--ink-500)', 'info'];
        return `
          <div class="day-sec" style="margin-bottom:16px">
            <div class="row gap-8 mb-8" style="margin-bottom:9px">
              <span class="mitem-ico" style="background:${tone[0]};color:${tone[1]};width:30px;height:30px">${icon(tone[2], 15, 2.3)}</span>
              <div class="grow" style="min-width:0">
                <div class="semibold text-sm">${esc(sec.title)}</div>
                <div class="text-xs muted">${esc(sec.scope || '')}</div>
              </div>
              <span class="badge badge-muted">${(sec.items || []).length}</span>
            </div>
            ${(sec.items || []).length ? `<div class="mlist">${sec.items.map((it) => itemHtml(it, sec)).join('')}</div>`
            : `<div class="day-empty">${sec.key === 'class'
              ? 'Tidak ada jadwal pelajaran pada hari ini.'
              : sec.key === 'ec'
                ? 'Tidak ada jadwal ekstrakurikuler pada hari ini.'
                : 'Tidak ada informasi umum pada tanggal ini.'}</div>`}
          </div>`;
      }

      function itemHtml(it, sec) {
        const isMedia = it.kind === 'announcement' || it.kind === 'news';
        return `
          <div class="mitem"
               ${it.extracurricular_id ? `data-ec-open="${it.extracurricular_id}"` : ''}
               ${isMedia ? `data-media="${it.id}" data-kind="${it.kind}"` : ''}
               style="cursor:${it.extracurricular_id || isMedia ? 'pointer' : 'default'}">
            <span class="mitem-ico" style="background:${sec.key === 'ec' ? 'var(--pink-50)' : sec.key === 'class' ? 'var(--brand-50)' : 'var(--info-50)'};color:${sec.key === 'ec' ? '#db2777' : sec.key === 'class' ? 'var(--brand)' : 'var(--info)'}">
              ${icon(sec.key === 'ec' ? 'star' : sec.key === 'class' ? 'school' : 'info', 17, 2.2)}
            </span>
            <div class="mitem-main">
              <div class="mitem-t">${esc(it.title)}</div>
              <div class="mitem-m">
                <span class="mitem-time">${esc(it.time)}</span>
                ${it.place ? `<span>· ${esc(it.place)}</span>` : ''}
                ${it.tag ? `<span class="badge badge-muted">${esc(it.tag)}</span>` : ''}
              </div>
              ${it.sub ? `<div class="mitem-d clamp" data-cal-scroll style="cursor:pointer">${esc(it.sub)}</div>` : ''}
              ${isMedia ? mediaChips(it) : ''}
              ${isMedia ? '<div class="mitem-more">Baca selengkapnya →</div>' : ''}
            </div>
          </div>`;
      }
    },
  };

  /* ------------------------------- history ----------------------------- */
  PAGES.history = {
    async render(host, force) {
      let payload = cache.historyData;
      if (!payload || force) {
        host.innerHTML = M.skeletonCards(3);
        try {
          const [att, reqs] = await Promise.all([api('/mobile/attendance?limit=90'), api('/mobile/requests')]);
          payload = { att, reqs };
        } catch (err) { return host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); }
        cache.historyData = payload;
      }
      this.build(host, payload);
    },

    build(host, payload) {
      const att = payload.att;
      const reqs = payload.reqs;
      const c = att.counts || {};
      const rc = reqs.counts || {};
      const tab = PAGES.history._tab || 'attendance';

      host.innerHTML = `
        <div class="seg" id="h-tab">
          <button data-tab="attendance" class="${tab === 'attendance' ? 'is-active' : ''}">Kehadiran</button>
          <button data-tab="requests" class="${tab === 'requests' ? 'is-active' : ''}">Permohonan</button>
          <button data-tab="ec" class="${tab === 'ec' ? 'is-active' : ''}">Ekskul</button>
        </div>
        <div id="h-body"></div>`;

      const bodyHost = host.querySelector('#h-body');

      function renderTab() {
        const t = PAGES.history._tab || 'attendance';
        if (t === 'attendance') {
          bodyHost.innerHTML = `
            <div class="mstats" style="margin-bottom:14px">
              <div class="mstat"><b style="color:var(--ok)">${c.present || 0}</b><span>Hadir</span></div>
              <div class="mstat"><b style="color:var(--accent)">${c.late || 0}</b><span>Terlambat</span></div>
              <div class="mstat"><b style="color:var(--danger)">${c.absent || 0}</b><span>Alpa</span></div>
              <div class="mstat"><b style="color:var(--brand)">${att.rate || 0}%</b><span>Rasio</span></div>
            </div>
            <div class="mstats" style="margin-bottom:14px">
              <div class="mstat"><b>${rc.all || 0}</b><span>Permohonan</span></div>
              <div class="mstat"><b style="color:var(--warn)">${rc.pending || 0}</b><span>Menunggu</span></div>
              <div class="mstat"><b style="color:var(--ok)">${rc.approved || 0}</b><span>Disetujui</span></div>
              <div class="mstat"><b style="color:var(--danger)">${rc.rejected || 0}</b><span>Ditolak</span></div>
            </div>
            <div class="mcard">
              <div class="mcard-t"><h3>Riwayat kehadiran</h3>
                <span class="badge badge-muted">${(att.items || []).length} rekam</span></div>
              ${(att.items || []).length ? `<div class="mlist">${groupByMonth(att.items).map((g) => `
                <div>
                  <div class="semibold text-xs muted" style="padding:12px 0 6px">${esc(g.label)}</div>
                  ${g.rows.map((r) => `
                    <div class="hrow">
                      <div class="hrow-d"><b>${r.date.slice(8)}</b><span>${M.dowShort(r.date)}</span></div>
                      <div class="hrow-m">
                        <div class="t">${M.fmtTime(r.check_in_at)} – ${r.check_out_at ? M.fmtTime(r.check_out_at) : '<span class="dim">belum pulang</span>'}</div>
                        <div class="s">${r.work_hours ? r.work_hours + ' jam · ' : ''}${(r.check_in_method || '').toUpperCase()}${r.check_in_dist ? ' · ' + Math.round(r.check_in_dist) + ' m' : ''}</div>
                      </div>
                      <span class="badge ${r.status === 'present' ? 'badge-ok' : r.status === 'late' ? 'badge-warn' : 'badge-muted'}">
                        <i class="badge-dot"></i>${M.STATUS_LABEL[r.status] || r.status}</span>
                    </div>`).join('')}
                </div>`).join('')}</div>`
                : M.emptyBlock({ icon: 'attendance', title: 'Belum ada riwayat', text: 'Riwayat kehadiran Anda akan muncul setelah absen pertama.' })}
            </div>`;
        } else if (t === 'requests') {
          bodyHost.innerHTML = `
            <div class="mstats" style="margin-bottom:14px">
              <div class="mstat"><b>${rc.all || 0}</b><span>Total</span></div>
              <div class="mstat"><b style="color:var(--warn)">${rc.pending || 0}</b><span>Menunggu</span></div>
              <div class="mstat"><b style="color:var(--ok)">${rc.approved || 0}</b><span>Disetujui</span></div>
              <div class="mstat"><b style="color:var(--danger)">${rc.rejected || 0}</b><span>Ditolak</span></div>
            </div>
            <div class="mcard">
              <div class="mcard-t"><h3>Permohonan saya</h3>
                <button class="more" id="h-add">+ Ajukan</button></div>
              ${(reqs.items || []).length ? `<div class="mlist">${reqs.items.map((r) => `
                <div class="mitem">
                  <span class="mitem-ico" style="background:${r.status === 'approved' ? 'var(--ok-50);color:var(--ok)' : r.status === 'pending' ? 'var(--warn-50);color:var(--warn)' : 'var(--danger-50);color:var(--danger)'}">
                    ${icon('requests', 17, 2.2)}</span>
                  <div class="mitem-main">
                    <div class="mitem-t">${esc(r.title)}</div>
                    <div class="mitem-m">
                      <span class="badge badge-muted">${esc(r.type)}</span>
                      <span>${M.fmtDate(r.from_date, true)}${r.to_date !== r.from_date ? ' – ' + M.fmtDate(r.to_date, true) : ''}</span>
                    </div>
                    <div class="mitem-d">${esc(r.details || '')}</div>
                    ${r.review_note ? `<div class="text-xs mt-4" style="margin-top:5px;color:var(--ink-600)"><b>Catatan:</b> ${esc(r.review_note)}</div>` : ''}
                  </div>
                  <span class="badge ${r.status === 'approved' ? 'badge-ok' : r.status === 'pending' ? 'badge-warn' : 'badge-danger'}">
                    <i class="badge-dot"></i>${r.status === 'approved' ? 'Disetujui' : r.status === 'pending' ? 'Menunggu' : 'Ditolak'}</span>
                </div>`).join('')}</div>`
                : M.emptyBlock({ icon: 'requests', title: 'Belum ada permohonan', text: 'Tekan tombol + untuk mengajukan izin.' })}
            </div>`;
          const add = bodyHost.querySelector('#h-add');
          if (add) add.addEventListener('click', () => openRequestForm(() => { cache.historyData = null; go('history', true); }));
        } else {
          const ecs = att.extracurriculars || [];
          bodyHost.innerHTML = `
            <div class="mcard">
              <div class="mcard-t"><h3>Kehadiran ekstrakurikuler</h3>
                <button class="more" id="h-ec">+ Absen</button></div>
              ${ecs.length ? `<div class="mlist">${ecs.map((r) => `
                <div class="hrow">
                  <div class="hrow-d"><b>${r.date.slice(8)}</b><span>${M.dowShort(r.date)}</span></div>
                  <div class="hrow-m">
                    <div class="t">${esc(r.extracurricular_name)}</div>
                    <div class="s">${r.distance_m != null ? Math.round(r.distance_m) + ' m · ' : ''}${r.has_selfie ? 'ada selfie' : 'tanpa selfie'}</div>
                  </div>
                  <span class="badge ${r.status === 'present' ? 'badge-ok' : 'badge-muted'}"><i class="badge-dot"></i>${r.status === 'present' ? 'Hadir' : 'Tidak hadir'}</span>
                </div>`).join('')}</div>`
                : M.emptyBlock({ icon: 'star', title: 'Belum ada rekam ekskul', text: 'Absen kehadiran ekstrakurikuler melalui tombol +.' })}
            </div>`;
          const b = bodyHost.querySelector('#h-ec');
          if (b) b.addEventListener('click', openEcPicker);
        }
      }

      host.querySelectorAll('#h-tab button').forEach((b) => b.addEventListener('click', () => {
        PAGES.history._tab = b.dataset.tab;
        host.querySelectorAll('#h-tab button').forEach((x) => x.classList.toggle('is-active', x === b));
        renderTab();
      }));
      renderTab();
    },
  };

  function groupByMonth(rows) {
    const map = {};
    rows.forEach((r) => {
      const key = r.date.slice(0, 7);
      (map[key] = map[key] || []).push(r);
    });
    return Object.keys(map).sort((a, b) => (a < b ? 1 : -1)).map((k) => {
      const d = new Date(k + '-01T00:00:00Z');
      return { label: `${M.MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, rows: map[k] };
    });
  }

  /* ------------------------------ schedule ---------------------------- */
  /**
   * Jadwal — the weekly timetable promoted out of the profile page into its
   * own tab. A student sees their class timetable, a teacher their teaching
   * load, an employee the general school information.
   */
  PAGES.schedule = {
    async render(host, force) {
      let d = cache.weekData;
      if (!d || force) {
        host.innerHTML = M.skeletonCards(2);
        try { d = await api('/mobile/schedule/week'); }
        catch (err) { return host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); }
        cache.weekData = d;
      }
      this.build(host, d);
    },

    build(host, d) {
      const u = store.data.user || {};
      const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      const todayName = M.dow(M.todayStr());
      const active = days.indexOf(todayName) >= 0 ? todayName : days[0];
      const ecByDay = {};
      (d.ec || []).forEach((x) => { ecByDay[x.day] = x.items || []; });

      if (u.role === 'employee') {
        host.innerHTML = M.emptyBlock({
          icon: 'info',
          title: 'Informasi umum',
          text: 'Sebagai karyawan Anda melihat informasi umum sekolah. Buka menu Kalender untuk melihat pengumuman dan berita pada tanggal tertentu.',
        });
        return;
      }

      host.innerHTML = `
        <div class="mcard">
          <div class="mcard-t">
            <h3>${u.role === 'student' ? 'Jadwal pelajaran' : 'Jadwal mengajar'}</h3>
            <button class="more" id="wk-refresh">Muat ulang ↻</button>
          </div>
          <div class="text-xs muted" style="margin-bottom:12px">
            ${u.role === 'student'
              ? `Kelas ${esc(u.class_name || '—')} · jadwal mingguan`
              : esc(u.subject || 'Jadwal mengajar') + ' · jadwal mingguan'}
          </div>
          <div class="rank-tabs" id="wk-tabs">
            ${days.map((x) => `<button class="rank-tab ${x === active ? 'is-active' : ''}" data-wk="${x}">${esc(x.slice(0, 3))}</button>`).join('')}
          </div>
          <div id="wk-body" style="margin-top:14px"></div>
        </div>`;

      const body = host.querySelector('#wk-body');
      function draw(day) {
        const cls = ((d.days || {})[day] || []).slice().sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
        const ecs = (ecByDay[day] || []).slice().sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
        body.innerHTML = `
          <div class="ec-block">
            <div class="ec-block-t">${icon('school', 15, 2.3)} ${u.role === 'student' ? 'Pelajaran' : 'Mengajar'} · ${esc(day)}</div>
            ${cls.length ? cls.map((c) => `
              <div class="ec-sched-row">
                <b>${esc(c.start_time)}–${esc(c.end_time)}</b>
                <span>${esc(c.subject || 'Kegiatan kelas')}${c.class_name ? ' · Kelas ' + esc(c.class_name) : ''}${c.teacher_name ? ' · ' + esc(c.teacher_name) : ''}</span>
                ${c.room ? `<span class="badge badge-muted">${esc(c.room)}</span>` : ''}
              </div>`).join('') : '<div class="day-empty">Tidak ada jadwal pada hari ini.</div>'}
          </div>
          <div class="ec-block">
            <div class="ec-block-t">${icon('star', 15, 2.3)} Ekstrakurikuler · ${esc(day)}</div>
            ${ecs.length ? ecs.map((c) => `
              <div class="ec-sched-row">
                <b>${esc(c.start_time)}–${esc(c.end_time)}</b>
                <span>${esc(c.extracurricular_name || '')}${c.place && c.place.name ? ' · ' + esc(c.place.name) : ''}</span>
                ${c.grade_group ? `<span class="badge badge-violet">${esc(c.grade_group)}</span>` : ''}
              </div>`).join('') : '<div class="day-empty">Tidak ada jadwal ekstrakurikuler.</div>'}
          </div>`;
      }
      draw(active);
      host.querySelectorAll('[data-wk]').forEach((b) => b.addEventListener('click', () => {
        host.querySelectorAll('[data-wk]').forEach((x) => x.classList.toggle('is-active', x === b));
        draw(b.dataset.wk);
      }));
      host.querySelector('#wk-refresh').addEventListener('click', () => {
        cache.weekData = null;
        go('schedule', true);
      });
    },
  };

  /* ------------------------------- profile ----------------------------- */
  PAGES.profile = {
    tallHeader: true,
    async render(host, force) {
      let payload = cache.profileData;
      if (!payload || force) {
        host.innerHTML = M.skeletonCards(2);
        try {
          const [me, board] = await Promise.all([api('/mobile/me'), api('/mobile/leaderboard')]);
          payload = { me, board };
        } catch (err) { return host.innerHTML = M.emptyBlock({ icon: 'alert', title: 'Gagal memuat', text: err.message }); }
        cache.profileData = payload;
      }
      store.set({ user: payload.me.user, settings: payload.me.settings, school: payload.me.school });
      renderHeader();
      this.build(host, payload);
    },

    build(host, payload) {
      const me = payload.me;
      const board = payload.board;
      const u = me.user;
      const lvl = u.level || { name: 'Pemula', color: '#94a3b8', progress: 0, next: null, pointsToNext: 0 };
      const R = 44, CIRC = 2 * Math.PI * R;
      const dash = (CIRC * (lvl.progress || 0)) / 100;

      host.innerHTML = `
        <div class="mcard">
          <div class="row gap-16" style="align-items:center">
            ${M.avatarHTML(u, 'av-lg')}
            <div class="grow" style="min-width:0">
              <div style="font-size:1.05rem;font-weight:800;letter-spacing:-.02em">${esc(u.name)}</div>
              <div class="text-sm muted">${esc(M.ROLE_LABEL[u.role] || '')}${u.class_name ? ' · ' + esc(u.class_name) : u.position ? ' · ' + esc(u.position) : ''}</div>
              <div class="text-xs muted mono">${esc(u.id_number || '')}</div>
            </div>
          </div>
        </div>

        <div class="mcard">
          <div class="mcard-t"><h3>Poin profil</h3>
            <span class="badge" style="background:${esc(lvl.color)}22;color:${esc(lvl.color)}">${esc(lvl.name)}</span></div>
          <div class="score-ring">
            <div style="position:relative;width:104px;height:104px;flex:none">
              <svg width="104" height="104" viewBox="0 0 104 104" style="transform:rotate(-90deg)">
                <circle cx="52" cy="52" r="${R}" fill="none" stroke="var(--ink-200)" stroke-width="10"/>
                <circle cx="52" cy="52" r="${R}" fill="none" stroke="${esc(lvl.color)}" stroke-width="10"
                        stroke-linecap="round" stroke-dasharray="${dash} ${CIRC}"/>
              </svg>
              <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
                <div><div style="font-size:1.35rem;font-weight:800;letter-spacing:-.03em;line-height:1">${M.num(u.score_points)}</div>
                <div class="text-xs muted">poin</div></div>
              </div>
            </div>
            <div class="grow" style="min-width:0">
              <div class="semibold">${esc(lvl.name)}</div>
              <div class="text-sm muted" style="line-height:1.6;margin-top:3px">
                ${lvl.next ? `${lvl.pointsToNext} poin lagi menuju <b>${esc(lvl.next)}</b>.` : 'Anda telah mencapai level tertinggi.'}
              </div>
              <div class="text-xs muted mt-8" style="margin-top:8px">
                Peringkat <b>${esc(M.ROLE_LABEL[u.role] || '')}</b>:
                <b class="rank-inline">${rankLabel(u.score_points, board.my_rank, board.my_total)}</b>
                ${board.my_percentile ? `<br>peringkat ${board.my_percentile}% teratas` : ''}
              </div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="text-xs muted" style="line-height:1.7">
            <b>Cara mendapatkan poin:</b> absen masuk tepat waktu (+3), terlambat (+1),
            kehadiran ekstrakurikuler (+2), permohonan disetujui (+5/hari).
          </div>
        </div>

        <div class="mcard">
          <div class="mcard-t"><h3>Statistik saya</h3></div>
          <div class="mstats">
            <div class="mstat"><b style="color:var(--ok)">${me.stats.present}</b><span>Hadir</span></div>
            <div class="mstat"><b style="color:var(--accent)">${me.stats.late}</b><span>Terlambat</span></div>
            <div class="mstat"><b>${me.stats.attendance}</b><span>Total</span></div>
            <div class="mstat"><b style="color:#db2777">${me.stats.ec}</b><span>Ekskul</span></div>
          </div>
        </div>

        <div class="mcard">
          <div class="mcard-t"><h3>Pengaturan akun</h3></div>
          <button class="pset-item" data-set="biodata">
            <span class="pset-ico" style="background:var(--brand-50);color:var(--brand)">${icon('edit', 19, 2.2)}</span>
            <span class="pset-main"><span class="pset-t">Ubah biodata</span>
            <span class="pset-d">Nama, telepon, alamat dan foto profil</span></span>
            ${icon('chevronRight', 17, 2.3)}
          </button>
          <button class="pset-item" data-set="password">
            <span class="pset-ico" style="background:var(--warn-50);color:var(--warn)">${icon('key', 19, 2.2)}</span>
            <span class="pset-main"><span class="pset-t">Ubah kata sandi</span>
            <span class="pset-d">Perbarui kata sandi akun Anda</span></span>
            ${icon('chevronRight', 17, 2.3)}
          </button>
          <button class="pset-item" data-set="ec">
            <span class="pset-ico" style="background:var(--pink-50);color:#db2777">${icon('star', 19, 2.2)}</span>
            <span class="pset-main"><span class="pset-t">Ekstrakurikuler saya</span>
            <span class="pset-d">${me.scope && me.scope.assigned_extracurriculars ? me.scope.assigned_extracurriculars + ' kegiatan · ' + (me.scope.is_mentor ? 'sebagai pembina' : 'sebagai anggota') : 'Belum ada kegiatan yang ditugaskan'}</span></span>
            ${icon('chevronRight', 17, 2.3)}
          </button>
          <button class="pset-item" data-set="schedule">
            <span class="pset-ico" style="background:var(--brand-50);color:var(--brand)">${icon('calendar', 19, 2.2)}</span>
            <span class="pset-main"><span class="pset-t">Jadwal mingguan</span>
            <span class="pset-d">Buka tab Jadwal · ${u.role === 'student' ? 'jadwal pelajaran kelas ' + esc(u.class_name || 'Anda') : u.role === 'teacher' ? 'jadwal mengajar Anda' : 'informasi umum sekolah'}</span></span>
            ${icon('chevronRight', 17, 2.3)}
          </button>
          <button class="pset-item" data-set="leaderboard">
            <span class="pset-ico" style="background:var(--ok-50);color:var(--ok)">${icon('award', 19, 2.2)}</span>
            <span class="pset-main"><span class="pset-t">Peringkat poin</span>
            <span class="pset-d">Peringkat dikelompokkan berdasarkan peran</span></span>
            ${icon('chevronRight', 17, 2.3)}
          </button>
          <button class="pset-item" data-set="logout">
            <span class="pset-ico" style="background:var(--danger-50);color:var(--danger)">${icon('logout', 19, 2.2)}</span>
            <span class="pset-main"><span class="pset-t" style="color:var(--danger)">Keluar</span>
            <span class="pset-d">Akhiri sesi di perangkat ini</span></span>
            ${icon('chevronRight', 17, 2.3)}
          </button>
        </div>

        <div class="pull-hint">
          ${esc((store.data.school || {}).name || '')} · Versi aplikasi 1.0.0
        </div>`;


      host.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.set;
        if (k === 'biodata') openBiodata(u);
        if (k === 'password') openPassword();
        if (k === 'leaderboard') openLeaderboard(board);
        if (k === 'ec') openMyExtracurriculars();
        if (k === 'schedule') openWeekSchedule();
        if (k === 'logout') confirmLogout();
      }));
    },
  };

  function openBiodata(u) {
    let avatar = u.avatar || '';
    const s = sheet({
      title: 'Ubah biodata',
      sub: 'Perbarui data diri Anda',
      okText: 'Simpan',
      body: `
        <div style="text-align:center;margin-bottom:18px">
          <div id="bd-av">${M.avatarHTML(Object.assign({}, u, { avatar }), 'av-lg')}</div>
          <button class="btn btn-sm mt-8" id="bd-pick" style="margin-top:10px">${icon('camera', 14, 2.3)} Ganti foto</button>
        </div>
        <div class="lfield"><label>Nama lengkap</label><input class="input" name="name" value="${esc(u.name || '')}" data-autofocus style="height:50px;border-radius:15px"></div>
        <div class="lfield"><label>Nomor telepon</label><input class="input" name="phone" value="${esc(u.phone || '')}" style="height:50px;border-radius:15px"></div>
        <div class="lfield"><label>Jenis kelamin</label>
          <select class="select" name="gender" style="height:50px;border-radius:15px">
            <option value="">—</option>
            <option value="L" ${u.gender === 'L' ? 'selected' : ''}>Laki-laki</option>
            <option value="P" ${u.gender === 'P' ? 'selected' : ''}>Perempuan</option>
          </select></div>
        <div class="lfield"><label>Alamat</label><textarea class="textarea" name="home_address" rows="3" style="border-radius:15px">${esc(u.home_address || '')}</textarea></div>
        <div class="lfield"><label>Tentang saya</label><textarea class="textarea" name="bio" rows="3" placeholder="Ceritakan sedikit tentang diri Anda…" style="border-radius:15px">${esc(u.bio || '')}</textarea></div>`,
      onMount(s2) {
        s2.el.querySelector('#bd-pick').addEventListener('click', () => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          inp.addEventListener('change', async () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            try {
              avatar = await compressImage(f, 320, 0.70);
              s2.el.querySelector('#bd-av').innerHTML = M.avatarHTML({ name: u.name, avatar }, 'av-lg');
            } catch (e) {
              toast('error', 'Gagal', 'Tidak dapat memproses foto avatar.');
            }
          });
          inp.click();
        });
        s2.el.querySelector('[data-cancel]').addEventListener('click', () => s2.close());
        s2.el.querySelector('[data-submit]').addEventListener('click', async () => {
          s2.clearError();
          const v = formValues(s2.body);
          if (!v.name || v.name.trim().length < 2) return s2.error('Nama minimal 2 karakter.');
          v.avatar = avatar;
          s2.setBusy(true, 'Menyimpan…');
          try {
            const r = await api('/auth/profile', { method: 'PUT', body: v });
            store.set({ user: r.user });
            s2.close();
            toast('ok', 'Biodata disimpan', r.message);
            cache.profileData = null; cache.homeData = null;
            renderHeader();
            refreshNavAvatar();
            go('profile', true);
          } catch (err) { s2.setBusy(false); s2.error(err.message); }
        });
      },
    });
    return s;
  }

  function openPassword() {
    const s = sheet({
      title: 'Ubah kata sandi',
      sub: 'Masukkan kata sandi saat ini dan yang baru',
      okText: 'Ubah Kata Sandi',
      body: `
        <div class="lfield"><label>Kata sandi saat ini</label>
          <input class="input" type="password" name="current" data-autofocus style="height:50px;border-radius:15px"></div>
        <div class="lfield"><label>Kata sandi baru</label>
          <input class="input" type="password" name="next" placeholder="minimal 6 karakter" style="height:50px;border-radius:15px"></div>
        <div class="lfield"><label>Ulangi kata sandi baru</label>
          <input class="input" type="password" name="confirm" style="height:50px;border-radius:15px"></div>`,
      onMount(s2) {
        s2.el.querySelector('[data-cancel]').addEventListener('click', () => s2.close());
        s2.el.querySelector('[data-submit]').addEventListener('click', async () => {
          s2.clearError();
          const v = formValues(s2.body);
          if (!v.current) return s2.error('Kata sandi saat ini wajib diisi.');
          if (!v.next || v.next.length < 6) return s2.error('Kata sandi baru minimal 6 karakter.');
          if (v.next !== v.confirm) return s2.error('Konfirmasi kata sandi tidak cocok.');
          s2.setBusy(true, 'Menyimpan…');
          try {
            const r = await api('/auth/change-password', { method: 'POST', body: { current: v.current, next: v.next } });
            s2.close();
            toast('ok', 'Kata sandi diperbarui', r.message);
          } catch (err) { s2.setBusy(false); s2.error(err.message); }
        });
      },
    });
    return s;
  }

  /** The rank label: `10 Point (173 / 175)` — points, then rank out of the group. */
  function rankLabel(points, rank, total) {
    return `${M.num(points || 0)} Point <span class="rank-of">(${rank || '—'} / ${total || 0})</span>`;
  }

  /**
   * Point rank — strictly intra-role. A student only ever sees students, a
   * teacher only teachers and an employee only employees; there is no way to
   * switch group, because the comparison is only meaningful within a role.
   */
  function openLeaderboard(board) {
    const me = store.data.user || {};
    const role = (board && board.role) || me.role || 'student';
    const rows = ((board && board.groups) || {})[role] || [];
    const myRank = (board && board.my_rank) || 0;
    const myTotal = (board && board.my_total) || 0;
    const groupTotal = ((board && board.totals) || {})[role] || myTotal || rows.length;

    const s = sheet({
      title: 'Peringkat poin',
      sub: `Peringkat ${M.ROLE_LABEL[role] || ''} — Anda hanya melihat peran Anda sendiri`,
      footer: null,
      body: `
        ${myRank ? `
        <div class="rank-me">
          <div style="text-align:center;min-width:56px">
            <div class="rank-me-b">#${myRank}</div>
            <div class="rank-me-l">dari ${myTotal}</div>
          </div>
          <div class="grow" style="min-width:0">
            <div class="semibold text-sm ellipsis">${esc(me.name || '')}</div>
            <div class="text-xs muted">${esc(M.ROLE_LABEL[me.role] || '')} · ${M.num((board && board.my_points) || 0)} poin</div>
          </div>
          <span class="badge badge-brand">${rankLabel((board && board.my_points) || 0, myRank, myTotal)}</span>
        </div>` : ''}
        <div class="text-xs dim" style="margin:14px 2px 8px;text-transform:uppercase;letter-spacing:.06em">
          Peringkat ${esc(M.ROLE_LABEL[role] || '')}
        </div>
        ${rows.length ? rows.map((r) => `
          <div class="rank-row ${r.me || r.id === me.id ? 'is-me' : ''} ${r.rank <= 3 ? 'top' : ''}">
            <span class="rank-row-n">${r.rank}</span>
            ${M.avatarHTML({ name: r.name }, 'avatar')}
            <div class="rank-row-m">
              <div class="rank-row-t">${esc(r.name)}</div>
              <div class="rank-row-s">${esc(r.class_name || r.subject || r.position || (M.ROLE_LABEL[r.role] || ''))}</div>
            </div>
            <span class="rank-row-p">${rankLabel(r.score_points, r.rank, groupTotal)}</span>
          </div>`).join('')
          : M.emptyBlock({ icon: 'award', title: 'Belum ada peringkat', text: 'Belum ada poin pada kelompok peran Anda.' })}
        <div class="text-xs muted" style="margin-top:14px;line-height:1.7">
          Peringkat dihitung terpisah untuk setiap peran: siswa dibandingkan dengan sesama siswa,
          guru dengan sesama guru dan karyawan dengan sesama karyawan. Poin diperoleh dari absensi
          tepat waktu, kehadiran ekstrakurikuler dan permohonan yang disetujui.
        </div>`,
    });
    return s;
  }

  async function confirmLogout() {
    const ok = await confirmSheet({
      title: 'Keluar dari aplikasi?',
      text: 'Anda perlu masuk kembali untuk menggunakan aplikasi.',
      okText: 'Ya, keluar',
      danger: true,
    });
    if (ok) App.logout();
  }

  /* ------------------------------ offline ------------------------------ */
  window.addEventListener('online', () => toast('ok', 'Kembali online', 'Data akan disinkronkan.'));
  window.addEventListener('offline', () => toast('warn', 'Anda offline', 'Menampilkan data terakhir yang tersimpan.'));

  /**
   * The announcement/news readers are reused by parent mode, which renders
   * the same announcements for a parent's child.
   */
  App.openAnnouncementDetail = openAnnouncementDetail;
  App.openNewsDetail = openNewsDetail;

  /* -------------------------------- go --------------------------------- */
  boot();
})(window);
