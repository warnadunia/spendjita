/* ==========================================================================
   Admin pages — Requests, Announcements, News, Calendar, Extracurriculars,
                 Reports, Settings (PWA studio) and Activity log
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.Core;
  const L = global.ListEngine;
  const Pages = global.Pages;
  const H = global.PagesHelpers;
  const { userCell, statusBadge, roleBadge, reqStatusBadge, iconBtn, register } = H;

  /* ====================================================================== *
   *  Attachments & external links (admin-only authoring)
   * ---------------------------------------------------------------------- *
   *  Only an administrator can attach a file or paste a link, and both are
   *  validated again on the server. Members simply read them on the detail
   *  page in the mobile app.
   * ====================================================================== */
  // PDF first: an announcement attachment is normally an official circular
  // (surat edaran) or a letter from the principal.
  const ATTACH_ACCEPT = '.pdf,application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip';
  const ATTACH_MAX = 2 * 1024 * 1024; // raw bytes, before base64 expansion

  function sizeFmt(b) {
    const v = Number(b) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  }
  function isImageAtt(a) { return !!(a && a.data && /^data:image\//i.test(a.data)); }
  function isPdfAtt(a) {
    return !!(a && a.data && (/^data:application\/pdf/i.test(a.data) || /\.pdf$/i.test(a.name || '')));
  }
  function hostOf(url) {
    try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch (e) { return String(url || ''); }
  }

  /** Compact chips shown on a card when the item carries media. */
  function mediaChips(r) {
    const out = [];
    if (r.attachment && r.attachment.data) {
      const pdf = isPdfAtt(r.attachment);
      out.push(`<span class="chip ${pdf ? 'chip-pdf' : 'chip-file'}">${C.icon(pdf ? 'news' : 'paperclip', 12, 2.4)} ${C.esc(r.attachment.name || 'Lampiran')} · ${C.esc(sizeFmt(r.attachment.size))}</span>`);
    }
    if (r.link_url) {
      out.push(`<span class="chip chip-link">${C.icon('link', 12, 2.4)} ${C.esc(r.link_label || hostOf(r.link_url))}</span>`);
    }
    return out.length ? `<div class="row gap-6 wrap mt-8" style="margin-top:8px">${out.join('')}</div>` : '';
  }

  /** The attachment picker + external-link pair inside a form. */
  function mediaFields(r) {
    return `
      <div class="field mb-12">
        <label class="label">Lampiran (opsional)</label>
        <div class="att-pick" id="att-box"></div>
        <div class="row gap-6" style="margin-top:8px">
          <button type="button" class="btn btn-sm" data-att="pick">${C.icon('upload', 14, 2.3)} Pilih berkas PDF</button>
          <span class="text-xs dim">PDF (surat edaran / surat keputusan), gambar atau dokumen · maks. 2 MB</span>
        </div>
      </div>
      <div class="form-grid mb-12">
        <div class="field">
          <label class="label">Tautan eksternal (opsional)</label>
          <input class="input" name="link_url" placeholder="https://contoh.sch.id/pengumuman" value="${C.esc((r && r.link_url) || '')}">
        </div>
        <div class="field">
          <label class="label">Label tautan</label>
          <input class="input" name="link_label" placeholder="mis. Form pendaftaran" value="${C.esc((r && r.link_label) || '')}">
        </div>
      </div>`;
  }

  /** Wire the picker up; returns { apply(v) } to merge into the payload. */
  function bindMediaForm(api, r) {
    const state = {
      data: (r && r.attachment && r.attachment.data) ? r.attachment : null,
      changed: false,
    };
    const orig = (r && r.attachment && r.attachment.data) || null;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ATTACH_ACCEPT;
    input.style.display = 'none';
    api.body.appendChild(input);

    function paint() {
      const host = api.body.querySelector('#att-box');
      if (!host) return;
      host.innerHTML = state.data ? `
        <span class="att-ico">${C.icon('paperclip', 16, 2.3)}</span>
        <span class="grow" style="min-width:0">
          <b class="ellipsis" style="display:block">${C.esc(state.data.name || 'Lampiran')}</b>
          <span class="att-sub">${C.esc(state.data.type || 'Berkas')} · ${C.esc(sizeFmt(state.data.size))}</span>
        </span>
        <button type="button" class="icon-btn btn-sm" data-att="clear" title="Hapus lampiran">${C.icon('x', 14, 2.4)}</button>`
        : `
        <span class="att-ico is-empty">${C.icon('paperclip', 16, 2.3)}</span>
        <span class="grow"><b>Belum ada lampiran</b>
          <span class="att-sub">Lampirkan PDF surat edaran / surat keputusan</span>
        </span>`;
      const clr = host.querySelector('[data-att="clear"]');
      if (clr) clr.addEventListener('click', () => { state.data = null; state.changed = true; paint(); });
    }

    api.body.querySelectorAll('[data-att="pick"]').forEach((b) => b.addEventListener('click', () => input.click()));
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return;
      if (f.size > ATTACH_MAX) { C.toastErr('Terlalu besar', 'Ukuran lampiran maksimal 2 MB.'); input.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => {
        state.data = { name: f.name, type: f.type || 'application/octet-stream', size: f.size, data: String(rd.result) };
        state.changed = true;
        paint();
      };
      rd.readAsDataURL(f);
      input.value = '';
    });
    paint();

    return {
      apply(v) {
        if (state.changed) v.attachment = state.data;      // null clears it
        else if (state.data && state.data.data !== orig) v.attachment = state.data;
        return v;
      },
    };
  }

  /** Read-only preview of the member-facing detail page. */
  function mediaDetailHTML(r, kind) {
    const a = r.attachment;
    let att = '';
    if (a && a.data) {
      att = isPdfAtt(a)
        ? `<div class="att-pdf">
             <div class="att-pdf-head">
               <span class="att-file-ico" style="background:var(--danger-50);color:var(--danger)">${C.icon('news', 17, 2.3)}</span>
               <span class="grow" style="min-width:0">
                 <b class="ellipsis" style="display:block">${C.esc(a.name || 'Dokumen PDF')}</b>
                 <span class="att-sub">PDF · ${C.esc(sizeFmt(a.size))}</span>
               </span>
               <a class="btn btn-sm" href="${C.esc(a.data)}" download="${C.esc(a.name || 'dokumen.pdf')}" target="_blank" rel="noopener">${C.icon('download', 14, 2.4)} Unduh</a>
             </div>
             <iframe class="att-pdf-frame" src="${C.esc(a.data)}" title="${C.esc(a.name || 'Dokumen PDF')}"></iframe>
           </div>`
        : isImageAtt(a)
        ? `<div class="att-view">
             <img src="${C.esc(a.data)}" alt="${C.esc(a.name || 'lampiran')}">
             <div class="att-view-bar">
               <span class="row gap-6 grow ellipsis">${C.icon('paperclip', 13, 2.4)} ${C.esc(a.name || 'Gambar')} · ${C.esc(sizeFmt(a.size))}</span>
               <a class="btn btn-sm" href="${C.esc(a.data)}" download="${C.esc(a.name || 'lampiran')}" target="_blank" rel="noopener">${C.icon('download', 14, 2.4)} Unduh</a>
             </div>
           </div>`
        : `<a class="att-file" href="${C.esc(a.data)}" download="${C.esc(a.name || 'lampiran')}" target="_blank" rel="noopener">
             <span class="att-file-ico">${C.icon('paperclip', 17, 2.3)}</span>
             <span class="grow" style="min-width:0">
               <b class="ellipsis" style="display:block">${C.esc(a.name || 'Lampiran')}</b>
               <span class="att-sub">${C.esc(a.type || 'Berkas')} · ${C.esc(sizeFmt(a.size))}</span>
             </span>
             ${C.icon('download', 16, 2.3)}
           </a>`;
    }
    const link = r.link_url ? `
      <a class="att-link" href="${C.esc(r.link_url)}" target="_blank" rel="noopener">
        <span class="att-file-ico" style="background:var(--info-50);color:var(--info)">${C.icon('external', 17, 2.3)}</span>
        <span class="grow" style="min-width:0">
          <b class="ellipsis" style="display:block">${C.esc(r.link_label || 'Buka tautan')}</b>
          <span class="att-sub">${C.esc(hostOf(r.link_url))}</span>
        </span>
        ${C.icon('chevronRight', 15, 2.4)}
      </a>` : '';
    return att + link;
  }

  /** Open the detail page the member sees, as a read-only admin preview. */
  function openMediaDetail(kind, r) {
    C.modal({
      title: kind === 'news' ? 'Detail berita' : 'Detail pengumuman',
      sub: r.title,
      wide: true,
      footer: null,
      body: `
        <div class="att-hero" style="${kind === 'news' ? '--tone:var(--info-50);--fg:var(--info)' : '--tone:var(--brand-50);--fg:var(--brand)'}">
          <span class="att-hero-ico">${C.icon(kind === 'news' ? 'news' : 'megaphone', 20, 2.2)}</span>
          <div class="grow" style="min-width:0">
            <div style="font-size:1.05rem;font-weight:800;letter-spacing:-.02em">${C.esc(r.title)}</div>
            <div class="text-xs muted mt-8" style="margin-top:4px">
              ${kind === 'news'
                ? `${C.esc(r.category || 'Umum')} · ${C.num(r.views || 0)} kali dilihat`
                : `${C.esc(r.audience || 'Semua')}${r.is_pinned ? ' · Disematkan' : ''}`}
            </div>
          </div>
        </div>
        <div class="form-grid mb-12">
          <div><div class="text-xs dim">Tanggal</div><b>${C.fmtDate(r.date)}</b></div>
          <div><div class="text-xs dim">Waktu</div><b>${C.esc(r.time || '—')}</b></div>
          <div><div class="text-xs dim">${kind === 'news' ? 'Penulis' : 'Lokasi'}</div><b>${C.esc(kind === 'news' ? (r.author || '—') : (r.location || '—'))}</b></div>
        </div>
        <div class="text-sm" style="line-height:1.8;white-space:pre-wrap;color:var(--ink-700)">${C.esc(r.details || '')}</div>
        ${mediaDetailHTML(r, kind)}
        <div class="text-xs dim" style="margin-top:14px">
          ${kind === 'news' ? 'Diterbitkan' : 'Diterbitkan oleh ' + C.esc(r.author || 'Administrator')} · ${C.esc(C.timeAgo(r.created_at))}
        </div>`,
    });
  }

  /* =============================== REQUESTS ============================= */
  register('requests', {
    title: 'Permohonan Izin',
    sub: 'Sakit, agenda keluarga, dinas dan lainnya',
    icon: 'requests',
    group: 'Sekolah',
    badgeKey: 'pending',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Permohonan</div>
            <div class="view-sub">Tinjau dan setujui permohonan izin warga sekolah</div>
          </div>
          <div class="row gap-8 wrap" id="req-counts"></div>
        </div>
        <div id="req-list"></div>`;

      const list = L.createList({
        el: root.querySelector('#req-list'),
        endpoint: '/admin/requests',
        limit: 20,
        search: true,
        searchPlaceholder: 'Cari nama, judul, jenis…',
        pollMs: 45000,
        filters: [
          { name: 'status', label: 'Status', placeholder: 'Semua status', options: [
            { value: 'pending', label: 'Menunggu' }, { value: 'approved', label: 'Disetujui' }, { value: 'rejected', label: 'Ditolak' }] },
          { name: 'type', label: 'Jenis', placeholder: 'Semua jenis', options: [
            'Sickness', 'Family Agenda', 'Official Duty', 'Personal', 'Other'].map((t) => ({ value: t, label: t })) },
        ],
        onLoaded: (d) => {
          const counts = d.counts || {};
          root.querySelector('#req-counts').innerHTML = [
            ['Semua', counts.all || 0, ''],
            ['Menunggu', counts.pending || 0, 'badge-warn'],
            ['Disetujui', counts.approved || 0, 'badge-ok'],
            ['Ditolak', counts.rejected || 0, 'badge-danger'],
          ].map(([l, v, cls]) => `<button class="chip ${cls ? '' : ''}" data-filter-status="${l === 'Semua' ? '' : l.toLowerCase()}">${C.esc(l)} <b>${v}</b></button>`).join('');
          root.querySelectorAll('[data-filter-status]').forEach((b) => {
            b.addEventListener('click', () => {
              const map = { '': '', 'menunggu': 'pending', 'disetujui': 'approved', 'ditolak': 'rejected' };
              list.setFilter('status', map[b.dataset.filterStatus] || '');
            });
          });
        },
        columns: [
          { label: 'Pemohon', key: 'user_name', render: (r) => userCell({ name: r.user_name, id_number: r.id_number }) },
          { label: 'Jenis', key: 'type', width: '130px', render: (r) => `<span class="badge ${C.REQ_TYPE_BADGE[r.type] || 'badge-muted'}">${C.esc(r.type)}</span>` },
          { label: 'Perihal', key: 'title', render: (r) => `<div>
              <div class="semibold">${C.esc(r.title)}</div>
              <div class="text-xs muted ellipsis" style="max-width:280px">${C.esc(r.details || '')}</div></div>` },
          { label: 'Tanggal', key: 'from_date', width: '148px', render: (r) => `<div class="text-sm">
              ${C.fmtDate(r.from_date, { short: true })}${r.to_date !== r.from_date ? ' – ' + C.fmtDate(r.to_date, { short: true }) : ''}</div>` },
          { label: 'Diajukan', key: 'created_at', width: '106px', render: (r) => `<span class="text-sm muted">${C.timeAgo(r.created_at)}</span>` },
          { label: 'Status', key: 'status', width: '118px', render: (r) => reqStatusBadge(r.status) },
        ],
        rowActions: (r) => r.status === 'pending'
          ? `${iconBtn('approve', 'check', 'Setujui')} ${iconBtn('reject', 'x', 'Tolak')} ${iconBtn('delete', 'trash', 'Hapus')}`
          : `${iconBtn('view', 'eye', 'Lihat')} ${iconBtn('delete', 'trash', 'Hapus')}`,
        empty: { icon: 'check', title: 'Tidak ada permohonan', text: 'Semua permohonan sudah diproses atau filter yang dipilih tidak cocok.' },
      });

      root.querySelector('#req-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const rec = (list.state.data.items || []).find((r) => r.id === tr.dataset.id);
        if (!rec) return;
        const act = btn.dataset.act;
        if (act === 'approve') this.decide(rec, 'approved', list);
        if (act === 'reject') this.decide(rec, 'rejected', list);
        if (act === 'view') this.openView(rec);
        if (act === 'delete') this.remove(rec, list);
      });

      list.load();
    },

    async decide(rec, status, list) {
      const m = C.modal({
        title: status === 'approved' ? 'Setujui permohonan' : 'Tolak permohonan',
        sub: `${rec.user_name} · ${rec.title}`,
        narrow: true,
        okText: status === 'approved' ? 'Setujui' : 'Tolak',
        body: `
          <div class="card" style="box-shadow:none;background:var(--ink-50);margin-bottom:14px">
            <div class="card-body" style="padding:14px">
              <div class="row gap-8 mb-8"><span class="badge ${C.REQ_TYPE_BADGE[rec.type]}">${C.esc(rec.type)}</span>
                <span class="text-xs muted">${C.fmtDate(rec.from_date, { short: true })}${rec.to_date !== rec.from_date ? ' – ' + C.fmtDate(rec.to_date, { short: true }) : ''}</span></div>
              <div class="semibold mb-4">${C.esc(rec.title)}</div>
              <div class="text-sm muted" style="line-height:1.65">${C.esc(rec.details || '—')}</div>
            </div>
          </div>
          <div class="field">
            <label class="label">Catatan peninjauan</label>
            <textarea class="textarea" name="review_note" data-autofocus placeholder="${status === 'approved' ? 'mis. Izin disetujui, semoga lekas sembuh.' : 'mis. Mohon lampirkan surat keterangan dokter.'}"></textarea>
          </div>`,
        onMount(api) {
          const btn = api.el.querySelector('[data-submit]');
          btn.className = 'btn ' + (status === 'approved' ? 'btn-ok' : 'btn-danger-solid');
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          btn.addEventListener('click', async () => {
            api.setBusy(true, 'Memproses…');
            try {
              const v = C.formValues(api.body);
              await C.api('/admin/requests/' + rec.id, { method: 'PUT', body: { status, review_note: v.review_note } });
              api.close();
              C.toastOk(status === 'approved' ? 'Permohonan disetujui' : 'Permohonan ditolak', `${rec.title} · ${rec.user_name}`);
              list.load();
            } catch (err) { api.setBusy(false); C.toastErr('Gagal', err.message); }
          });
        },
      });
      return m;
    },

    openView(rec) {
      C.modal({
        title: rec.title,
        sub: `${rec.user_name} · ${C.ROLE_LABEL[rec.role]}`,
        narrow: true,
        footer: '<button class="btn" data-cancel>Tutup</button>',
        body: `
          <div class="row gap-8 mb-12">${reqStatusBadge(rec.status)}<span class="badge ${C.REQ_TYPE_BADGE[rec.type]}">${C.esc(rec.type)}</span></div>
          <dl class="kv mb-12">
            <dt>Tanggal</dt><dd>${C.fmtDate(rec.from_date)}${rec.to_date !== rec.from_date ? ' – ' + C.fmtDate(rec.to_date) : ''}</dd>
            <dt>Diajukan</dt><dd>${C.fmtDateTime(rec.created_at, C.localOffset())}</dd>
            <dt>Peninjau</dt><dd>${C.esc(rec.reviewed_by || '—')}</dd>
          </dl>
          <div class="card" style="box-shadow:none;background:var(--ink-50)"><div class="card-body" style="padding:14px">
            <div class="text-sm" style="line-height:1.7">${C.esc(rec.details || '—')}</div>
            ${rec.review_note ? `<div class="divider"></div><div class="text-sm"><b>Catatan:</b> ${C.esc(rec.review_note)}</div>` : ''}
          </div></div>`,
        onMount(api) { api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close()); },
      });
    },

    async remove(rec, list) {
      const ok = await C.confirmDialog({ title: 'Hapus permohonan?', text: `Permohonan "${rec.title}" akan dihapus permanen.`, okText: 'Ya, hapus', danger: true });
      if (!ok) return;
      list.optimistic(rec.id, () => C.api('/admin/requests/' + rec.id, { method: 'DELETE' }), { remove: true, success: { title: 'Dihapus' } }).catch(() => {});
    },
  });

  /* ============================ ANNOUNCEMENTS ========================== */
  register('announcements', {
    title: 'Pengumuman',
    sub: 'Tanggal, waktu, judul, lokasi dan detail',
    icon: 'megaphone',
    group: 'Komunikasi',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Pengumuman</div>
            <div class="view-sub">Sampaikan informasi penting kepada warga sekolah</div>
          </div>
          <button class="btn btn-primary" id="ann-add">${C.icon('plus', 16, 2.4)} Buat Pengumuman</button>
        </div>
        <div id="ann-grid" class="grid-2"></div>`;
      const grid = root.querySelector('#ann-grid');
      root.querySelector('#ann-add').addEventListener('click', () => this.openForm(null, () => this.load(root)));
      grid.innerHTML = '<div class="card"><div class="card-body">' + Array.from({ length: 6 }).map(() => '<div class="skeleton skel-line" style="height:64px;margin-bottom:10px"></div>').join('') + '</div></div>';
      this.load(root);
    },
    async load(root) {
      const grid = root.querySelector('#ann-grid');
      try {
        const d = await C.api('/admin/announcements');
        const items = d.items || [];
        if (!items.length) {
          grid.innerHTML = `<div class="card"><div class="empty">
            <div class="empty-ico">${C.icon('megaphone', 26, 1.8)}</div>
            <div class="empty-title">Belum ada pengumuman</div>
            <div class="empty-text">Buat pengumuman pertama agar tampil di dasbor aplikasi seluler.</div>
            <button class="btn btn-primary mt-8" id="ann-first">${C.icon('plus', 15, 2.4)} Buat Pengumuman</button>
          </div></div>`;
          const b = grid.querySelector('#ann-first');
          if (b) b.addEventListener('click', () => this.openForm(null, () => this.load(root)));
          return;
        }
        grid.innerHTML = items.map((a) => `
          <div class="card slide-up">
            <div class="card-body">
              <div class="row between gap-8 mb-8">
                <div class="row gap-6 wrap">
                  ${a.is_pinned ? '<span class="ann-pin">${"📌"}</span>' : ''}
                  <span class="badge badge-brand">${C.esc(a.audience)}</span>
                </div>
                <div class="row gap-4">
                  <button class="icon-btn btn-sm" data-view="${a.id}" title="Lihat halaman detail">${C.icon('eye', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-pin="${a.id}" title="${a.is_pinned ? 'Lepas sematan' : 'Sematkan'}">${C.icon('pin', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-edit="${a.id}" title="Ubah">${C.icon('edit', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-del="${a.id}" title="Hapus">${C.icon('trash', 15, 2.2)}</button>
                </div>
              </div>
              <h3 style="font-size:1rem;margin-bottom:8px">${C.esc(a.title)}</h3>
              <div class="row gap-12 wrap text-xs muted mb-8">
                <span class="row gap-4">${C.icon('calendar', 13, 2.3)} ${C.fmtDate(a.date, { short: true })}</span>
                <span class="row gap-4">${C.icon('clock', 13, 2.3)} ${C.esc(a.time || '')}</span>
                <span class="row gap-4">${C.icon('map', 13, 2.3)} ${C.esc(a.location || '—')}</span>
              </div>
              <p class="text-sm muted" style="line-height:1.7">${C.esc(a.details)}</p>
              ${mediaChips(a)}
              <div class="text-xs dim mt-12">Oleh ${C.esc(a.author)} · ${C.timeAgo(a.created_at)}</div>
            </div>
          </div>`).join('');

        grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
          const a = items.find((x) => x.id === b.dataset.edit);
          this.openForm(a, () => this.load(root));
        }));
        grid.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
          const a = items.find((x) => x.id === b.dataset.view);
          if (a) openMediaDetail('announcement', a);
        }));
        grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          const a = items.find((x) => x.id === b.dataset.del);
          if (!await C.confirmDialog({ title: 'Hapus pengumuman?', text: `"${a.title}" akan dihapus permanen.`, okText: 'Ya, hapus', danger: true })) return;
          try { await C.api('/admin/announcements/' + a.id, { method: 'DELETE' }); C.toastOk('Dihapus', 'Pengumuman berhasil dihapus.'); this.load(root); }
          catch (err) { C.toastErr('Gagal', err.message); }
        }));
        grid.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
          const a = items.find((x) => x.id === b.dataset.pin);
          try {
            await C.api('/admin/announcements/' + a.id, { method: 'PUT', body: { is_pinned: !a.is_pinned } });
            C.toastOk(a.is_pinned ? 'Sematan dilepas' : 'Disematkan', a.title);
            this.load(root);
          } catch (err) { C.toastErr('Gagal', err.message); }
        }));
      } catch (err) {
        grid.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div></div>`;
      }
    },
    openForm(a, done) {
      const isEdit = !!a;
      const m = C.modal({
        title: isEdit ? 'Ubah pengumuman' : 'Buat pengumuman',
        sub: 'Tanggal, waktu, judul, lokasi dan detail',
        wide: true,
        okText: isEdit ? 'Simpan' : 'Terbitkan',
        body: `
          <div class="field mb-12">
            <label class="label">Judul <span class="req">*</span></label>
            <input class="input" name="title" data-autofocus placeholder="mis. Ujian Akhir Semester Ganjil" value="${C.esc(a ? a.title : '')}">
          </div>
          <div class="form-grid mb-12">
            <div class="field"><label class="label">Tanggal</label><input class="input" type="date" name="date" value="${C.esc(a ? a.date : C.todayStr())}"></div>
            <div class="field"><label class="label">Waktu</label><input class="input" type="time" name="time" value="${C.esc(a ? a.time : '07:30')}"></div>
            <div class="field"><label class="label">Lokasi</label><input class="input" name="location" placeholder="mis. Aula Utama" value="${C.esc(a ? a.location : '')}"></div>
            <div class="field"><label class="label">Audien</label><select class="select" name="audience">
              ${['Semua', 'Peserta Didik', 'Guru & Karyawan'].map((o) => `<option ${a && a.audience === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select></div>
          </div>
          <div class="field mb-12">
            <label class="label">Detail <span class="req">*</span></label>
            <textarea class="textarea" name="details" placeholder="Tuliskan isi pengumuman secara lengkap…">${C.esc(a ? a.details : '')}</textarea>
          </div>
          ${mediaFields(a)}
          <label class="check"><input type="checkbox" name="is_pinned" ${a && a.is_pinned ? 'checked' : ''}> Sematkan di bagian atas aplikasi seluler</label>`,
        onMount(api) {
          const media = bindMediaForm(api, a);
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = media.apply(C.formValues(api.body));
            if (!v.title || v.title.trim().length < 3) return m.error('Judul minimal 3 karakter.');
            if (!v.details || v.details.trim().length < 5) return m.error('Detail pengumuman minimal 5 karakter.');
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = isEdit
                ? await C.api('/admin/announcements/' + a.id, { method: 'PUT', body: v })
                : await C.api('/admin/announcements', { method: 'POST', body: v });
              api.close();
              C.toastOk(isEdit ? 'Disimpan' : 'Diterbitkan', res.message || v.title);
              done && done();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      return m;
    },
    create() { return this.openForm(null, () => location.reload()); },
  });

  /* ================================= NEWS =============================== */
  register('news', {
    title: 'Berita & Informasi',
    sub: 'Tanggal, waktu, judul dan detail',
    icon: 'news',
    group: 'Komunikasi',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Berita & Informasi</div>
            <div class="view-sub">Publikasikan kabar dan informasi sekolah</div>
          </div>
          <button class="btn btn-primary" id="news-add">${C.icon('plus', 16, 2.4)} Tulis Berita</button>
        </div>
        <div id="news-grid"></div>`;
      const grid = root.querySelector('#news-grid');
      root.querySelector('#news-add').addEventListener('click', () => this.openForm(null, () => this.load(root)));
      grid.innerHTML = '<div class="card"><div class="card-body">' + Array.from({ length: 4 }).map(() => '<div class="skeleton skel-line" style="height:74px;margin-bottom:10px"></div>').join('') + '</div></div>';
      this.load(root);
    },
    async load(root) {
      const host = root.querySelector('#news-grid');
      try {
        const d = await C.api('/admin/news');
        const items = d.items || [];
        if (!items.length) {
          host.innerHTML = `<div class="card"><div class="empty">
            <div class="empty-ico">${C.icon('news', 26, 1.8)}</div>
            <div class="empty-title">Belum ada berita</div>
            <div class="empty-text">Tulis berita pertama untuk ditampilkan di aplikasi seluler.</div>
            <button class="btn btn-primary mt-8" id="news-first">${C.icon('plus', 15, 2.4)} Tulis Berita</button>
          </div></div>`;
          const b = host.querySelector('#news-first');
          if (b) b.addEventListener('click', () => this.openForm(null, () => this.load(root)));
          return;
        }
        host.innerHTML = items.map((n) => `
          <div class="card mb-16 slide-up">
            <div class="card-body">
              <div class="row between gap-12 wrap">
                <div class="grow" style="min-width:0">
                  <div class="row gap-6 wrap mb-8">
                    <span class="badge badge-info">${C.esc(n.category)}</span>
                    <span class="text-xs muted row gap-4">${C.icon('calendar', 13, 2.3)} ${C.fmtDate(n.date, { short: true })}</span>
                    <span class="text-xs muted row gap-4">${C.icon('clock', 13, 2.3)} ${C.esc(n.time || '')}</span>
                    <span class="text-xs muted row gap-4">${C.icon('eye', 13, 2.3)} ${C.num(n.views)} dilihat</span>
                  </div>
                  <h3 style="font-size:1.02rem;margin-bottom:8px">${C.esc(n.title)}</h3>
                  <p class="text-sm muted" style="line-height:1.75">${C.esc(n.details)}</p>
                  ${mediaChips(n)}
                  <div class="text-xs dim mt-12">Oleh ${C.esc(n.author)}</div>
                </div>
                <div class="row gap-4" style="align-self:flex-start">
                  <button class="icon-btn btn-sm" data-view="${n.id}" title="Lihat halaman detail">${C.icon('eye', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-edit="${n.id}" title="Ubah">${C.icon('edit', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-del="${n.id}" title="Hapus">${C.icon('trash', 15, 2.2)}</button>
                </div>
              </div>
            </div>
          </div>`).join('');
        host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
          const n = items.find((x) => x.id === b.dataset.edit);
          this.openForm(n, () => this.load(root));
        }));
        host.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
          const n = items.find((x) => x.id === b.dataset.view);
          if (n) openMediaDetail('news', n);
        }));
        host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          const n = items.find((x) => x.id === b.dataset.del);
          if (!await C.confirmDialog({ title: 'Hapus berita?', text: `"${n.title}" akan dihapus permanen.`, okText: 'Ya, hapus', danger: true })) return;
          try { await C.api('/admin/news/' + n.id, { method: 'DELETE' }); C.toastOk('Dihapus', 'Berita berhasil dihapus.'); this.load(root); }
          catch (err) { C.toastErr('Gagal', err.message); }
        }));
      } catch (err) {
        host.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div></div>`;
      }
    },
    openForm(n, done) {
      const isEdit = !!n;
      const m = C.modal({
        title: isEdit ? 'Ubah berita' : 'Tulis berita',
        sub: 'Tanggal, waktu, judul dan detail',
        wide: true,
        okText: isEdit ? 'Simpan' : 'Terbitkan',
        body: `
          <div class="field mb-12">
            <label class="label">Judul <span class="req">*</span></label>
            <input class="input" name="title" data-autofocus value="${C.esc(n ? n.title : '')}">
          </div>
          <div class="form-grid mb-12">
            <div class="field"><label class="label">Tanggal</label><input class="input" type="date" name="date" value="${C.esc(n ? n.date : C.todayStr())}"></div>
            <div class="field"><label class="label">Waktu</label><input class="input" type="time" name="time" value="${C.esc(n ? n.time : '10:00')}"></div>
            <div class="field"><label class="label">Kategori</label>
              <select class="select" name="category">
                ${['Prestasi', 'Akademik', 'Penerimaan', 'Karyawan', 'Fasilitas', 'Umum'].map((o) => `<option ${n && n.category === o ? 'selected' : ''}>${o}</option>`).join('')}
              </select></div>
            <div class="field"><label class="label">Penulis</label><input class="input" name="author" value="${C.esc(n ? n.author : 'Tim Komunikasi Sekolah')}"></div>
          </div>
          <div class="field mb-12">
            <label class="label">Isi berita <span class="req">*</span></label>
            <textarea class="textarea" name="details" style="min-height:150px">${C.esc(n ? n.details : '')}</textarea>
          </div>
          ${mediaFields(n)}`,
        onMount(api) {
          const media = bindMediaForm(api, n);
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = media.apply(C.formValues(api.body));
            if (!v.title || v.title.trim().length < 3) return m.error('Judul minimal 3 karakter.');
            if (!v.details || v.details.trim().length < 5) return m.error('Isi berita minimal 5 karakter.');
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = isEdit ? await C.api('/admin/news/' + n.id, { method: 'PUT', body: v })
                                 : await C.api('/admin/news', { method: 'POST', body: v });
              api.close(); C.toastOk(isEdit ? 'Disimpan' : 'Diterbitkan', res.message || v.title); done && done();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      return m;
    },
    create() { return this.openForm(null, () => location.reload()); },
  });

  /* =============================== CALENDAR ============================= */
  register('calendar', {
    title: 'Kalender Akademik',
    sub: 'Agenda, ujian, hari libur dan rapat',
    icon: 'calendar',
    group: 'Sekolah',
    render(root) {
      this._root = root;
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Kalender Akademik</div>
            <div class="view-sub">Atur agenda, ujian, hari libur dan kegiatan sekolah</div>
          </div>
          <div class="row gap-8">
            <div class="row gap-4">
              <button class="icon-btn" id="cal-prev" title="Bulan sebelumnya">${C.icon('chevronLeft', 16, 2.4)}</button>
              <button class="btn" id="cal-today">Hari ini</button>
              <button class="icon-btn" id="cal-next" title="Bulan berikutnya">${C.icon('chevronRight', 16, 2.4)}</button>
            </div>
            <button class="btn btn-primary" id="cal-add">${C.icon('plus', 16, 2.4)} Tambah Acara</button>
          </div>
        </div>
        <div class="grid-2-1">
          <div class="card">
            <div class="card-head"><div class="card-title" id="cal-title"></div><div class="row gap-6" id="cal-legend"></div></div>
            <div class="card-body"><div id="cal-grid"></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Daftar acara</div></div>
            <div class="feed" id="cal-list"></div>
          </div>
        </div>`;

      const cur = this.cursor();
      root.querySelector('#cal-prev').addEventListener('click', () => { cur.m--; if (cur.m < 0) { cur.m = 11; cur.y--; } this.draw(root); });
      root.querySelector('#cal-next').addEventListener('click', () => { cur.m++; if (cur.m > 11) { cur.m = 0; cur.y++; } this.draw(root); });
      root.querySelector('#cal-today').addEventListener('click', () => {
        const n = new Date(); cur.y = n.getUTCFullYear(); cur.m = n.getUTCMonth(); this.draw(root);
      });
      root.querySelector('#cal-add').addEventListener('click', () => this.openForm(null, () => this.draw(root)));
      this.draw(root);
    },

    /** Shared month cursor for the calendar grid. */
    cursor() {
      if (!this._cursor) {
        const n = new Date(Date.now() + C.localOffset() * 60000);
        this._cursor = { y: n.getUTCFullYear(), m: n.getUTCMonth() };
      }
      return this._cursor;
    },

    async draw(root) {
      const cur = this.cursor();
      const titleEl = root.querySelector('#cal-title');
      const gridEl = root.querySelector('#cal-grid');
      const listEl = root.querySelector('#cal-list');
      if (!gridEl) return;
      titleEl.textContent = `${C.ID_MONTHS[cur.m]} ${cur.y}`;
      gridEl.innerHTML = '<div class="skeleton" style="height:280px"></div>';
      let d;
      try {
        d = await C.api('/admin/events');
      } catch (err) {
        gridEl.innerHTML = `<div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div>`;
        return;
      }
      const events = d.items || [];
      this._events = events;

      const first = new Date(Date.UTC(cur.y, cur.m, 1));
      const startDow = first.getUTCDay();
      const daysInMonth = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate();
      const todayIso = C.todayStr();

      const cells = [];
      for (let i = 0; i < startDow; i++) {
        const prevDate = new Date(Date.UTC(cur.y, cur.m, 1 - (startDow - i)));
        cells.push({ out: true, iso: prevDate.toISOString().slice(0, 10), day: prevDate.getUTCDate() });
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${cur.y}-${C.pad(cur.m + 1)}-${C.pad(day)}`;
        cells.push({ out: false, iso, day });
      }
      while (cells.length % 7 !== 0) cells.push({ out: true, iso: '', day: '' });
      while (cells.length < 42) cells.push({ out: true, iso: '', day: '' });

      gridEl.innerHTML = `
        <div class="cal-grid">
          ${C.ID_DAYS.map((dow) => `<div class="cal-dow">${dow.slice(0, 3)}</div>`).join('')}
          ${cells.map((c) => {
            if (!c.iso) return '<div class="cal-cell is-out"></div>';
            const evs = events.filter((e) => c.iso >= e.date && c.iso <= (e.end_date || e.date));
            return `<div class="cal-cell ${c.out ? 'is-out' : ''} ${c.iso === todayIso ? 'is-today' : ''}">
              <div class="cal-day">${c.day}</div>
              ${evs.slice(0, 3).map((e) => `<div class="cal-ev t-${e.type}" data-ev="${e.id}" title="${C.esc(e.title)}">${C.esc(e.title)}</div>`).join('')}
              ${evs.length > 3 ? `<div class="cal-ev" style="background:var(--ink-100);color:var(--ink-500)">+${evs.length - 3} lagi</div>` : ''}
            </div>`;
          }).join('')}
        </div>`;

      root.querySelector('#cal-legend').innerHTML = [
        ['academic', 'Akademik', 'var(--brand)'], ['exam', 'Ujian', 'var(--danger)'],
        ['holiday', 'Libur', 'var(--ok)'], ['meeting', 'Rapat', 'var(--warn)'],
      ].map(([k, l, c]) => `<span class="badge badge-muted"><i class="badge-dot" style="background:${c}"></i>${l}</span>`).join('');

      gridEl.querySelectorAll('[data-ev]').forEach((el) => {
        el.addEventListener('click', () => {
          const e = events.find((x) => x.id === el.dataset.ev);
          if (e) this.openForm(e, () => this.draw(root));
        });
      });

      const upcoming = events.filter((e) => (e.end_date || e.date) >= todayIso)
        .sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 14);
      listEl.innerHTML = upcoming.length ? upcoming.map((e) => `
        <div class="feed-item">
          <div class="feed-ico" style="background:var(--brand-50);color:var(--brand)">${C.icon('calendar', 16, 2.2)}</div>
          <div class="feed-main">
            <div class="feed-title">${C.esc(e.title)}</div>
            <div class="feed-meta">
              <span class="badge t-${e.type}" style="background:var(--ink-100);color:var(--ink-600)">${C.esc(e.type)}</span>
              <span>${C.fmtDate(e.date, { short: true })}${e.end_date && e.end_date !== e.date ? ' – ' + C.fmtDate(e.end_date, { short: true }) : ''}</span>
            </div>
            ${e.location ? `<div class="feed-text">${C.icon('map', 11, 2.4)} ${C.esc(e.location)}</div>` : ''}
          </div>
          <div class="row gap-4">
            <button class="icon-btn btn-sm" data-edit-ev="${e.id}">${C.icon('edit', 14, 2.2)}</button>
            <button class="icon-btn btn-sm" data-del-ev="${e.id}">${C.icon('trash', 14, 2.2)}</button>
          </div>
        </div>`).join('') : C.emptyRow(1, { icon: 'calendar', title: 'Belum ada acara', text: 'Klik "Tambah Acara" untuk mengisi kalender akademik.' });

      listEl.querySelectorAll('[data-edit-ev]').forEach((b) => b.addEventListener('click', () => {
        const e = events.find((x) => x.id === b.dataset.editEv);
        this.openForm(e, () => this.draw(root));
      }));
      listEl.querySelectorAll('[data-del-ev]').forEach((b) => b.addEventListener('click', async () => {
        const e = events.find((x) => x.id === b.dataset.delEv);
        if (!await C.confirmDialog({ title: 'Hapus acara?', text: `"${e.title}" akan dihapus dari kalender.`, okText: 'Ya, hapus', danger: true })) return;
        try { await C.api('/admin/events/' + e.id, { method: 'DELETE' }); C.toastOk('Dihapus', 'Acara berhasil dihapus.'); this.draw(root); }
        catch (err) { C.toastErr('Gagal', err.message); }
      }));
    },
    openForm(e, done) {
      const isEdit = !!e;
      const m = C.modal({
        title: isEdit ? 'Ubah acara' : 'Tambah acara',
        sub: 'Kalender akademik',
        narrow: true,
        okText: isEdit ? 'Simpan' : 'Tambahkan',
        body: `
          <div class="field mb-12">
            <label class="label">Judul acara <span class="req">*</span></label>
            <input class="input" name="title" data-autofocus value="${C.esc(e ? e.title : '')}">
          </div>
          <div class="form-grid mb-12">
            <div class="field"><label class="label">Tipe</label><select class="select" name="type">
              ${[['academic', 'Akademik'], ['exam', 'Ujian'], ['holiday', 'Hari Libur'], ['meeting', 'Rapat']].map(([v, l]) => `<option value="${v}" ${e && e.type === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
            <div class="field"><label class="label">Lokasi</label><input class="input" name="location" value="${C.esc(e ? e.location : '')}"></div>
            <div class="field"><label class="label">Tanggal mulai</label><input class="input" type="date" name="date" value="${C.esc(e ? e.date : C.todayStr())}"></div>
            <div class="field"><label class="label">Tanggal selesai</label><input class="input" type="date" name="end_date" value="${C.esc(e ? e.end_date : (e ? e.date : C.todayStr()))}"></div>
          </div>
          <div class="field"><label class="label">Keterangan</label><textarea class="textarea" name="description">${C.esc(e ? e.description : '')}</textarea></div>`,
        onMount(api) {
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = C.formValues(api.body);
            if (!v.title || v.title.trim().length < 2) return m.error('Judul acara minimal 2 karakter.');
            if (v.end_date && v.end_date < v.date) return m.error('Tanggal selesai tidak boleh sebelum tanggal mulai.');
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = isEdit ? await C.api('/admin/events/' + e.id, { method: 'PUT', body: v })
                                 : await C.api('/admin/events', { method: 'POST', body: v });
              api.close(); C.toastOk(isEdit ? 'Disimpan' : 'Ditambahkan', res.message || v.title); done && done();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      return m;
    },
    create() { return this.openForm(null, () => location.reload()); },
  });

  /* =========================== EXTRACURRICULARS ========================= */
  const DOW_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  register('extracurriculars', {
    title: 'Ekstrakurikuler',
    sub: 'Absensi dengan GPS Lock dan selfie',
    icon: 'star',
    group: 'Sekolah',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Ekstrakurikuler</div>
            <div class="view-sub">Absensi kegiatan dikunci dengan GPS dan foto selfie</div>
          </div>
          <button class="btn btn-primary" id="ec-add">${C.icon('plus', 16, 2.4)} Tambah Ekstrakurikuler</button>
        </div>
        <div id="ec-grid" class="grid-2"></div>`;
      root.querySelector('#ec-add').addEventListener('click', () => this.openForm(null, () => this.load(root)));
      this.load(root);
    },
    async load(root) {
      const host = root.querySelector('#ec-grid');
      if (!host) return;
      host.innerHTML = Array.from({ length: 4 }).map(() => '<div class="skeleton" style="height:170px"></div>').join('');
      try {
        const d = await C.api('/admin/extracurriculars');
        const items = d.items || [];
        const today = C.todayStr();
        const todayDow = DOW_ID[new Date(today + 'T00:00:00Z').getUTCDay()];
        if (!items.length) {
          host.innerHTML = `<div class="card"><div class="empty">
            <div class="empty-ico">${C.icon('star', 26, 1.8)}</div>
            <div class="empty-title">Belum ada ekstrakurikuler</div>
            <div class="empty-text">Tambahkan kegiatan beserta jadwal dan titik koordinatnya untuk mengaktifkan GPS Lock.</div>
            <button class="btn btn-primary mt-8" id="ec-first">${C.icon('plus', 15, 2.4)} Tambah Ekstrakurikuler</button>
          </div></div>`;
          const b = host.querySelector('#ec-first');
          if (b) b.addEventListener('click', () => this.openForm(null, () => this.load(root)));
          return;
        }
        host.innerHTML = items.map((ec) => `
          <div class="card slide-up">
            <div class="card-body">
              <div class="row between gap-8 mb-12">
                <div class="grow" style="min-width:0">
                  <div class="row gap-6 wrap mb-4">
                    <span class="badge badge-violet">${C.esc(ec.category)}</span>
                    ${ec.today ? `<span class="badge badge-ok"><i class="badge-dot"></i>Ada jadwal hari ini</span>` : ''}
                    ${!ec.active ? '<span class="badge badge-muted">Nonaktif</span>' : ''}
                  </div>
                  <h3 style="font-size:1rem">${C.esc(ec.name)}</h3>
                  <div class="text-xs muted mt-4">${C.esc(ec.description || '')}</div>
                </div>
                <div class="row gap-4" style="align-self:flex-start">
                  <button class="icon-btn btn-sm" data-ec-att="${ec.id}" title="Rekam kehadiran">${C.icon('attendance', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-ec-edit="${ec.id}" title="Ubah">${C.icon('edit', 15, 2.2)}</button>
                  <button class="icon-btn btn-sm" data-ec-del="${ec.id}" title="Hapus">${C.icon('trash', 15, 2.2)}</button>
                </div>
              </div>
              <div class="kv" style="grid-template-columns:96px 1fr;font-size:.82rem">
                <dt>Jadwal</dt><dd>${(ec.schedule_days || []).map((x) => `<span class="badge badge-brand" style="margin-right:4px">${C.esc(x)}</span>`).join('')} ${C.esc(ec.start_time)}–${C.esc(ec.end_time)}</dd>
                <dt>Tempat</dt><dd>${C.esc(ec.room || '—')}${ec.place_count ? ` <span class="text-xs muted">(+${ec.place_count} tempat terdaftar)</span>` : ''}</dd>
                <dt>Pembina</dt><dd>${C.esc(ec.teacher_name || '—')}${ec.mentor_count ? ` <span class="badge badge-violet">${ec.mentor_count} pembina</span>` : ''}</dd>
                <dt>Kelompok</dt><dd>${(ec.grade_groups || []).length ? (ec.grade_groups || []).map((g) => `<span class="badge badge-muted" style="margin-right:4px">${C.esc(g)}</span>`).join('') : '<span class="dim">Semua tingkat</span>'}</dd>
                <dt>GPS Lock</dt><dd class="mono">${C.esc(String(ec.location_lat).slice(0, 8))}, ${C.esc(String(ec.location_lng).slice(0, 9))}</dd>
                <dt>Peserta</dt><dd>${ec.present || 0} hadir dari ${ec.enrolled || 0} rekam</dd>
              </div>
              <div class="kpi-strip mt-12" style="margin-top:12px">
                <div class="kpi-cell"><div class="kpi-v">${ec.member_count || 0}</div><div class="kpi-l">Anggota</div></div>
                <div class="kpi-cell"><div class="kpi-v">${ec.schedule_count || 0}</div><div class="kpi-l">Jadwal</div></div>
                <div class="kpi-cell"><div class="kpi-v">${ec.place_count || 0}</div><div class="kpi-l">Tempat</div></div>
                <div class="kpi-cell"><div class="kpi-v">${ec.mentor_count || 0}</div><div class="kpi-l">Pembina</div></div>
              </div>
              <div class="row gap-8 mt-12 wrap" style="margin-top:12px">
                <button class="btn btn-sm btn-primary" data-ec-att2="${ec.id}">${C.icon('camera', 14, 2.3)} Rekam Kehadiran</button>
                <button class="btn btn-sm" data-ec-detail="${ec.id}">${C.icon('eye', 14, 2.3)} Lihat Rekap</button>
              </div>
              <div class="divider" style="margin:12px 0"></div>
              <div class="row gap-6 wrap">
                <button class="btn btn-sm btn-ghost" data-ec-sched="${ec.id}">${C.icon('calendar', 14, 2.3)} Jadwal</button>
                <button class="btn btn-sm btn-ghost" data-ec-places="${ec.id}">${C.icon('map', 14, 2.3)} Tempat</button>
                <button class="btn btn-sm btn-ghost" data-ec-members="${ec.id}">${C.icon('users', 14, 2.3)} Anggota</button>
                <button class="btn btn-sm btn-ghost" data-ec-mentors="${ec.id}">${C.icon('award', 14, 2.3)} Pembina</button>
              </div>
            </div>
          </div>`).join('');

        host.querySelectorAll('[data-ec-edit]').forEach((b) => b.addEventListener('click', () => {
          const ec = items.find((x) => x.id === b.dataset.ecEdit);
          this.openForm(ec, () => this.load(root));
        }));
        host.querySelectorAll('[data-ec-att], [data-ec-att2]').forEach((b) => b.addEventListener('click', () => {
          const id = b.dataset.ecAtt || b.dataset.ecAtt2;
          const ec = items.find((x) => x.id === id);
          this.openAttendance(ec);
        }));
        host.querySelectorAll('[data-ec-detail]').forEach((b) => b.addEventListener('click', () => {
          const ec = items.find((x) => x.id === b.dataset.ecDetail);
          this.openDetail(ec);
        }));
        const M = global.Pages.ecManagers || {};
        host.querySelectorAll('[data-ec-sched]').forEach((b) => b.addEventListener('click', () => {
          const ec = items.find((x) => x.id === b.dataset.ecSched);
          if (M.openSchedules) M.openSchedules(ec, () => this.load(root));
        }));
        host.querySelectorAll('[data-ec-places]').forEach((b) => b.addEventListener('click', () => {
          const ec = items.find((x) => x.id === b.dataset.ecPlaces);
          if (M.openPlaces) M.openPlaces(ec, () => this.load(root));
        }));
        host.querySelectorAll('[data-ec-members]').forEach((b) => b.addEventListener('click', () => {
          const ec = items.find((x) => x.id === b.dataset.ecMembers);
          if (M.openMembers) M.openMembers(ec, () => this.load(root));
        }));
        host.querySelectorAll('[data-ec-mentors]').forEach((b) => b.addEventListener('click', () => {
          const ec = items.find((x) => x.id === b.dataset.ecMentors);
          if (M.openMentors) M.openMentors(ec, () => this.load(root));
        }));
        host.querySelectorAll('[data-ec-del]').forEach((b) => b.addEventListener('click', async () => {
          const ec = items.find((x) => x.id === b.dataset.ecDel);
          if (!await C.confirmDialog({ title: 'Hapus ekstrakurikuler?', text: `"${ec.name}" dan seluruh rekam kehadirannya akan dihapus.`, okText: 'Ya, hapus', danger: true })) return;
          try { await C.api('/admin/extracurriculars/' + ec.id, { method: 'DELETE' }); C.toastOk('Dihapus', 'Ekstrakurikuler berhasil dihapus.'); this.load(root); }
          catch (err) { C.toastErr('Gagal', err.message); }
        }));
      } catch (err) {
        host.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div></div>`;
      }
    },
    openForm(ec, done) {
      const isEdit = !!ec;
      const teachers = (this._teachersCache || []);
      const m = C.modal({
        title: isEdit ? 'Ubah ekstrakurikuler' : 'Tambah ekstrakurikuler',
        sub: 'Jadwal, pembina dan titik GPS Lock',
        wide: true,
        okText: isEdit ? 'Simpan' : 'Tambahkan',
        body: `
          <div class="field mb-12">
            <label class="label">Nama kegiatan <span class="req">*</span></label>
            <input class="input" name="name" data-autofocus value="${C.esc(ec ? ec.name : '')}">
          </div>
          <div class="field mb-12">
            <label class="label">Deskripsi</label>
            <textarea class="textarea" name="description" style="min-height:70px">${C.esc(ec ? ec.description : '')}</textarea>
          </div>
          <div class="form-grid mb-12">
            <div class="field"><label class="label">Kategori</label>
              <select class="select" name="category">
                ${['Olahraga', 'Seni', 'Organisasi', 'Kepanduan', 'Teknologi', 'Kesehatan', 'Keagamaan', 'Umum'].map((o) => `<option ${ec && ec.category === o ? 'selected' : ''}>${o}</option>`).join('')}
              </select></div>
            <div class="field"><label class="label">Ruang / Tempat</label><input class="input" name="room" value="${C.esc(ec ? ec.room : '')}"></div>
            <div class="field"><label class="label">Jam mulai</label><input class="input" type="time" name="start_time" value="${C.esc(ec ? ec.start_time : '15:45')}"></div>
            <div class="field"><label class="label">Jam selesai</label><input class="input" type="time" name="end_time" value="${C.esc(ec ? ec.end_time : '17:15')}"></div>
            <div class="field"><label class="label">Kapasitas</label><input class="input" type="number" name="capacity" min="1" value="${C.esc(ec ? ec.capacity : 25)}"></div>
            <div class="field"><label class="label">Pembina utama</label>
              <select class="select" name="teacher_id"><option value="">— Pilih pembina —</option>${teachers.map((t) => `<option value="${t.id}" ${ec && ec.teacher_id === t.id ? 'selected' : ''}>${C.esc(t.name)}</option>`).join('')}</select></div>
          </div>
          <div class="field mb-12">
            <label class="label">Kelompok tingkat siswa</label>
            <div class="row gap-6 wrap">
              ${['Kelas VII', 'Kelas VIII', 'Kelas IX'].map((g) => `
                <label class="chip"><input type="checkbox" name="grade_groups" value="${g}" ${ec && (ec.grade_groups || []).includes(g) ? 'checked' : ''}> ${g}</label>`).join('')}
            </div>
            <div class="hint mt-4">Kelompok dipakai untuk membatasi jadwal tertentu hanya bagi tingkat yang dipilih.</div>
          </div>
          <div class="field mb-12">
            <label class="label">Hari jadwal <span class="req">*</span></label>
            <div class="row gap-6 wrap" id="ec-days">
              ${['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'].map((d0) => `
                <label class="chip"><input type="checkbox" name="schedule_days" value="${d0}" ${ec && (ec.schedule_days || []).includes(d0) ? 'checked' : ''}> ${d0}</label>`).join('')}
            </div>
          </div>
          <div class="form-grid">
            <div class="field"><label class="label">Titik GPS — Lintang</label><input class="input" name="location_lat" value="${C.esc(ec ? ec.location_lat : '-7.806420')}"></div>
            <div class="field"><label class="label">Titik GPS — Bujur</label><input class="input" name="location_lng" value="${C.esc(ec ? ec.location_lng : '110.323080')}"></div>
          </div>
          <div class="row gap-8 mt-12">
            <button class="btn btn-sm" type="button" id="ec-use-here">${C.icon('target', 14, 2.3)} Gunakan lokasi saya</button>
            <span class="hint" id="ec-geo-hint">Titik ini menjadi pusat radius GPS Lock</span>
          </div>
          <label class="check mt-12"><input type="checkbox" name="active" ${!ec || ec.active ? 'checked' : ''}> Aktifkan kegiatan ini</label>`,
        onMount(api) {
          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('#ec-use-here').addEventListener('click', () => {
            if (!navigator.geolocation) return C.toastWarn('GPS tidak tersedia', 'Perangkat ini tidak mendukung geolokasi.');
            C.toastInfo('Mengambil lokasi…', 'Mohon izinkan akses lokasi.');
            navigator.geolocation.getCurrentPosition((pos) => {
              api.body.querySelector('[name="location_lat"]').value = pos.coords.latitude.toFixed(6);
              api.body.querySelector('[name="location_lng"]').value = pos.coords.longitude.toFixed(6);
              api.el.querySelector('#ec-geo-hint').textContent = 'Titik GPS Lock diperbarui dari lokasi Anda.';
              C.toastOk('Lokasi tersimpan', 'Koordinat kegiatan diperbarui.');
            }, () => C.toastErr('Gagal', 'Tidak dapat mengambil lokasi.'));
          });
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = C.formValues(api.body);
            if (!v.name || v.name.trim().length < 2) return m.error('Nama kegiatan minimal 2 karakter.');
            if (!v.schedule_days || !v.schedule_days.length) return m.error('Pilih minimal satu hari jadwal.');
            if (Array.isArray(v.schedule_days) === false) v.schedule_days = [v.schedule_days];
            if (v.grade_groups && Array.isArray(v.grade_groups) === false) v.grade_groups = [v.grade_groups];
            api.setBusy(true, 'Menyimpan…');
            try {
              const res = isEdit ? await C.api('/admin/extracurriculars/' + ec.id, { method: 'PUT', body: v })
                                 : await C.api('/admin/extracurriculars', { method: 'POST', body: v });
              api.close(); C.toastOk(isEdit ? 'Disimpan' : 'Ditambahkan', res.message || v.name); done && done();
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      if (!teachers.length) {
        C.api('/admin/users?role=teacher&limit=100').then((r) => {
          this._teachersCache = r.items || [];
          const sel = m.body.querySelector('[name="teacher_id"]');
          if (sel) sel.innerHTML = '<option value="">— Pilih pembina —</option>' + this._teachersCache.map((t) => `<option value="${t.id}" ${ec && ec.teacher_id === t.id ? 'selected' : ''}>${C.esc(t.name)}</option>`).join('');
        }).catch(() => {});
      }
      return m;
    },
    async openDetail(ec) {
      const m = C.modal({
        title: ec.name,
        sub: 'Rekap kehadiran ekstrakurikuler',
        wide: true,
        footer: '<button class="btn" data-cancel>Tutup</button>',
        body: '<div class="empty"><span class="spinner" style="color:var(--brand)"></span></div>',
        onMount(api) { api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close()); },
      });
      try {
        const d = await C.api('/admin/extracurriculars/' + ec.id);
        const rows = d.attendance || [];
        m.body.innerHTML = rows.length ? `
          <div class="kpi-strip mb-16">
            <div class="kpi-cell"><div class="kpi-v">${rows.length}</div><div class="kpi-l">Total rekam</div></div>
            <div class="kpi-cell"><div class="kpi-v" style="color:var(--ok)">${rows.filter((r) => r.status === 'present').length}</div><div class="kpi-l">Hadir</div></div>
            <div class="kpi-cell"><div class="kpi-v" style="color:var(--danger)">${rows.filter((r) => r.status === 'absent').length}</div><div class="kpi-l">Tidak hadir</div></div>
            <div class="kpi-cell"><div class="kpi-v">${rows.filter((r) => r.has_selfie).length}</div><div class="kpi-l">Dengan selfie</div></div>
          </div>
          <table class="data"><thead><tr><th>Tanggal</th><th>Nama</th><th>Kelas</th><th>Status</th><th>Jarak</th><th>Selfie</th></tr></thead>
          <tbody>${rows.slice(0, 60).map((r) => `<tr>
            <td>${C.fmtDate(r.date, { short: true })}</td>
            <td>${C.esc(r.user_name)}</td>
            <td>${C.esc(r.class_name || '—')}</td>
            <td>${statusBadge(r.status)}</td>
            <td class="mono">${Math.round(r.distance_m || 0)} m</td>
            <td>${r.has_selfie ? `<img class="photo-thumb" src="${C.esc(r.selfie)}" alt="selfie">` : '<span class="dim">—</span>'}</td>
          </tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="empty-title">Belum ada rekam kehadiran</div><div class="empty-text">Rekam kehadiran pertama melalui tombol "Rekam Kehadiran".</div></div>';
        m.body.querySelectorAll('.photo-thumb').forEach((img) => img.addEventListener('click', () => {
          C.modal({ title: 'Foto selfie', footer: null, body: `<img src="${img.src}" style="width:100%;border-radius:14px;display:block">` });
        }));
      } catch (err) { m.body.innerHTML = `<div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div>`; }
      return m;
    },
    openAttendance(ec) {
      let gps = null;
      let selfie = '';
      const m = C.modal({
        title: 'Rekam kehadiran ekstrakurikuler',
        sub: ec.name,
        wide: true,
        okText: 'Simpan Kehadiran',
        body: `
          <div class="grid-2">
            <div>
              <div class="field mb-12">
                <label class="label">Peserta <span class="req">*</span></label>
                <select class="select" name="user_id" id="ec-att-user" data-autofocus><option value="">Memuat peserta…</option></select>
              </div>
              <div class="field mb-12">
                <label class="label">Tanggal</label>
                <input class="input" type="date" name="date" value="${C.todayStr()}">
              </div>
              <div class="field">
                <label class="label">Status kehadiran</label>
                <select class="select" name="status">
                  <option value="present">Hadir</option>
                  <option value="absent">Tidak hadir</option>
                </select>
              </div>
            </div>
            <div>
              <div class="card" style="box-shadow:none;background:var(--ink-50);margin-bottom:12px">
                <div class="card-body" style="padding:14px">
                  <div class="row between mb-8">
                    <div class="semibold text-sm row gap-6">${C.icon('target', 15, 2.3)} GPS Lock</div>
                    <span class="badge badge-muted" id="ec-gps-badge">Belum terkunci</span>
                  </div>
                  <div class="text-xs muted mb-8">Radius: <b id="ec-radius">—</b> dari ${C.esc(ec.room || 'lokasi kegiatan')}</div>
                  <button class="btn btn-sm btn-primary btn-block" type="button" id="ec-lock">${C.icon('map', 14, 2.3)} Ambil Posisi GPS</button>
                  <div class="mono text-xs mt-8" id="ec-gps-data">—</div>
                </div>
              </div>
              <div class="card" style="box-shadow:none;background:var(--ink-50)">
                <div class="card-body" style="padding:14px">
                  <div class="semibold text-sm row gap-6 mb-8">${C.icon('camera', 15, 2.3)} Foto selfie</div>
                  <div id="ec-selfie-preview"></div>
                  <button class="btn btn-sm btn-block mt-8" type="button" id="ec-selfie">${C.icon('camera', 14, 2.3)} Ambil Selfie</button>
                </div>
              </div>
            </div>
          </div>`,
        onMount(api) {
          C.api('/admin/settings').then((s) => {
            api.el.querySelector('#ec-radius').textContent = (s.settings.ec_radius_m || 60) + ' m';
          }).catch(() => {});
          C.api('/admin/users?role=student&limit=200').then((r) => {
            const sel = api.body.querySelector('#ec-att-user');
            sel.innerHTML = '<option value="">— Pilih peserta —</option>' + (r.items || []).map((u) => `<option value="${u.id}">${C.esc(u.name)} · ${C.esc(u.class_name || u.id_number)}</option>`).join('');
          }).catch(() => {});

          api.el.querySelector('#ec-lock').addEventListener('click', () => {
            if (!navigator.geolocation) return C.toastErr('GPS tidak tersedia', 'Perangkat ini tidak mendukung geolokasi.');
            C.toastInfo('Menautkan GPS…', 'Mohon izinkan akses lokasi.');
            navigator.geolocation.getCurrentPosition((pos) => {
              gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
              const dist = haversine(gps.lat, gps.lng, ec.location_lat, ec.location_lng);
              api.el.querySelector('#ec-gps-badge').className = 'badge ' + (dist <= 60 ? 'badge-ok' : 'badge-danger');
              api.el.querySelector('#ec-gps-badge').textContent = `${Math.round(dist)} m dari titik`;
              api.el.querySelector('#ec-gps-data').textContent = `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy || 0)} m)`;
              C.toastOk('GPS terkunci', `Jarak ${Math.round(dist)} m dari lokasi kegiatan.`);
            }, () => C.toastErr('Gagal', 'Tidak dapat mengambil posisi GPS.'), { enableHighAccuracy: true, timeout: 12000 });
          });

          api.el.querySelector('#ec-selfie').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.capture = 'user';
            input.addEventListener('change', () => {
              const f = input.files && input.files[0];
              if (!f) return;
              const rd = new FileReader();
              rd.onload = () => {
                selfie = String(rd.result);
                api.el.querySelector('#ec-selfie-preview').innerHTML = `<img src="${selfie}" style="width:100%;border-radius:12px;display:block">`;
              };
              rd.readAsDataURL(f);
            });
            input.click();
          });

          api.el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
          api.el.querySelector('[data-submit]').addEventListener('click', async () => {
            m.clearError();
            const v = C.formValues(api.body);
            if (!v.user_id) return m.error('Pilih peserta terlebih dahulu.');
            if (!gps) return m.error('Kunci posisi GPS terlebih dahulu (GPS Lock).');
            api.setBusy(true, 'Menyimpan…');
            try {
              await C.api(`/admin/extracurriculars/${ec.id}/attendance`, {
                method: 'POST',
                body: Object.assign({}, v, { gps_lat: gps.lat, gps_lng: gps.lng, gps_accuracy: gps.accuracy, selfie }),
              });
              api.close();
              C.toastOk('Kehadiran direkam', 'Data tersimpan dengan GPS Lock dan selfie.');
              if (Pages.extracurriculars._lastRoot) Pages.extracurriculars.load(Pages.extracurriculars._lastRoot);
            } catch (err) { api.setBusy(false); m.error(err.message); }
          });
        },
      });
      return m;
    },
    create() { return this.openForm(null, () => location.reload()); },
  });

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* ================================ REPORTS ============================= */
  register('reports', {
    title: 'Laporan',
    sub: 'Rekap kehadiran dan analitik',
    icon: 'chart',
    group: 'Analitik',
    render(root) {
      const today = C.todayStr();
      const from = C.addDays(today, -30);
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Laporan Kehadiran</div>
            <div class="view-sub">Rekap per periode, role, kelas dan individu</div>
          </div>
          <a class="btn" id="rep-export" href="/api/admin/reports/export.csv?from=${from}&to=${today}" download>
            ${C.icon('download', 16, 2.3)} Unduh CSV
          </a>
        </div>
        <div class="card mb-16">
          <div class="toolbar">
            <div class="field"><label class="label">Dari</label><input class="input" type="date" id="rep-from" value="${from}"></div>
            <div class="field"><label class="label">Sampai</label><input class="input" type="date" id="rep-to" value="${today}"></div>
            <div class="field"><label class="label">Role</label>
              <select class="select" id="rep-role">
                <option value="">Semua role</option>
                <option value="teacher">Guru</option>
                <option value="student">Peserta Didik</option>
                <option value="employee">Karyawan</option>
              </select></div>
            <div class="grow"></div>
            <div class="row gap-6">
              <button class="chip" data-quick="7">7 hari</button>
              <button class="chip" data-quick="30">30 hari</button>
              <button class="chip" data-quick="90">90 hari</button>
            </div>
            <button class="btn btn-primary" id="rep-go">${C.icon('chart', 16, 2.3)} Terapkan</button>
          </div>
        </div>
        <div id="rep-body"><div class="skeleton" style="height:340px"></div></div>`;

      const go = () => this.load(root);
      root.querySelector('#rep-go').addEventListener('click', go);
      root.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
        const n = parseInt(b.dataset.quick, 10);
        root.querySelector('#rep-from').value = C.addDays(today, -n);
        root.querySelector('#rep-to').value = today;
        go();
      }));
      root.querySelector('#rep-role').addEventListener('change', go);
      go();
    },
    async load(root) {
      const host = root.querySelector('#rep-body');
      if (!host) return;
      const from = root.querySelector('#rep-from').value;
      const to = root.querySelector('#rep-to').value;
      const role = root.querySelector('#rep-role').value;
      if (!from || !to) return C.toastWarn('Rentang tanggal belum lengkap', 'Pilih tanggal mulai dan selesai.');
      root.querySelector('#rep-export').href = `/api/admin/reports/export.csv?from=${from}&to=${to}${role ? '&role=' + role : ''}`;
      host.innerHTML = '<div class="skeleton" style="height:340px"></div>';
      try {
        const d = await C.api(`/admin/reports?from=${from}&to=${to}${role ? '&role=' + role : ''}`);
        const o = d.overall || {};
        host.innerHTML = `
          <div class="kpi-strip mb-16">
            <div class="kpi-cell"><div class="kpi-v">${C.num(o.records)}</div><div class="kpi-l">Total rekam</div></div>
            <div class="kpi-cell"><div class="kpi-v" style="color:var(--ok)">${C.num(o.present)}</div><div class="kpi-l">Hadir</div></div>
            <div class="kpi-cell"><div class="kpi-v" style="color:var(--warn)">${C.num(o.late)}</div><div class="kpi-l">Terlambat</div></div>
            <div class="kpi-cell"><div class="kpi-v" style="color:var(--danger)">${C.num(o.absent)}</div><div class="kpi-l">Tidak hadir</div></div>
            <div class="kpi-cell"><div class="kpi-v" style="color:var(--info)">${o.avg_hours} j</div><div class="kpi-l">Rata-rata jam</div></div>
            <div class="kpi-cell"><div class="kpi-v">${d.range_days}</div><div class="kpi-l">Hari periode</div></div>
          </div>

          <div class="grid-2 mb-16">
            <div class="card">
              <div class="card-head"><div class="card-title">Komposisi status kehadiran</div></div>
              <div class="card-body">
                ${(d.by_status || []).map((s) => {
                  const total = (d.by_status || []).reduce((a, b) => a + b.count, 0) || 1;
                  const pct = Math.round((s.count / total) * 100);
                  const color = { present: 'var(--ok)', late: 'var(--warn)', absent: 'var(--danger)', leave: 'var(--info)' }[s.status] || 'var(--ink-400)';
                  return `<div class="rank-row">
                    <div class="rank-name" style="width:96px">${C.esc(s.label)}</div>
                    <div class="rank-bar"><div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>
                    <div class="rank-val" style="width:78px">${C.num(s.count)} · ${pct}%</div>
                  </div>`;
                }).join('')}
              </div>
            </div>
            <div class="card">
              <div class="card-head"><div class="card-title">Tingkat kehadiran per role</div></div>
              <div class="table-wrap"><table class="data">
                <thead><tr><th>Role</th><th>Hadir</th><th>Terlambat</th><th>Target</th><th style="text-align:right">Tingkat</th></tr></thead>
                <tbody>${(d.by_role || []).map((r) => `<tr>
                  <td><b>${C.esc(r.label)}</b></td>
                  <td>${C.num(r.present)}</td>
                  <td>${C.num(r.late)}</td>
                  <td class="muted">${C.num(r.expected)}</td>
                  <td style="text-align:right"><span class="badge ${r.rate >= 90 ? 'badge-ok' : r.rate >= 75 ? 'badge-warn' : 'badge-danger'}">${r.rate}%</span></td>
                </tr>`).join('')}</tbody>
              </table></div>
            </div>
          </div>

          <div class="card mb-16">
            <div class="card-head"><div class="card-title">Tren harian</div><div class="card-sub">${C.fmtDate(from, { short: true })} – ${C.fmtDate(to, { short: true })}</div></div>
            <div class="card-body"><div class="spark" style="height:150px">
              ${(d.by_date || []).map((x) => {
                const h = Math.max(2, Math.round(x.rate));
                return `<div class="spark-col">
                  <div class="spark-bar-wrap"><div class="spark-bar" style="height:${h}%" data-tip="${x.dow} ${C.fmtDate(x.date, { short: true })} · ${x.present}/${x.total} · ${x.rate}%"></div></div>
                  <div class="spark-lbl">${x.date.slice(8)}</div>
                </div>`;
              }).join('') || '<div class="muted text-sm">Tidak ada data pada periode ini.</div>'}
            </div></div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-head"><div class="card-title">Rekap per kelas</div></div>
              <div class="table-wrap"><table class="data">
                <thead><tr><th>Kelas</th><th>Hadir</th><th>Terlambat</th><th style="text-align:right">Total jam</th></tr></thead>
                <tbody>${(d.by_class || []).map((c) => `<tr>
                  <td><b>${C.esc(c.class_name)}</b></td>
                  <td>${C.num(c.present)}</td>
                  <td>${C.num(c.late)}</td>
                  <td style="text-align:right">${C.num(Math.round(c.hours))} j</td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted center-text" style="padding:24px">Tidak ada data</td></tr>'}</tbody>
              </table></div>
            </div>
            <div class="card">
              <div class="card-head"><div class="card-title">Kehadiran terbaik</div><div class="card-sub">Berdasarkan rasio kehadiran</div></div>
              <div class="table-wrap"><table class="data">
                <thead><tr><th>#</th><th>Nama</th><th>Role</th><th style="text-align:right">Tingkat</th></tr></thead>
                <tbody>${(d.top_users || []).map((u, i) => `<tr>
                  <td class="muted">${i + 1}</td>
                  <td>${userCell(u)}</td>
                  <td>${roleBadge(u.role)}</td>
                  <td style="text-align:right"><span class="badge ${u.rate >= 95 ? 'badge-ok' : u.rate >= 80 ? 'badge-warn' : 'badge-muted'}">${u.rate}%</span></td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted center-text" style="padding:24px">Tidak ada data</td></tr>'}</tbody>
              </table></div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head">
              <div class="card-title">Rekap permohonan izin</div>
              <div class="card-sub">${C.fmtDate(from, { short: true })} – ${C.fmtDate(to, { short: true })}</div>
            </div>
            <div class="card-body">
              <div class="kpi-strip mb-16">
                <div class="kpi-cell"><div class="kpi-v">${C.num((d.requests && d.requests.total) || 0)}</div><div class="kpi-l">Total permohonan</div></div>
                <div class="kpi-cell"><div class="kpi-v" style="color:var(--warn)">${C.num(d.requests ? d.requests.by_status.pending : 0)}</div><div class="kpi-l">Menunggu</div></div>
                <div class="kpi-cell"><div class="kpi-v" style="color:var(--ok)">${C.num(d.requests ? d.requests.by_status.approved : 0)}</div><div class="kpi-l">Disetujui</div></div>
                <div class="kpi-cell"><div class="kpi-v" style="color:var(--danger)">${C.num(d.requests ? d.requests.by_status.rejected : 0)}</div><div class="kpi-l">Ditolak</div></div>
                <div class="kpi-cell"><div class="kpi-v">${C.num(d.requests ? d.requests.approved_days : 0)}</div><div class="kpi-l">Hari disetujui</div></div>
                <div class="kpi-cell"><div class="kpi-v" style="color:var(--info)">${d.requests ? d.requests.approval_rate : 0}%</div><div class="kpi-l">Tingkat persetujuan</div></div>
              </div>
              <div class="table-wrap"><table class="data">
                <thead><tr><th>Jenis permohonan</th><th>Diajukan</th><th>Disetujui</th><th style="text-align:right">Tingkat</th></tr></thead>
                <tbody>${((d.requests && d.requests.by_type) || []).map((t) => `<tr>
                  <td><span class="badge ${C.REQ_TYPE_BADGE[t.type] || 'badge-muted'}">${C.esc(t.type)}</span></td>
                  <td>${C.num(t.count)}</td>
                  <td>${C.num(t.approved)}</td>
                  <td style="text-align:right"><span class="badge ${(t.count ? Math.round((t.approved / t.count) * 100) : 0) >= 70 ? 'badge-ok' : 'badge-warn'}">${t.count ? Math.round((t.approved / t.count) * 100) : 0}%</span></td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted center-text" style="padding:24px">Tidak ada permohonan pada periode ini</td></tr>'}</tbody>
              </table></div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head"><div class="card-title">Partisipasi ekstrakurikuler</div></div>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Kegiatan</th><th>Pembina</th><th>Hadir</th><th>Total</th><th style="text-align:right">Partisipasi</th></tr></thead>
              <tbody>${(d.extracurricular || []).map((e) => `<tr>
                <td><b>${C.esc(e.name)}</b></td>
                <td class="muted">${C.esc(e.teacher_name || '—')}</td>
                <td>${C.num(e.present)}</td>
                <td>${C.num(e.total)}</td>
                <td style="text-align:right"><span class="badge ${e.rate >= 80 ? 'badge-ok' : e.rate >= 50 ? 'badge-warn' : 'badge-muted'}">${e.rate}%</span></td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted center-text" style="padding:24px">Belum ada data ekstrakurikuler</td></tr>'}</tbody>
            </table></div>
          </div>`;
      } catch (err) {
        host.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">Gagal memuat laporan</div><div class="empty-text">${C.esc(err.message)}</div></div></div>`;
      }
    },
  });

  /* ================================ ACTIVITY ============================ */
  register('activity', {
    title: 'Catatan Aktivitas',
    sub: 'Jejak sistem secara real time',
    icon: 'activity',
    group: 'Analitik',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Aktivitas Sistem</div>
            <div class="view-sub">Jejak absensi, login dan perubahan data</div>
          </div>
          <button class="btn btn-danger" id="log-clear">${C.icon('trash', 15, 2.3)} Bersihkan</button>
        </div>
        <div class="card"><div class="feed" id="log-feed"></div></div>`;
      root.querySelector('#log-clear').addEventListener('click', async () => {
        if (!await C.confirmDialog({ title: 'Bersihkan catatan?', text: 'Seluruh catatan aktivitas akan dihapus.', okText: 'Ya, bersihkan', danger: true })) return;
        try { await C.api('/admin/logs/clear', { method: 'POST' }); C.toastOk('Dibersihkan', 'Catatan aktivitas dikosongkan.'); this.load(root); }
        catch (err) { C.toastErr('Gagal', err.message); }
      });
      this.load(root);
    },
    async load(root) {
      const host = root.querySelector('#log-feed');
      if (!host) return;
      host.innerHTML = Array.from({ length: 8 }).map(() => '<div class="feed-item"><div class="skeleton" style="height:34px;width:100%"></div></div>').join('');
      try {
        const d = await C.api('/admin/logs');
        const items = d.items || [];
        host.innerHTML = items.length ? items.map((a) => `
          <div class="feed-item">
            <div class="feed-ico" style="background:var(--ink-100);color:var(--ink-500)">${C.icon('activity', 16, 2.2)}</div>
            <div class="feed-main">
              <div class="feed-title">${C.esc(a.target || a.actor)} <span class="muted medium" style="font-weight:500">· ${C.esc(a.action)}</span></div>
              <div class="feed-meta"><span>${C.esc(a.detail || '')}</span><span>·</span><span>${C.fmtDateTime(a.at, C.localOffset())}</span><span>·</span><span>${C.timeAgo(a.at)}</span></div>
            </div>
          </div>`).join('') : `<div class="empty"><div class="empty-ico">${C.icon('activity', 26, 1.8)}</div><div class="empty-title">Belum ada aktivitas</div><div class="empty-text">Aktivitas akan tercatat saat warga sekolah melakukan absensi.</div></div>`;
      } catch (err) { host.innerHTML = `<div class="empty"><div class="empty-title">Gagal memuat</div><div class="empty-text">${C.esc(err.message)}</div></div>`; }
    },
  });

  /* ================================ SETTINGS ============================ */
  register('settings', {
    title: 'Pengaturan Aplikasi',
    sub: 'Profil sekolah, absensi dan PWA / APK',
    icon: 'settings',
    group: 'Sistem',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Pengaturan</div>
            <div class="view-sub">Profil sekolah, aturan absensi dan tampilan aplikasi seluler</div>
          </div>
        </div>
        <div id="set-body"><div class="skeleton" style="height:400px"></div></div>`;
      this.load(root);
    },
    async load(root) {
      const host = root.querySelector('#set-body');
      try {
        const d = await C.api('/admin/settings');
        const s = d.settings || {};
        const sc = d.school || {};
        this._data = d;
        host.innerHTML = `
          <div class="grid-1-2">
            <div class="card">
              <div class="card-head"><div class="card-title">Logo aplikasi</div></div>
              <div class="card-body">
                <div class="logo-drop" id="logo-drop">
                  <img class="logo-preview" id="logo-preview" src="${s.logo ? '/api/assets/logo.svg' : '/api/assets/default-logo.svg'}" alt="Logo">
                  <div class="semibold text-sm">Seret atau klik untuk mengunggah logo</div>
                  <div class="text-xs muted mt-4">PNG atau SVG, maksimal 300 KB</div>
                  <input type="file" id="logo-input" accept="image/*" class="hidden">
                </div>
                <div class="row gap-8 mt-12">
                  <button class="btn btn-sm" id="logo-reset">${C.icon('refresh', 14, 2.3)} Kembalikan bawaan</button>
                </div>
                <div class="divider"></div>
                <div class="field mb-12">
                  <label class="label">Warna utama</label>
                  <div class="color-row">
                    <input type="color" id="c-primary" value="${C.esc(s.theme_primary || '#4f46e5')}">
                    <input class="input mono" id="c-primary-t" value="${C.esc(s.theme_primary || '#4f46e5')}">
                  </div>
                </div>
                <div class="field">
                  <label class="label">Warna aksen</label>
                  <div class="color-row">
                    <input type="color" id="c-accent" value="${C.esc(s.theme_accent || '#f59e0b')}">
                    <input class="input mono" id="c-accent-t" value="${C.esc(s.theme_accent || '#f59e0b')}">
                  </div>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><div class="card-title">Profil sekolah</div></div>
              <div class="card-body">
                <div class="form-grid">
                  <div class="field span-2"><label class="label">Nama sekolah</label><input class="input" name="school_name" value="${C.esc(s.school_name || '')}"></div>
                  <div class="field"><label class="label">Kode sekolah</label><input class="input" name="school_code" value="${C.esc(s.school_code || '')}"></div>
                  <div class="field"><label class="label">Telepon</label><input class="input" name="school_phone" value="${C.esc(s.school_phone || '')}"></div>
                  <div class="field span-2"><label class="label">Email</label><input class="input" type="email" name="school_email" value="${C.esc(s.school_email || '')}"></div>
                  <div class="field span-2"><label class="label">Alamat</label><textarea class="textarea" name="school_address" style="min-height:70px">${C.esc(s.school_address || '')}</textarea></div>
                </div>
              </div>
            </div>
          </div>

          <div class="grid-1-2 mt-16">
            <div class="card">
              <div class="card-head"><div class="card-title">Pratinjau aplikasi</div><div class="card-sub">Tampilan PWA</div></div>
              <div class="card-body center" style="display:flex;justify-content:center">
                <div class="phone-frame">
                  <div class="phone-screen">
                    <div class="phone-status"><span>${C.pad(new Date().getHours())}:${C.pad(new Date().getMinutes())}</span><span>Absensi</span></div>
                    <div class="phone-head" id="pv-head">
                      <img src="${s.logo ? '/api/assets/logo.svg' : '/api/assets/default-logo.svg'}" style="width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.2)">
                      <div>
                        <div style="font-weight:800;font-size:.82rem">${C.esc(s.app_short_name || 'Absensi')}</div>
                        <div style="font-size:.6rem;opacity:.85">${C.esc(s.app_tagline || '')}</div>
                      </div>
                    </div>
                    <div style="padding:12px;background:var(--white)">
                      <div style="height:76px;border-radius:14px;background:linear-gradient(135deg, ${C.esc(s.theme_primary || '#4f46e5')}, ${C.esc(s.theme_accent || '#f59e0b')});display:grid;place-items:center;color:#fff;font-weight:800;font-size:.7rem;text-align:center;padding:6px">
                        Tombol<br>Absen 3D
                      </div>
                      <div style="height:8px;border-radius:99px;background:var(--ink-100);margin-top:10px"></div>
                      <div style="height:8px;border-radius:99px;background:var(--ink-100);margin-top:6px;width:70%"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><div class="card-title">Identitas aplikasi (PWA / APK)</div></div>
              <div class="card-body">
                <div class="form-grid">
                  <div class="field span-2"><label class="label">Nama aplikasi</label><input class="input" name="app_name" value="${C.esc(s.app_name || '')}"></div>
                  <div class="field"><label class="label">Nama singkat</label><input class="input" name="app_short_name" value="${C.esc(s.app_short_name || '')}"></div>
                  <div class="field"><label class="label">Zona waktu</label>
                    <select class="select" name="timezone">
                      ${['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'].map((t) => `<option ${s.timezone === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select></div>
                  <div class="field span-2"><label class="label">Slogan / tagline</label><input class="input" name="app_tagline" value="${C.esc(s.app_tagline || '')}"></div>
                  <div class="field span-2">
                    <label class="label">Nama paket Android (TWA / APK)</label>
                    <input class="input" name="android_package" placeholder="mis. id.sch.sp1yogyakarta.absensi" value="${C.esc(s.android_package || '')}">
                    <span class="hint">Diperlukan agar aplikasi Android terhubung sebagai Trusted Web Activity</span>
                  </div>
                  <div class="field span-2">
                    <label class="label">Sidik jari SHA-256 sertifikat</label>
                    <textarea class="textarea" name="sha256_fingerprints" placeholder="Satu sidik jari per baris" style="min-height:74px">${C.esc(s.sha256_fingerprints || '')}</textarea>
                    <span class="hint">Dipublikasikan otomatis di /.well-known/assetlinks.json</span>
                  </div>
                  <div class="field span-2">
                    <label class="label">Kata penyemangat di splash screen</label>
                    <textarea class="textarea" name="splash_quotes" style="min-height:130px" placeholder="Satu kalimat per baris">${C.esc((s.splash_quotes || []).join('\n'))}</textarea>
                    <span class="hint">Ditampilkan secara acak setelah absen masuk atau pulang</span>
                  </div>
                </div>
                <div class="divider"></div>
                <div class="row gap-8 wrap">
                  <a class="btn btn-sm" href="/manifest.json" target="_blank" rel="noopener">${C.icon('external', 14, 2.3)} Lihat manifest</a>
                  <a class="btn btn-sm" href="/icons/icon-512.png" target="_blank" rel="noopener">${C.icon('image', 14, 2.3)} Ikon 512px</a>
                  <a class="btn btn-sm" href="/kiosk" target="_blank" rel="noopener">${C.icon('qr', 14, 2.3)} Kios QR</a>
                  <a class="btn btn-sm" href="/.well-known/assetlinks.json" target="_blank" rel="noopener">${C.icon('phone', 14, 2.3)} Asset Links</a>
                </div>
              </div>
            </div>
          </div>

          <div class="grid-2 mt-16">
            <div class="card">
              <div class="card-head"><div class="card-title">Aturan kehadiran</div></div>
              <div class="card-body">
                <div class="form-grid">
                  <div class="field"><label class="label">Jam masuk</label><input class="input" type="time" name="work_start" value="${C.esc(s.work_start || '07:30')}"></div>
                  <div class="field"><label class="label">Jam pulang</label><input class="input" type="time" name="work_end" value="${C.esc(s.work_end || '15:30')}"></div>
                  <div class="field"><label class="label">Toleransi keterlambatan (menit)</label><input class="input" type="number" min="0" name="late_after_minutes" value="${C.esc(s.late_after_minutes || 10)}"></div>
                  <div class="field"><label class="label">Radius absensi (meter)</label><input class="input" type="number" min="5" name="checkin_radius_m" value="${C.esc(s.checkin_radius_m || 120)}"></div>
                  <div class="field"><label class="label">Radius ekstrakurikuler (meter)</label><input class="input" type="number" min="5" name="ec_radius_m" value="${C.esc(s.ec_radius_m || 60)}"></div>
                  <div class="field"><label class="label">Metode absen</label>
                    <select class="select" name="checkin_method">
                      ${[['qr_gps', 'QR + GPS'], ['qr', 'QR saja'], ['gps', 'GPS saja'], ['any', 'Bebas']].map(([v, l]) => `<option value="${v}" ${s.checkin_method === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select></div>
                </div>
                <div class="divider"></div>
                ${[
                  ['require_gps', 'Wajibkan GPS', 'Posisi perangkat harus terdeteksi saat absen.'],
                  ['require_selfie', 'Wajibkan selfie ekstrakurikuler', 'Peserta harus mengunggah foto selfie.'],
                  ['checkout_enabled', 'Aktifkan absen pulang', 'Warga sekolah dapat melakukan absen pulang.'],
                  ['allow_outside_confirm', 'Izinkan absen di luar radius', 'Absensi di luar radius tetap diterima dengan catatan jarak.'],
                ].map(([k, l, desc]) => `
                  <div class="switch-row">
                    <div><div class="switch-lbl">${l}</div><div class="switch-desc">${desc}</div></div>
                    <label class="switch"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}><span class="slider"></span></label>
                  </div>`).join('')}
              </div>
            </div>

            <div class="card">
              <div class="card-head"><div class="card-title">Lokasi sekolah & kode QR</div></div>
              <div class="card-body">
                <div class="text-sm muted mb-12">Titik koordinat menjadi pusat radius absensi dan ditanamkan ke dalam kode QR dinamis.</div>
                <div class="form-grid mb-12">
                  <div class="field"><label class="label">Lintang</label><input class="input" id="geo-lat" value="${C.esc(sc.lat)}"></div>
                  <div class="field"><label class="label">Bujur</label><input class="input" id="geo-lng" value="${C.esc(sc.lng)}"></div>
                </div>
                <div class="row gap-8 wrap mb-16">
                  <button class="btn btn-sm" id="geo-here">${C.icon('target', 14, 2.3)} Gunakan lokasi saya</button>
                  <button class="btn btn-sm" id="geo-save">${C.icon('check', 14, 2.3)} Simpan lokasi</button>
                </div>
                <div class="qr-stage">
                  <div class="text-sm mb-8" style="opacity:.9">Pratinjau kode QR dinamis</div>
                  <div class="qr-box"><img src="/api/public/qr/checkin.svg?size=300" alt="QR check-in"></div>
                  <div class="text-xs mt-12" style="opacity:.85">Kode berubah mengikuti alamat server dan lokasi sekolah</div>
                </div>
              </div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head">
              <div>
                <div class="card-title">Zona berisiko</div>
                <div class="card-sub">Tindakan yang memengaruhi seluruh data</div>
              </div>
            </div>
            <div class="card-body">
              <div class="row between gap-12 wrap">
                <div>
                  <div class="semibold">Muat ulang data demo</div>
                  <div class="text-sm muted">Mengisi ulang data contoh: pengguna, kehadiran, permohonan, pengumuman.</div>
                </div>
                <button class="btn btn-danger" id="set-reset">${C.icon('refresh', 15, 2.3)} Muat ulang data demo</button>
              </div>
            </div>
          </div>

          <div class="row end gap-8 mt-16">
            <button class="btn btn-primary btn-lg" id="set-save">${C.icon('check', 17, 2.4)} Simpan Semua Pengaturan</button>
          </div>`;

        this.bind(root, d);
      } catch (err) {
        host.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">Gagal memuat pengaturan</div><div class="empty-text">${C.esc(err.message)}</div></div></div>`;
      }
    },
    bind(root, d) {
      const s = d.settings || {};
      /* logo upload */
      const drop = root.querySelector('#logo-drop');
      const input = root.querySelector('#logo-input');
      const preview = root.querySelector('#logo-preview');
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault(); drop.classList.remove('is-over');
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadLogo(f);
      });
      input.addEventListener('change', () => { const f = input.files[0]; if (f) uploadLogo(f); });
      function uploadLogo(f) {
        if (f.size > 400000) return C.toastErr('Terlalu besar', 'Ukuran logo maksimal 300 KB.');
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            await C.api('/admin/settings/logo', { method: 'POST', body: { logo: String(rd.result) } });
            preview.src = String(rd.result);
            C.toastOk('Logo diperbarui', 'Manifest PWA dan ikon aplikasi ikut menyesuaikan.');
            const side = document.getElementById('side-logo');
            if (side) side.src = '/api/assets/logo.svg?v=' + Date.now();
          } catch (err) { C.toastErr('Gagal', err.message); }
        };
        rd.readAsDataURL(f);
      }
      root.querySelector('#logo-reset').addEventListener('click', async () => {
        try {
          await C.api('/admin/settings/logo', { method: 'POST', body: { logo: '' } });
          preview.src = '/api/assets/default-logo.svg';
          C.toastOk('Dikembalikan', 'Logo bawaan digunakan kembali.');
          const side = document.getElementById('side-logo');
          if (side) side.src = '/api/assets/default-logo.svg';
        } catch (err) { C.toastErr('Gagal', err.message); }
      });

      /* colour pickers stay in sync and preview live */
      const p1 = root.querySelector('#c-primary'), p1t = root.querySelector('#c-primary-t');
      const p2 = root.querySelector('#c-accent'), p2t = root.querySelector('#c-accent-t');
      const head = root.querySelector('#pv-head');
      p1.addEventListener('input', () => { p1t.value = p1.value; document.documentElement.style.setProperty('--brand', p1.value); if (head) head.style.background = p1.value; });
      p1t.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(p1t.value)) { p1.value = p1t.value; document.documentElement.style.setProperty('--brand', p1t.value); if (head) head.style.background = p1t.value; } });
      p2.addEventListener('input', () => { p2t.value = p2.value; document.documentElement.style.setProperty('--accent', p2.value); });
      p2t.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(p2t.value)) { p2.value = p2t.value; document.documentElement.style.setProperty('--accent', p2t.value); } });

      /* geo */
      root.querySelector('#geo-here').addEventListener('click', () => {
        if (!navigator.geolocation) return C.toastErr('GPS tidak tersedia', 'Perangkat ini tidak mendukung geolokasi.');
        navigator.geolocation.getCurrentPosition((pos) => {
          root.querySelector('#geo-lat').value = pos.coords.latitude.toFixed(6);
          root.querySelector('#geo-lng').value = pos.coords.longitude.toFixed(6);
          C.toastOk('Lokasi diambil', 'Simpan untuk menerapkan.');
        }, () => C.toastErr('Gagal', 'Tidak dapat mengambil lokasi.'));
      });
      root.querySelector('#geo-save').addEventListener('click', async () => {
        try {
          await C.api('/admin/settings/geo', {
            method: 'POST',
            body: { lat: parseFloat(root.querySelector('#geo-lat').value), lng: parseFloat(root.querySelector('#geo-lng').value) },
          });
          C.toastOk('Lokasi disimpan', 'Radius absensi kini berpusat pada titik baru.');
        } catch (err) { C.toastErr('Gagal', err.message); }
      });

      /* reset demo data */
      root.querySelector('#set-reset').addEventListener('click', async () => {
        if (!await C.confirmDialog({
          title: 'Muat ulang data demo?',
          text: 'Seluruh data saat ini akan diganti dengan data contoh yang baru. Tindakan ini tidak dapat dibatalkan.',
          okText: 'Ya, muat ulang', danger: true,
        })) return;
        try {
          const r = await C.api('/admin/demo/reset', { method: 'POST' });
          C.toastOk('Data demo dimuat ulang', `${r.result.users} pengguna · ${r.result.attendance} rekam kehadiran`);
          setTimeout(() => location.reload(), 900);
        } catch (err) { C.toastErr('Gagal', err.message); }
      });

      /* save all */
      root.querySelector('#set-save').addEventListener('click', async () => {
        const btn = root.querySelector('#set-save');
        const v = C.formValues(root);
        v.theme_primary = p1.value;
        v.theme_accent = p2.value;
        v.splash_quotes = String(v.splash_quotes || '').split('\n').map((x) => x.trim()).filter(Boolean);
        v.late_after_minutes = Number(v.late_after_minutes);
        v.checkin_radius_m = Number(v.checkin_radius_m);
        v.ec_radius_m = Number(v.ec_radius_m);
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:16px;height:16px"></span> Menyimpan…';
        try {
          const res = await C.api('/admin/settings', { method: 'PUT', body: v });
          C.toastOk('Pengaturan disimpan', res.message);
          if (res.icons_regenerated) {
            // bust the icon cache so the browser fetches the new artwork
            setTimeout(() => {
              document.querySelectorAll('img[src^="/icons/"]').forEach((i) => { i.src = i.src.split('?')[0] + '?v=' + Date.now(); });
            }, 300);
          }
          C.store.set({ settings: res.settings, school: res.school });
          applyTheme(res.settings);
          const side = document.getElementById('side-logo');
          if (side) side.src = '/api/assets/logo.svg?v=' + Date.now();
          const nm = document.getElementById('side-name');
          if (nm) nm.textContent = res.school.name || 'Absensi Sekolah';
          document.title = `${res.settings.app_name || 'Absensi Sekolah'} — Panel Administrator`;
          setTimeout(() => this.load(root), 400);
        } catch (err) {
          C.toastErr('Gagal menyimpan', err.message);
          btn.disabled = false;
          btn.innerHTML = `${C.icon('check', 17, 2.4)} Simpan Semua Pengaturan`;
        }
      });
    },
  });

  function applyTheme(s) {
    if (!s) return;
    if (s.theme_primary) document.documentElement.style.setProperty('--brand', s.theme_primary);
    if (s.theme_accent) document.documentElement.style.setProperty('--accent', s.theme_accent);
  }
  global.applyAdminTheme = applyTheme;

  /* ================================= KIOSK ============================== */
  register('kiosk', {
    title: 'Kios QR',
    sub: 'Kode QR lokasi sekolah',
    icon: 'qr',
    group: 'Sistem',
    render(root) {
      root.innerHTML = `
        <div class="view-head">
          <div>
            <div class="view-title">Kode QR Dinamis</div>
            <div class="view-sub">Tampilkan di layar gerbang sekolah untuk dipindai</div>
          </div>
          <a class="btn btn-primary" href="/kiosk" target="_blank" rel="noopener">${C.icon('external', 16, 2.3)} Buka layar penuh</a>
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-head"><div class="card-title">Absen masuk</div><span class="badge badge-ok"><i class="badge-dot"></i>Aktif</span></div>
            <div class="card-body center-text">
              <img src="/api/public/qr/checkin.svg?size=420" alt="QR absen masuk" style="width:100%;max-width:320px">
              <div class="text-sm muted mt-12">Pindai untuk mencatat kehadiran masuk</div>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Absen pulang</div><span class="badge badge-info"><i class="badge-dot"></i>Aktif</span></div>
            <div class="card-body center-text">
              <img src="/api/public/qr/checkout.svg?size=420" alt="QR absen pulang" style="width:100%;max-width:320px">
              <div class="text-sm muted mt-12">Pindai untuk mencatat kepulangan</div>
            </div>
          </div>
        </div>`;
    },
  });
})(window);
