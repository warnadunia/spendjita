/* ==========================================================================
   Mobile PWA core — API client, store, helpers, sheets & toasts
   ========================================================================== */
(function (global) {
  'use strict';

  const LS = 'sas.mobile.v1';
  const store = {
    data: { token: '', user: null, school: null, settings: null, lastRoute: 'home' },
    load() {
      try {
        const raw = localStorage.getItem(LS);
        if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (e) {}
      return this.data;
    },
    save() { try { localStorage.setItem(LS, JSON.stringify(this.data)); } catch (e) {} },
    set(p) { Object.assign(this.data, p); this.save(); },
    clear() { try { localStorage.removeItem(LS); } catch (e) {} this.data = { token: '', user: null, school: null, settings: null, lastRoute: 'home' }; },
  };
  store.load();

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    if (store.data.token) headers.Authorization = 'Bearer ' + store.data.token;
    let res;
    try {
      res = await fetch('/api' + path, {
        method: o.method || 'GET',
        headers,
        body: o.body === undefined || o.body === null ? undefined : JSON.stringify(o.body),
      });
    } catch (err) {
      throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    }
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    if (res.status === 401) {
      store.clear();
      if (global.App && App.logout) App.logout();
      throw new ApiError('Sesi Anda telah berakhir. Silakan login kembali.');
    }
    if (!res.ok || (payload && payload.ok === false)) {
      throw new ApiError((payload && payload.error) || `Permintaan gagal (${res.status})`);
    }
    return payload && payload.data !== undefined ? payload.data : payload;
  }

  class ApiError extends Error {
    constructor(m) { super(m); this.name = 'ApiError'; }
  }

  /* ------------------------------ helpers ------------------------------ */
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  function initials(name) {
    if (!name) return '?';
    const p = String(name).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }
  function hueOf(name) {
    let h = 0;
    for (let i = 0; i < String(name || '').length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function avatarHTML(user, cls) {
    if (user && user.avatar) return `<img class="av ${cls || ''}" src="${esc(user.avatar)}" alt="${esc(user.name || '')}">`;
    return `<span class="av ${cls || ''}" style="background:linear-gradient(135deg,hsl(${hueOf(user && user.name)},68%,54%),hsl(${(hueOf(user && user.name) + 42) % 360},68%,46%))">${esc(initials(user && user.name))}</span>`;
  }
  function offsetMinutes() {
    const tz = (store.data.settings || {}).timezone || 'Asia/Jakarta';
    return { 'Asia/Jakarta': 420, 'Asia/Makassar': 300, 'Asia/Jayapura': 600, UTC: 0 }[tz] != null
      ? { 'Asia/Jakarta': 420, 'Asia/Makassar': 300, 'Asia/Jayapura': 600, UTC: 0 }[tz] : 420;
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const s = new Date(d.getTime() + offsetMinutes() * 60000);
    return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
  }
  function fmtDate(iso, short) {
    if (!iso) return '—';
    const str = String(iso);
    const d = str.length === 10 ? new Date(str + 'T00:00:00Z') : new Date(str);
    if (isNaN(d)) return '—';
    return `${d.getUTCDate()} ${short ? MONTHS_SHORT[d.getUTCMonth()] : MONTHS[d.getUTCMonth()]} ${short ? '' : d.getUTCFullYear()}`.trim();
  }
  function timeAgo(iso) {
    if (!iso) return '—';
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 45) return 'baru saja';
    if (secs < 90) return '1 menit lalu';
    if (secs < 3600) return `${Math.floor(secs / 60)} menit lalu`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} jam lalu`;
    if (secs < 172800) return 'kemarin';
    return fmtDate(iso, true);
  }
  function todayStr() {
    return new Date(Date.now() + offsetMinutes() * 60000).toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dow(dateStr) { return DAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()]; }
  function dowShort(dateStr) { return DAYS_SHORT[new Date(dateStr + 'T00:00:00Z').getUTCDay()]; }
  const num = (n) => Number(n || 0).toLocaleString('id-ID');
  function fileSize(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }
  function hostOf(url) {
    try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch (e) { return String(url || ''); }
  }
  /** True when a data URL attachment is a raster image we can preview inline. */
  function isImageAttachment(a) {
    return !!(a && a.data && /^data:image\//i.test(a.data));
  }
  function debounce(fn, ms) {
    let t;
    return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms || 260); };
  }

  const ROLE_LABEL = { admin: 'Administrator', teacher: 'Guru', student: 'Peserta Didik', employee: 'Karyawan', parent: 'Orang Tua' };
  const STATUS_LABEL = { present: 'Hadir', late: 'Terlambat', absent: 'Tidak Hadir', leave: 'Izin' };
  const STATUS_COLOR = { present: 'var(--ok)', late: 'var(--accent)', absent: 'var(--ink-300)', leave: 'var(--info)' };

  /* ------------------------------- icons ------------------------------- */
  const ICONS = {
    home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    attendance: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/><path d="M10 6h8M10 10h8M10 14h5"/>',
    requests: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 15h6M9 11h3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M21 7h-6M21 7v6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 8-8M17 6l3 3M14 9l3 3"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>',
    school: '<path d="M22 9 12 4 2 9l10 5 10-5Z"/><path d="M6 11.5V17c0 1.5 3 3 6 3s6-1.5 6-3v-5.5"/>',
    timetable: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2v4M16 2v4M7 13h4M7 17h6M14 13h3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
  };
  function icon(name, size, stroke) {
    const d = ICONS[name] || ICONS.info;
    const s = size || 20;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  /* ------------------------------- toast ------------------------------- */
  function toast(type, title, text, ms) {
    let host = document.getElementById('m-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'm-toast-host';
      host.className = 'toast-host';
      host.style.cssText = 'bottom:calc(110px + env(safe-area-inset-bottom));left:12px;right:12px;align-items:center';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast t-${type || 'info'}`;
    el.style.maxWidth = '100%';
    el.innerHTML = `
      <span class="toast-ico">${icon({ ok: 'check', error: 'alert', warn: 'alert', info: 'info' }[type] || 'info', 14, 2.6)}</span>
      <div class="toast-body"><div class="toast-title">${esc(title)}</div>${text ? `<div class="toast-text">${esc(text)}</div>` : ''}</div>`;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 220); }, ms || 3400);
  }

  /* ------------------------------- sheet -------------------------------- */
  let openSheets = [];
  function sheet(opts) {
    const o = opts || {};
    let host = document.getElementById('m-sheet-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'm-sheet-host';
      host.className = 'sheet-host';
      document.body.appendChild(host);
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0';
    wrap.innerHTML = `
      <div class="sheet-scrim"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div class="grow" style="min-width:0">
            <div class="sheet-title">${esc(o.title || '')}</div>
            ${o.sub ? `<div class="sheet-sub">${esc(o.sub)}</div>` : ''}
          </div>
          <button class="modal-close" type="button" aria-label="Tutup">${icon('x', 16, 2.4)}</button>
        </div>
        <div class="sheet-body">${o.body || ''}</div>
        ${o.footer === null ? '' : `<div class="sheet-foot">${o.footer || defaultFoot(o)}</div>`}
      </div>`;
    host.appendChild(wrap);
    openSheets.push(wrap);

    const sheetEl = wrap.querySelector('.sheet');
    function close(result) {
      sheetEl.classList.add('is-out');
      wrap.querySelector('.sheet-scrim').style.opacity = '0';
      setTimeout(() => {
        wrap.remove();
        const i = openSheets.indexOf(wrap);
        if (i >= 0) openSheets.splice(i, 1);
      }, 230);
      if (o.onClose) o.onClose(result);
    }
    /* Dismissal goes through `sapi.close`, not the internal `close`, so a sheet
       that overrides it (the QR scanner stops the camera there) still runs its
       own teardown when the member taps outside or presses the X. */
    wrap.querySelector('.sheet-scrim').addEventListener('click', () => sapi.close(null));
    wrap.querySelector('.modal-close').addEventListener('click', () => sapi.close(null));

    const sapi = {
      el: wrap,
      body: wrap.querySelector('.sheet-body'),
      close,
      setBusy(busy, label) {
        const b = wrap.querySelector('[data-submit]');
        if (!b) return;
        b.disabled = !!busy;
        if (busy) { b.dataset.html = b.innerHTML; b.innerHTML = `<span class="spinner" style="width:16px;height:16px"></span>${esc(label || 'Memproses…')}`; }
        else if (b.dataset.html) b.innerHTML = b.dataset.html;
      },
      error(msg) {
        let e = wrap.querySelector('.sheet-error');
        if (!e) {
          e = document.createElement('div');
          e.className = 'sheet-error';
          e.style.cssText = 'margin:0 20px 12px;padding:11px 13px;border-radius:12px;background:#fef2f2;color:#b91c1c;font-size:.82rem;font-weight:600;display:flex;gap:8px;align-items:flex-start';
          wrap.querySelector('.sheet-body').after(e);
        }
        e.innerHTML = `<span style="flex:none;margin-top:1px">${icon('alert', 15, 2.4)}</span><span>${esc(msg)}</span>`;
      },
      clearError() { const e = wrap.querySelector('.sheet-error'); if (e) e.remove(); },
    };
    if (o.onMount) o.onMount(sapi);
    setTimeout(() => {
      const f = wrap.querySelector('[data-autofocus]') || wrap.querySelector('input:not([type=hidden]),select,textarea');
      if (f && f.focus) f.focus();
    }, 320);
    return sapi;
  }
  function defaultFoot(o) {
    return `<button class="btn" type="button" data-cancel>${esc(o.cancelText || 'Batal')}</button>
            <button class="btn btn-primary" type="button" data-submit>${esc(o.okText || 'Simpan')}</button>`;
  }
  function confirmSheet(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const s = sheet({
        title: o.title || 'Konfirmasi',
        sub: o.sub,
        body: `<p style="font-size:.88rem;color:var(--ink-600);line-height:1.65;padding-bottom:6px">${esc(o.text || '')}</p>`,
        okText: o.okText || 'Ya',
        cancelText: o.cancelText || 'Batal',
        onMount(s2) {
          const b = s2.el.querySelector('[data-submit]');
          if (o.danger) b.className = 'btn btn-danger-solid';
          s2.el.querySelector('[data-cancel]').addEventListener('click', () => { s2.close(false); resolve(false); });
          b.addEventListener('click', () => { s2.close(true); resolve(true); });
        },
        onClose: (r) => { if (r === null) resolve(false); },
      });
      return s;
    });
  }

  function formValues(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  }

  function emptyBlock(opts) {
    const o = opts || {};
    return `<div class="empty-m">
      <div class="empty-m-ico">${icon(o.icon || 'inbox', 24, 1.8)}</div>
      <div class="empty-m-t">${esc(o.title || 'Belum ada data')}</div>
      <div class="empty-m-d">${esc(o.text || '')}</div>
    </div>`;
  }

  function skeletonCards(n) {
    return Array.from({ length: n || 3 }).map(() =>
      `<div class="mcard"><div class="skeleton skel-line" style="width:45%;height:16px"></div>
       <div class="skeleton skel-line" style="width:80%;margin-top:12px"></div>
       <div class="skeleton skel-line" style="width:62%;margin-top:8px"></div></div>`).join('');
  }

  global.MCore = {
    store, api, ApiError, icon, esc, toast,
    sheet, confirmSheet, formValues, emptyBlock, skeletonCards,
    fmtTime, fmtDate, timeAgo, initials, hueOf, avatarHTML, todayStr, addDays, dow, dowShort,
    num, debounce, pad, offsetMinutes, fileSize, hostOf, isImageAttachment,
    MONTHS, MONTHS_SHORT, DAYS, DAYS_SHORT,
    ROLE_LABEL, STATUS_LABEL, STATUS_COLOR,
  };
})(window);
