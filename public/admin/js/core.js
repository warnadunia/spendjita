/* ==========================================================================
   Admin core — API client, store, UI primitives (toast / modal / table)
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------- storage ------------------------------ */
  const LS = 'sas.admin.v1';
  const store = {
    data: { token: '', user: null, school: null, settings: null },
    load() {
      try {
        const raw = localStorage.getItem(LS);
        if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (e) { /* ignore */ }
      return this.data;
    },
    save() {
      try { localStorage.setItem(LS, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    },
    set(patch) { Object.assign(this.data, patch); this.save(); },
    clear() { this.data = { token: '', user: null, school: null, settings: null }; try { localStorage.removeItem(LS); } catch (e) {} },
  };
  store.load();

  /* --------------------------------- api -------------------------------- */
  let inflight = 0;
  const apiEvents = new EventTarget();

  function authHeaders(extra) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (store.data.token) h.Authorization = 'Bearer ' + store.data.token;
    return h;
  }

  function bump(delta) {
    inflight = Math.max(0, inflight + delta);
    let bar = document.getElementById('loading-bar');
    if (inflight > 0 && !bar) {
      bar = document.createElement('div');
      bar.id = 'loading-bar';
      bar.className = 'loading-bar';
      document.body.appendChild(bar);
    } else if (inflight === 0 && bar) {
      bar.remove();
    }
    apiEvents.dispatchEvent(new CustomEvent('change', { detail: { inflight } }));
  }

  async function api(path, opts) {
    const o = opts || {};
    const method = (o.method || 'GET').toUpperCase();
    if (o.silent !== true) bump(1);
    try {
      const res = await fetch('/api' + path, {
        method,
        headers: authHeaders(o.headers),
        body: o.body === undefined || o.body === null ? undefined : JSON.stringify(o.body),
        credentials: 'same-origin',
      });
      let payload = null;
      const text = await res.text();
      try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }

      if (res.status === 401) {
        // session expired
        store.clear();
        if (!/login/i.test(location.hash || '')) location.hash = '#/login';
        throw new ApiError('Sesi Anda telah berakhir. Silakan login kembali.', 401, payload);
      }
      if (!res.ok || (payload && payload.ok === false)) {
        const msg = (payload && payload.error) || `Permintaan gagal (${res.status})`;
        throw new ApiError(msg, res.status, payload);
      }
      return payload && payload.data !== undefined ? payload.data : payload;
    } finally {
      if (o.silent !== true) bump(-1);
    }
  }

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  /* ------------------------------- helpers ------------------------------ */
  const ID_MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const ID_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const ID_DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtDate(iso, opts) {
    if (!iso) return '—';
    const s = String(iso);
    const d = s.length === 10 ? new Date(s + 'T00:00:00Z') : new Date(s);
    if (isNaN(d)) return '—';
    const o = opts || {};
    const mon = ID_MONTHS[d.getUTCMonth()];
    if (o.short) return `${d.getUTCDate()} ${mon.slice(0, 3)} ${d.getUTCFullYear()}`;
    return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`;
  }
  /** Format a time in the school's local timezone (offset from settings). */
  function fmtTime(iso, offMin) {
    if (!iso) return '—';
    const off = offMin == null ? 420 : offMin;
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const s = new Date(d.getTime() + off * 60000);
    return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
  }
  function fmtDateTime(iso, offMin) {
    if (!iso) return '—';
    return `${fmtDate(iso, { short: true })} · ${fmtTime(iso, offMin)}`;
  }
  function timeAgo(iso) {
    if (!iso) return '—';
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 45) return 'baru saja';
    if (secs < 90) return '1 menit lalu';
    if (secs < 3600) return `${Math.floor(secs / 60)} menit lalu`;
    if (secs < 5400) return '1 jam lalu';
    if (secs < 86400) return `${Math.floor(secs / 3600)} jam lalu`;
    if (secs < 172800) return 'kemarin';
    return `${Math.floor(secs / 86400)} hari lalu`;
  }
  function localOffset() {
    const tz = (store.data.settings || {}).timezone || 'Asia/Jakarta';
    const map = { 'Asia/Jakarta': 420, 'Asia/Makassar': 300, 'Asia/Jayapura': 600, UTC: 0 };
    return map[tz] != null ? map[tz] : 420;
  }
  function dow(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return ID_DAYS[d.getUTCDay()];
  }
  function dowShort(dateStr) { return ID_DAYS_SHORT[new Date(dateStr + 'T00:00:00Z').getUTCDay()]; }
  function initials(name) {
    if (!name) return '?';
    const parts = String(name).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function avatarHTML(user, cls) {
    const c = cls || '';
    if (user && user.avatar) return `<img class="avatar ${c}" src="${esc(user.avatar)}" alt="${esc(user.name || '')}">`;
    const name = (user && user.name) || '?';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hues = ['#6366f1,#8b5cf6', '#0ea5e9,#22d3ee', '#f43f5e,#fb923c', '#10b981,#34d399', '#f59e0b,#fbbf24', '#8b5cf6,#ec4899', '#3b82f6,#6366f1', '#14b8a6,#0ea5e9'];
    const [a, b] = hues[h % hues.length].split(',');
    return `<span class="avatar ${c}" style="background:linear-gradient(135deg,${a},${b})">${esc(initials(name))}</span>`;
  }
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), ms || 260);
    };
  }
  function num(n, digits) {
    const d = digits == null ? 0 : digits;
    return Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function todayStr() {
    const off = localOffset();
    return new Date(Date.now() + off * 60000).toISOString().slice(0, 10);
  }
  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const ROLE_LABEL = { admin: 'Administrator', teacher: 'Guru', student: 'Peserta Didik', employee: 'Karyawan', parent: 'Orang Tua' };
  const ROLE_BADGE = { admin: 'badge-violet', teacher: 'badge-info', student: 'badge-brand', employee: 'badge-ok', parent: 'badge-warn' };
  const STATUS_LABEL = { present: 'Hadir', late: 'Terlambat', absent: 'Tidak Hadir', leave: 'Izin' };
  const STATUS_BADGE = { present: 'badge-ok', late: 'badge-warn', absent: 'badge-danger', leave: 'badge-info' };
  const REQ_STATUS_LABEL = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
  const REQ_STATUS_BADGE = { pending: 'badge-warn', approved: 'badge-ok', rejected: 'badge-danger' };
  const REQ_TYPE_BADGE = {
    Sickness: 'badge-danger', 'Family Agenda': 'badge-info',
    'Official Duty': 'badge-violet', Personal: 'badge-brand', Other: 'badge-muted',
  };

  /* -------------------------------- icons ------------------------------- */
  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    attendance: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    requests: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 15h6M9 11h3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/><path d="M10 6h8M10 10h8M10 14h5"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h.01"/>',
    pin: '<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M21 7h-6M21 7v6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    school: '<path d="M22 9 12 4 2 9l10 5 10-5Z"/><path d="M6 11.5V17c0 1.5 3 3 6 3s6-1.5 6-3v-5.5"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z"/>',
    phone2: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  };

  function icon(name, size, stroke) {
    const d = ICONS[name] || ICONS.info;
    const s = size || 18;
    const w = stroke || 2;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  /* -------------------------------- toast -------------------------------- */
  function toastHost() {
    let h = document.getElementById('toast-host');
    if (!h) {
      h = document.createElement('div');
      h.id = 'toast-host';
      h.className = 'toast-host';
      document.body.appendChild(h);
    }
    return h;
  }
  function toast(type, title, text, ms) {
    const host = toastHost();
    const icons = { ok: 'check', error: 'alert', warn: 'alert', info: 'info' };
    const el = document.createElement('div');
    el.className = `toast t-${type || 'info'}`;
    el.innerHTML = `
      <span class="toast-ico">${icon(icons[type] || 'info', 14, 2.6)}</span>
      <div class="toast-body">
        <div class="toast-title">${esc(title || '')}</div>
        ${text ? `<div class="toast-text">${esc(text)}</div>` : ''}
      </div>`;
    host.appendChild(el);
    const life = ms || (type === 'error' ? 5200 : 3400);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, life);
    return el;
  }
  const toastOk = (t, x) => toast('ok', t, x);
  const toastErr = (t, x) => toast('error', t, x);
  const toastWarn = (t, x) => toast('warn', t, x);
  const toastInfo = (t, x) => toast('info', t, x);

  /* -------------------------------- modal -------------------------------- */
  let openModals = [];

  function modal(opts) {
    const o = opts || {};
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const wide = o.wide ? 'modal-wide' : o.narrow ? 'modal-narrow' : '';
    backdrop.innerHTML = `
      <div class="modal ${wide}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="grow">
            <div class="modal-title">${esc(o.title || '')}</div>
            ${o.sub ? `<div class="modal-sub">${esc(o.sub)}</div>` : ''}
          </div>
          <button class="modal-close" type="button" aria-label="Tutup">${icon('x', 16, 2.4)}</button>
        </div>
        <div class="modal-body">${o.body || ''}</div>
        ${o.footer === null ? '' : `<div class="modal-foot">${o.footer || defaultFooter(o)}</div>`}
      </div>`;

    function close(result) {
      const i = openModals.indexOf(backdrop);
      if (i >= 0) openModals.splice(i, 1);
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose(result);
    }
    function onKey(e) {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === backdrop) close(null);
    }
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('.modal-close').addEventListener('click', () => close(null));
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    openModals.push(backdrop);

    const api = {
      el: backdrop,
      body: backdrop.querySelector('.modal-body'),
      close,
      setBusy(busy, label) {
        const btn = backdrop.querySelector('[data-submit]');
        if (!btn) return;
        btn.disabled = !!busy;
        if (busy) {
          btn.dataset.html = btn.innerHTML;
          btn.innerHTML = `<span class="spinner" style="width:15px;height:15px"></span>${esc(label || 'Menyimpan…')}`;
        } else if (btn.dataset.html) {
          btn.innerHTML = btn.dataset.html;
        }
      },
      error(msg) {
        let e = backdrop.querySelector('.modal-error');
        if (!e) {
          e = document.createElement('div');
          e.className = 'modal-error';
          e.style.cssText = 'margin:10px 22px 0;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:.82rem;font-weight:600;display:flex;gap:8px;align-items:flex-start';
          backdrop.querySelector('.modal-body').before(e);
        }
        e.innerHTML = `<span style="flex:none;margin-top:1px">${icon('alert', 15, 2.4)}</span><span>${esc(msg)}</span>`;
      },
      clearError() {
        const e = backdrop.querySelector('.modal-error');
        if (e) e.remove();
      },
    };

    if (o.onMount) o.onMount(api);
    // focus first field
    setTimeout(() => {
      const f = backdrop.querySelector('[data-autofocus]') || backdrop.querySelector('input:not([type=hidden]),select,textarea');
      if (f && f.focus) f.focus();
    }, 60);
    return api;
  }

  function defaultFooter(o) {
    return `
      <button class="btn" type="button" data-cancel>${esc(o.cancelText || 'Batal')}</button>
      <button class="btn btn-primary" type="button" data-submit>${esc(o.okText || 'Simpan')}</button>`;
  }

  function confirmDialog(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const m = modal({
        title: o.title || 'Konfirmasi',
        sub: o.sub || '',
        narrow: true,
        body: `<p style="font-size:.88rem;color:var(--ink-600);line-height:1.65">${esc(o.text || 'Apakah Anda yakin?')}</p>`,
        okText: o.okText || 'Ya, lanjutkan',
        cancelText: o.cancelText || 'Batal',
        onMount(m2) {
          const btn = m2.el.querySelector('[data-submit]');
          btn.className = 'btn ' + (o.danger ? 'btn-danger-solid' : 'btn-primary');
          m2.el.querySelector('[data-cancel]').addEventListener('click', () => { m2.close(false); resolve(false); });
          btn.addEventListener('click', () => { m2.close(true); resolve(true); });
        },
        onClose: (r) => { if (r === null) resolve(false); },
      });
      return m;
    });
  }

  /* ------------------------------ table bits ----------------------------- */
  function emptyRow(cols, opts) {
    const o = opts || {};
    return `<tr><td colspan="${cols}"><div class="empty">
      <div class="empty-ico">${icon(o.icon || 'inbox', 26, 1.8)}</div>
      <div class="empty-title">${esc(o.title || 'Belum ada data')}</div>
      <div class="empty-text">${esc(o.text || 'Data akan muncul di sini setelah ditambahkan.')}</div>
      ${o.action || ''}
    </div></td></tr>`;
  }
  function skeletonRows(cols, count, heights) {
    const n = count || 5;
    let out = '';
    for (let i = 0; i < n; i++) {
      out += '<tr>' + Array.from({ length: cols }).map((_, c) => {
        const w = heights && heights[c] ? heights[c] : (60 + ((i * 7 + c * 13) % 40));
        return `<td><div class="skeleton skel-line" style="width:${w}%"></div></td>`;
      }).join('') + '</tr>';
    }
    return out;
  }
  function pagerHTML(state, total, page, limit) {
    const pages = Math.max(1, Math.ceil(total / limit));
    const from = total ? (page - 1) * limit + 1 : 0;
    const to = Math.min(total, page * limit);
    let btns = `<button class="pg" data-pg="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">${icon('chevronLeft', 15, 2.4)}</button>`;
    const win = [];
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - page) <= 1) win.push(p);
      else if (win[win.length - 1] !== '…') win.push('…');
    }
    win.forEach((p) => {
      if (p === '…') btns += `<span class="dim" style="padding:0 3px">…</span>`;
      else btns += `<button class="pg ${p === page ? 'is-active' : ''}" data-pg="${p}">${p}</button>`;
    });
    btns += `<button class="pg" data-pg="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Berikutnya">${icon('chevronRight', 15, 2.4)}</button>`;
    return `<div class="pager">
      <div class="pager-info">Menampilkan <b>${num(from)}–${num(to)}</b> dari <b>${num(total)}</b> data</div>
      <div class="pager-btns">${btns}</div>
    </div>`;
  }

  /* ------------------------- form value helpers -------------------------- */
  function formValues(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.multiple && el.tagName === 'SELECT') out[el.name] = Array.from(el.selectedOptions).map((o) => o.value);
      else out[el.name] = el.value;
    });
    return out;
  }
  function setFormValues(root, values) {
    Object.keys(values || {}).forEach((k) => {
      const el = root.querySelector(`[name="${k}"]`);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!values[k];
      else el.value = values[k] == null ? '' : values[k];
    });
  }

  function compressImage(input, maxDim, quality) {
    const dim = maxDim || 640;
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

  global.Core = {
    store, api, ApiError, apiEvents,
    esc, icon, ICONS,
    toast, toastOk, toastErr, toastWarn, toastInfo,
    modal, confirmDialog,
    emptyRow, skeletonRows, pagerHTML,
    fmtDate, fmtTime, fmtDateTime, timeAgo, dow, dowShort, localOffset, todayStr, addDays,
    initials, avatarHTML, debounce, num,
    ROLE_LABEL, ROLE_BADGE, STATUS_LABEL, STATUS_BADGE, REQ_STATUS_LABEL, REQ_STATUS_BADGE, REQ_TYPE_BADGE,
    formValues, setFormValues, pad, ID_MONTHS, ID_DAYS,
    compressImage,
  };
})(window);
