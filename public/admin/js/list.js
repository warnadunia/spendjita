/* ==========================================================================
   Admin list engine — a reusable, searchable, paginated, optimistic data table
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.Core;

  /**
   * Build a live data table.
   *
   * @param {Object} cfg
   *   el            {HTMLElement} container
   *   endpoint      {String}      API path (without /api), e.g. '/admin/users'
   *   columns       {Array}       [{label, key, render(row), width, align, sortable}]
   *   filters       {Array}       [{name,label,options|'date'|'text',value}]
   *   search        {Boolean}     show a search box
   *   searchKey     {String}      query param name (default 'q')
   *   limit         {Number}
   *   rowActions    {Function}    (row) => html string
   *   onRowClick    {Function}
   *   empty         {Object}      {icon,title,text,action}
   *   toolbarExtra  {String}      extra html injected in the toolbar (right side)
   *   transform     {Function}    (data) => {items,total,page,limit,...}
   *   batch         {Boolean}     enable row selection (default false)
   *   pollMs        {Number}      auto refresh interval
   *   idKey         {String}      default 'id'
   */
  function createList(cfg) {
    const state = {
      page: 1,
      limit: cfg.limit || 25,
      q: '',
      filters: {},
      sort: cfg.defaultSort || '',
      loading: false,
      data: null,
      selected: new Set(),
      pollTimer: null,
    };
    (cfg.filters || []).forEach((f) => { state.filters[f.name] = f.value != null ? f.value : ''; });

    const root = cfg.el;
    root.innerHTML = shell();

    // These are re-resolved whenever the toolbar is rebuilt — replacing the
    // innerHTML detaches the previous nodes, so cached references go stale.
    let tbody = root.querySelector('[data-tbody]');
    let pagerHost = root.querySelector('[data-pager]');
    let toolbar = root.querySelector('[data-toolbar]');

    function rebind() {
      tbody = root.querySelector('[data-tbody]');
      pagerHost = root.querySelector('[data-pager]');
      toolbar = root.querySelector('[data-toolbar]');
    }

    /* ------------------------------ markup ------------------------------ */
    function shell() {
      const cols = cfg.columns.length + ((cfg.rowActions || cfg.batch) ? 1 : 0);
      const searchBox = cfg.search === false ? '' : `
        <div class="search-wrap">
          <span class="search-ico">${C.icon('search', 16, 2.2)}</span>
          <input class="input" type="search" placeholder="${C.esc(cfg.searchPlaceholder || 'Cari…')}" data-search value="${C.esc(state.q)}">
        </div>`;
      const filterBoxes = (cfg.filters || []).map((f) => {
        if (f.type === 'date') {
          return `<input class="input" type="date" name="f_${f.name}" value="${C.esc(state.filters[f.name] || '')}" title="${C.esc(f.label)}">`;
        }
        if (f.type === 'text') {
          return `<input class="input" type="text" name="f_${f.name}" placeholder="${C.esc(f.label)}" value="${C.esc(state.filters[f.name] || '')}">`;
        }
        const opts = (f.options || []).map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return `<option value="${C.esc(v)}" ${String(state.filters[f.name]) === String(v) ? 'selected' : ''}>${C.esc(l)}</option>`;
        }).join('');
        return `<select class="select" name="f_${f.name}" title="${C.esc(f.label)}">
          ${f.placeholder ? `<option value="">${C.esc(f.placeholder)}</option>` : ''}${opts}</select>`;
      }).join('');

      return `
        <div class="card">
          <div class="toolbar" data-toolbar>
            ${searchBox}
            ${filterBoxes}
            <div class="grow"></div>
            ${cfg.toolbarExtra || ''}
            ${cfg.onCreate ? `<button class="btn btn-primary" data-create>${C.icon('plus', 16, 2.4)} ${C.esc(cfg.createLabel || 'Tambah')}</button>` : ''}
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                ${cfg.batch ? `<th style="width:38px"><input type="checkbox" data-check-all aria-label="Pilih semua"></th>` : ''}
                ${cfg.columns.map((c) => {
                  const active = state.sort && state.sort.replace(/^-/, '') === c.key;
                  const arrow = active ? (state.sort.startsWith('-') ? ' ↓' : ' ↑') : '';
                  return `<th class="${c.sortable === false ? '' : 'sortable'}" ${c.width ? `style="width:${c.width}"` : ''} ${c.sortable === false ? '' : `data-sort="${c.key}"`}>${C.esc(c.label)}${arrow}</th>`;
                }).join('')}
                ${cfg.rowActions || cfg.batch ? `<th style="width:1%;text-align:right">Aksi</th>` : ''}
              </tr></thead>
              <tbody data-tbody>${C.skeletonRows(cols, 6)}</tbody>
            </table>
          </div>
          <div data-pager></div>
        </div>`;
    }

    /* ------------------------------ fetching ---------------------------- */
    function queryString() {
      const p = new URLSearchParams();
      p.set('page', state.page);
      p.set('limit', state.limit);
      if (state.q) p.set(cfg.searchKey || 'q', state.q);
      Object.keys(state.filters).forEach((k) => { if (state.filters[k]) p.set(k, state.filters[k]); });
      if (state.sort) p.set('sort', state.sort);
      if (cfg.extraParams) Object.entries(cfg.extraParams()).forEach(([k, v]) => { if (v) p.set(k, v); });
      return p.toString();
    }

    async function load(opts) {
      const o = opts || {};
      if (state.loading) return;
      state.loading = true;
      if (!o.keepRows) renderLoading();
      try {
        const res = await C.api(cfg.endpoint + '?' + queryString(), { silent: o.silent });
        state.data = cfg.transform ? cfg.transform(res) : res;
        if (state.page > Math.max(1, Math.ceil(state.data.total / state.limit)) && state.data.total > 0) {
          state.page = Math.max(1, Math.ceil(state.data.total / state.limit));
          state.loading = false;
          return load();
        }
        render();
        if (cfg.onLoaded) cfg.onLoaded(state.data);
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="${cfg.columns.length + 1}"><div class="empty">
          <div class="empty-ico">${C.icon('alert', 26, 1.8)}</div>
          <div class="empty-title">Gagal memuat data</div>
          <div class="empty-text">${C.esc(err.message || 'Terjadi kesalahan jaringan.')}</div>
          <button class="btn btn-primary mt-8" data-retry>${C.icon('refresh', 15, 2.3)} Coba lagi</button>
        </div></td></tr>`;
        const rb = tbody.querySelector('[data-retry]');
        if (rb) rb.addEventListener('click', () => { state.loading = false; load(); });
      } finally {
        state.loading = false;
      }
    }

    /* ------------------------------ rendering --------------------------- */
    function renderLoading() {
      const cols = cfg.columns.length + ((cfg.rowActions || cfg.batch) ? 1 : 0);
      tbody.innerHTML = C.skeletonRows(cols, Math.min(8, state.limit));
      pagerHost.innerHTML = '';
    }

    function render() {
      const d = state.data;
      if (!d) return;
      const items = d.items || [];
      if (!items.length) {
        const cols = cfg.columns.length + ((cfg.rowActions || cfg.batch) ? 1 : 0);
        const e = cfg.empty || {};
        const action = typeof e.action === 'function' ? e.action() : (e.action || '');
        tbody.innerHTML = C.emptyRow(cols, {
          icon: e.icon, title: e.title, text: e.text,
          action: state.q || Object.values(state.filters).some(Boolean)
            ? `<button class="btn btn-sm" data-clear-filter>Hapus filter</button>`
            : action,
        });
        const cf = tbody.querySelector('[data-clear-filter]');
        if (cf) cf.addEventListener('click', () => { state.q = ''; state.filters = {}; state.page = 1; rebuildToolbar(); load(); });
        pagerHost.innerHTML = '';
        return;
      }
      tbody.innerHTML = items.map((row) => {
        const id = row[cfg.idKey || 'id'];
        const sel = state.selected.has(id) ? ' is-selected' : '';
        return `<tr data-id="${C.esc(id)}" class="${sel}" style="${cfg.rowClick || cfg.onRowClick ? 'cursor:pointer' : ''}">
          ${cfg.batch ? `<td><input type="checkbox" data-check ${state.selected.has(id) ? 'checked' : ''}></td>` : ''}
          ${cfg.columns.map((c) => {
            const val = c.render ? c.render(row, state) : C.esc(row[c.key] == null ? '' : row[c.key]);
            return `<td ${c.align ? `style="text-align:${c.align}"` : ''}>${val}</td>`;
          }).join('')}
          ${cfg.rowActions || cfg.batch ? `<td><div class="cell-actions">${cfg.rowActions ? cfg.rowActions(row, state) : ''}</div></td>` : ''}
        </tr>`;
      }).join('');
      pagerHost.innerHTML = C.pagerHTML(state, d.total, d.page || state.page, state.limit);
      bindRows();
      bindPager();
    }

    function bindPager() {
      pagerHost.querySelectorAll('[data-pg]').forEach((b) => {
        b.addEventListener('click', () => {
          const p = parseInt(b.dataset.pg, 10);
          if (!p || p === state.page) return;
          state.page = p;
          load();
          scrollTop();
        });
      });
    }

    function scrollTop() {
      const r = root.getBoundingClientRect();
      if (r.top < 0) window.scrollTo({ top: window.scrollY + r.top - 80, behavior: 'smooth' });
    }

    function bindRows() {
      tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        if (cfg.onRowClick) tr.addEventListener('click', (e) => {
          if (e.target.closest('button,a,input,.cell-actions')) return;
          const row = (state.data.items || []).find((r) => String(r[cfg.idKey || 'id']) === tr.dataset.id);
          if (row) cfg.onRowClick(row, state);
        });
        if (cfg.onRowMount) {
          const row = (state.data.items || []).find((r) => String(r[cfg.idKey || 'id']) === tr.dataset.id);
          if (row) cfg.onRowMount(tr, row, state);
        }
      });
    }

    function rebuildToolbar() {
      root.innerHTML = shell();
      rebind();
      bindToolbar();
      render();
    }

    function bindToolbar() {
      const tb = root.querySelector('[data-toolbar]');
      const search = tb.querySelector('[data-search]');
      if (search) {
        search.addEventListener('input', C.debounce(() => {
          state.q = search.value.trim();
          state.page = 1;
          load({ keepRows: true });
        }, 320));
      }
      tb.querySelectorAll('select[name^="f_"], input[name^="f_"]').forEach((el) => {
        const name = el.name.slice(2);
        el.addEventListener('change', () => {
          state.filters[name] = el.value;
          state.page = 1;
          load();
        });
        if (el.tagName === 'INPUT' && el.type === 'text') {
          el.addEventListener('input', C.debounce(() => {
            state.filters[name] = el.value;
            state.page = 1;
            load({ keepRows: true });
          }, 320));
        }
      });
      const cb = tb.querySelector('[data-create]');
      if (cb) cb.addEventListener('click', () => cfg.onCreate(state));
      if (cfg.onToolbarMount) cfg.onToolbarMount(tb, state);
    }

    /* --------------------------- optimistic ops ------------------------- */
    async function optimistic(id, fn, opts) {
      const o = opts || {};
      const tr = tbody.querySelector(`tr[data-id="${C.esc(id)}"]`);
      if (tr) tr.classList.add('is-updating');
      try {
        const res = await fn();
        if (o.remove) {
          if (tr) {
            tr.style.transition = 'opacity .2s, transform .2s';
            tr.style.opacity = '0';
            tr.style.transform = 'translateX(-8px)';
            setTimeout(() => { state.data.total = Math.max(0, state.data.total - 1); load({ silent: true, keepRows: true }); }, 190);
          } else load({ silent: true });
        } else {
          await load({ silent: true });
        }
        if (o.success) C.toastOk(o.success.title || 'Berhasil', o.success.text || (res && res.message));
        return res;
      } catch (err) {
        if (tr) tr.classList.remove('is-updating');
        C.toastErr(o.errorTitle || 'Gagal', err.message);
        throw err;
      }
    }

    bindToolbar();

    /* ------------------------------- polling ---------------------------- */
    if (cfg.pollMs) {
      state.pollTimer = setInterval(() => { if (!document.hidden) load({ silent: true }); }, cfg.pollMs);
    }

    const listApi = {
      state,
      load,
      reload: () => load({ silent: true }),
      optimistic,
      destroy() { if (state.pollTimer) clearInterval(state.pollTimer); },
      setFilter(name, value) { state.filters[name] = value; state.page = 1; rebuildToolbar(); load(); },
      /** Jump the table to a search term (used to reveal a just-created row). */
      setQuery(q) { state.q = q || ''; state.page = 1; rebuildToolbar(); load(); },
      root,
    };
    return listApi;
  }

  global.ListEngine = { createList };
})(window);
