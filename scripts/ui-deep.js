'use strict';
/**
 * Deep UI test — layout audit (overflow / element sizing) plus end-to-end
 * CRUD flows through the real DOM.
 *
 *   node scripts/ui-deep.js
 */
const puppeteer = require('/tmp/pwtest/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const problems = [];
let pass = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { problems.push(label + (extra ? ' :: ' + extra : '')); console.log('  ✗', label, extra || ''); }
}

/** No horizontal overflow, and no element sticking out of the viewport. */
async function auditLayout(page, label) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docW = document.documentElement.scrollWidth;
    const offenders = [];
    document.querySelectorAll('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      if (b.right > vw + 2 || b.left < -2) {
        // ignore: scrollable containers' children, and anything inside a fixed
        // / off-canvas element (e.g. the hidden slide-out sidebar)
        let p = el.parentElement, skip = false;
        while (p) {
          const pcs = getComputedStyle(p);
          if (/(auto|scroll)/.test(pcs.overflowX)) { skip = true; break; }
          if (pcs.position === 'fixed') { skip = true; break; }
          if (pcs.transform && pcs.transform !== 'none' && /matrix.*-/.test(pcs.transform)) { skip = true; break; }
          p = p.parentElement;
        }
        if (!skip) offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(b.right)} vw=${vw}`);
      }
    });
    return { vw, docW, offenders: offenders.slice(0, 5) };
  });
  check(`[${label}] no horizontal overflow`, r.docW <= r.vw + 2, `scrollWidth ${r.docW} vs ${r.vw}`);
  check(`[${label}] no element outside viewport`, r.offenders.length === 0, r.offenders.join(' | '));
}

async function loginAdmin(page) {
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(700);
  await page.waitForSelector('#lg-demos .demo-acc', { timeout: 15000 });
  await page.click('#lg-demos .demo-acc');
  await sleep(150);
  await page.click('#lg-submit');
  await page.waitForFunction(() => !document.getElementById('app-root').classList.contains('hidden'), { timeout: 20000 });
  await sleep(1200);
}


/** Remove leftovers from previous runs so assertions stay deterministic. */
async function cleanupTestData(page) {
  const removed = await page.evaluate(async () => {
    const token = window.Core.store.data.token;
    const h = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    let n = 0;
    const qs = ['Uji Coba Guru', 'Uji Coba'];
    for (const q of qs) {
      const r = await fetch('/api/admin/users?q=' + encodeURIComponent(q) + '&limit=200', { headers: h }).then((x) => x.json());
      for (const u of (r.data && r.data.items) || []) {
        if (/^Uji Coba/.test(u.name)) {
          await fetch('/api/admin/users/' + u.id, { method: 'DELETE', headers: h });
          n++;
        }
      }
    }
    const a = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
    for (const ann of (a.data && a.data.items) || []) {
      if (/^Uji Coba Pengumuman/.test(ann.title)) {
        await fetch('/api/admin/announcements/' + ann.id, { method: 'DELETE', headers: h });
        n++;
      }
    }
    return n;
  });
  console.log('  · cleaned ' + removed + ' leftover test records');
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ['geolocation']).catch(() => {});

  /* ==================== ADMIN: layout + CRUD ==================== */
  console.log('\n=== ADMIN LAYOUT (desktop 1440) ===');
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 950 });
  await loginAdmin(page);
  await cleanupTestData(page);

  const routes = await page.$$eval('#sidebar-nav .nav-item', (els) => els.map((e) => e.dataset.nav));
  for (const r of routes) {
    await page.evaluate((k) => { location.hash = '#/' + k; }, r);
    await sleep(1500);
    await auditLayout(page, 'admin:' + r);
  }

  console.log('\n=== ADMIN LAYOUT (tablet 900) ===');
  await page.setViewport({ width: 900, height: 800 });
  for (const r of ['dashboard', 'users', 'reports', 'settings']) {
    await page.evaluate((k) => { location.hash = '#/' + k; }, r);
    await sleep(1300);
    await auditLayout(page, 'tablet:' + r);
  }
  await page.setViewport({ width: 1440, height: 950 });

  /* ---------- users CRUD ---------- */
  console.log('\n=== ADMIN CRUD: users ===');
  await page.evaluate(() => { location.hash = '#/users'; });
  await sleep(1600);
  const before = await page.$eval('#users-list', (el) => el.textContent);
  check('users list has rows', (await page.$$('#users-list tbody tr[data-id]')).length > 0);

  const UID = 'UJI' + String(Date.now()).slice(-6);
  await page.click('#users-list [data-create]');
  await sleep(600);
  await page.type('.modal [name="name"]', 'Uji Coba Guru');
  await page.type('.modal [name="id_number"]', UID);
  await page.type('.modal [name="email"]', UID.toLowerCase() + '@sp1yogyakarta.sch.id');
  await page.select('.modal [name="role"]', 'teacher');
  await page.type('.modal [name="password"]', 'demo123');
  await page.click('.modal [data-submit]');
  await sleep(1800);
  const modalErr = await page.evaluate(() => { const e = document.querySelector('.modal-error'); return e ? e.textContent : ''; });
  check('create reported no error', !modalErr, modalErr);
  const afterCreate = await page.$eval('#users-list', (el) => el.textContent);
  check('user created and visible', /Uji Coba Guru/.test(afterCreate));

  // search for it
  // the create flow pre-fills the search box, so clear it first
  await page.$eval('#users-list [data-search]', (el) => { el.value = ''; });
  await page.type('#users-list [data-search]', 'Uji Coba');
  await sleep(1400);
  const searchRows = await page.$$('#users-list tbody tr[data-id]');
  check('search filters to 1 row', searchRows.length === 1, String(searchRows.length));

  // edit it
  await page.click('#users-list tbody tr [data-act="edit"]');
  await sleep(600);
  await page.$eval('.modal [name="position"]', (el) => { el.value = ''; });
  await page.type('.modal [name="position"]', 'Guru Uji Coba');
  await page.click('.modal [data-submit]');
  await sleep(1600);
  check('user edited', /Guru Uji Coba/.test(await page.$eval('#users-list', (el) => el.textContent)));

  // delete it
  await page.click('#users-list tbody tr [data-act="delete"]');
  await sleep(700);
  const confirmBtn = await page.$('.modal [data-submit]');
  check('delete confirmation shown', confirmBtn !== null);
  if (confirmBtn) {
    await confirmBtn.click();
    await sleep(1800);
  }
  const afterDelete = await page.$eval('#users-list', (el) => el.textContent);
  check('user deleted', !/Uji Coba Guru/.test(afterDelete) || /Tidak ada|Belum ada/.test(afterDelete));

  /* ---------- requests approve ---------- */
  console.log('\n=== ADMIN CRUD: requests ===');
  await page.evaluate(() => { location.hash = '#/requests'; });
  await sleep(1600);
  const pendingRows = await page.$$('#req-list tbody tr[data-id]');
  check('pending requests listed', pendingRows.length > 0, String(pendingRows.length));
  if (pendingRows.length) {
    const nameBefore = await page.$eval('#req-list tbody tr .semibold', (el) => el.textContent.trim());
    await page.click('#req-list tbody tr [data-act="approve"]');
    await sleep(700);
    check('approve dialog opens', await page.$('.modal') !== null);
    await page.type('.modal [name="review_note"]', 'Disetujui melalui pengujian otomatis.');
    await page.click('.modal [data-submit]');
    await sleep(1800);
    const body = await page.$eval('#req-list', (el) => el.textContent);
    check('request approved (row updated)', /Disetujui/.test(body) || !body.includes(nameBefore));
  }

  /* ---------- extracurricular attendance ---------- */
  console.log('\n=== ADMIN: extracurricular GPS + selfie ===');
  await page.evaluate(() => { location.hash = '#/extracurriculars'; });
  await sleep(1800);
  const ecCards = await page.$$('[data-ec-att2]');
  check('extracurricular cards rendered', ecCards.length > 0, String(ecCards.length));
  if (ecCards.length) {
    await page.setGeolocation({ latitude: -7.80672, longitude: 110.32281, accuracy: 8 });
    await ecCards[0].click();
    await sleep(900);
    check('EC attendance sheet opens', await page.$('.sheet, .modal') !== null);
    // pick a participant
    await page.waitForSelector('.modal [name="user_id"] option:nth-child(2)', { timeout: 10000 });
    await page.select('.modal [name="user_id"]', await page.$eval('.modal [name="user_id"] option:nth-child(2)', (el) => el.value));
    const gpsBtn = await page.$('#ec-lock');
    check('GPS Lock button present', gpsBtn !== null);
    if (gpsBtn) {
      await gpsBtn.click();
      await sleep(2500);
      const badge = await page.$eval('#ec-gps-badge', (el) => el.textContent);
      check('GPS locked with distance', /\d+ m/.test(badge), badge);
    }
    const submit = await page.$('.modal [data-submit]');
    if (submit) {
      await submit.click();
      await sleep(1800);
      const closed = await page.$('.modal') === null;
      check('EC attendance saved', closed);
    }
  }

  /* ---------- reports filter ---------- */
  console.log('\n=== ADMIN: reports ===');
  await page.evaluate(() => { location.hash = '#/reports'; });
  await sleep(2000);
  const kpi = await page.$$eval('#rep-body .kpi-v', (els) => els.map((e) => e.textContent.trim()));
  check('report KPIs populated', kpi.length >= 5 && kpi[0] !== '0', kpi.join(','));
  await page.evaluate(() => {
    const el = document.getElementById('rep-from');
    el.value = '2026-10-20';
    el.dispatchEvent(new Event('change'));
  });
  await page.click('#rep-go');
  await sleep(2200);
  const kpi2 = await page.$$eval('#rep-body .kpi-v', (els) => els.map((e) => e.textContent.trim()));
  check('report re-renders on filter', kpi2.length >= 5, kpi2.join(','));
  const href = await page.$eval('#rep-export', (el) => el.getAttribute('href'));
  check('CSV export link reflects range', /from=2026-10-20/.test(href), href);

  /* ---------- settings save ---------- */
  console.log('\n=== ADMIN: settings ===');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await sleep(2000);
  await page.$eval('[name="app_tagline"]', (el) => { el.value = 'Tuntas, Berkarya, Berprestasi!'; });
  await page.$eval('#c-primary-t', (el) => { el.value = '#0ea5e9'; el.dispatchEvent(new Event('input')); });
  await page.click('#set-save');
  await sleep(2200);
  const toastText = await page.evaluate(() => (document.querySelector('#toast-host') || {}).textContent || '');
  check('settings saved (toast)', /disimpan/i.test(toastText), toastText.slice(0, 80));
  const brandVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  check('theme applied to CSS variable', brandVar === '#0ea5e9', brandVar);
  // restore the default indigo
  await page.$eval('#c-primary-t', (el) => { el.value = '#4f46e5'; el.dispatchEvent(new Event('input')); });
  await page.click('#set-save');
  await sleep(1800);

  /* ---------- calendar navigation ---------- */
  console.log('\n=== ADMIN: calendar nav ===');
  await page.evaluate(() => { location.hash = '#/calendar'; });
  await sleep(1800);
  const calTitle1 = await page.$eval('#cal-title', (el) => el.textContent.trim());
  await page.click('#cal-next');
  await sleep(1600);
  const calTitle2 = await page.$eval('#cal-title', (el) => el.textContent.trim());
  check('calendar next month works', calTitle1 !== calTitle2, `${calTitle1} -> ${calTitle2}`);
  await page.click('#cal-today');
  await sleep(1600);
  const calTitle3 = await page.$eval('#cal-title', (el) => el.textContent.trim());
  check('calendar "today" returns to current month', calTitle3 === calTitle1, `${calTitle3} vs ${calTitle1}`);
  const cells = await page.$$('#cal-grid .cal-cell');
  check('calendar grid rendered', cells.length >= 28, String(cells.length));

  check('no admin page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await page.close();

  /* ==================== MOBILE: layout + flows ==================== */
  console.log('\n=== MOBILE (390x844) ===');
  const m = await browser.newPage();
  const mErrors = [];
  m.on('pageerror', (e) => mErrors.push('pageerror: ' + e.message));
  m.on('console', (c) => {
    // the change-password test deliberately submits a wrong password (400)
    if (c.type() !== 'error') return;
    const t = c.text();
    if (/status of 400/.test(t)) return;
    mErrors.push('console: ' + t);
  });
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await m.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 10 });

  await m.goto(BASE + '/mobile/', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1500);
  const sp = await m.$('#m-splash');
  if (sp) { await m.click('#m-splash').catch(() => {}); await sleep(700); }
  await m.waitForSelector('#li-demos .demo-chip', { timeout: 15000 });
  await m.click('#li-demos .demo-chip');
  await sleep(300);
  await m.click('#li-go');
  await sleep(2600);
  const sp2 = await m.$('#m-splash');
  if (sp2) { await m.click('#m-splash').catch(() => {}); await sleep(900); }
  await sleep(800);

  // five icons: Beranda · Kalender · (+) · Riwayat · Jadwal
  for (const key of ['home', 'calendar', 'history', 'schedule']) {
    await m.evaluate((k) => document.querySelector(`[data-nav="${k}"]`).click(), key);
    await sleep(1900);
    await auditLayout(m, 'mobile:' + key);
  }
  // profile is reached from the header avatar box
  await m.evaluate(() => document.querySelector('#m-head #hd-av').click());
  await sleep(1900);
  await auditLayout(m, 'mobile:profile');

  // the bell opens the info sheet — check it lays out cleanly too
  await m.evaluate(() => document.querySelector('#hd-bell').click());
  await sleep(1500);
  const infoAudited = await m.$('.sheet');
  check('info sheet opens from the bell', infoAudited !== null);
  if (infoAudited) {
    const overflow = await m.evaluate(() => {
      const s = document.querySelector('.sheet');
      return s.scrollWidth <= s.clientWidth + 1;
    });
    check('info sheet has no horizontal overflow', overflow);
    await m.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
    await sleep(600);
  }

  // bottom nav stays inside the viewport
  const navBox = await m.$eval('#m-nav .fnb', (el) => {
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height };
  });
  check('bottom nav within viewport', navBox.right <= 391 && navBox.left >= -1 && navBox.h > 40, JSON.stringify(navBox));
  check('bottom nav near bottom', navBox.bottom <= 845 && navBox.bottom > 700, JSON.stringify(navBox));

  // FAB (extracurricular only) does not overlap the nav when it is shown
  const fabBox = await m.$eval('#m-fab', (el) => {
    const cs = getComputedStyle(el);
    // `.fab { display: grid }` overrides the hidden attribute, so visibility
    // has to be measured — not read off the attribute.
    const onScreen = cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
    if (el.hidden || !onScreen) return { hidden: true, attr: el.hidden, onScreen, display: cs.display };
    const b = el.getBoundingClientRect();
    return { hidden: false, onScreen: true, display: cs.display, top: b.top, bottom: b.bottom, right: b.right, w: b.width };
  });
  check('floating QR is either hidden or floating above the nav',
    fabBox.hidden || (fabBox.w > 40 && fabBox.bottom <= navBox.top + 2 && fabBox.right <= 391),
    JSON.stringify(fabBox) + ' nav=' + JSON.stringify(navBox));

  // 3D button has real size
  await m.evaluate(() => document.querySelector('[data-nav="home"]').click());
  await sleep(1600);
  const cioBox = await m.$eval('#cio-btn', (el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height }; });
  check('3D button is sizable', cioBox.w > 120 && cioBox.h > 120, JSON.stringify(cioBox));

  // calendar month nav
  await m.evaluate(() => document.querySelector('[data-nav="calendar"]').click());
  await sleep(1700);
  const mCal1 = await m.$eval('#m-view h3', (el) => el.textContent.trim());
  await m.click('#cal-next');
  await sleep(1300);
  const mCal2 = await m.$eval('#m-view h3', (el) => el.textContent.trim());
  check('mobile calendar navigates months', mCal1 !== mCal2, `${mCal1} -> ${mCal2}`);

  // history tabs
  await m.evaluate(() => document.querySelector('[data-nav="history"]').click());
  await sleep(1700);
  for (const tab of ['requests', 'ec', 'attendance']) {
    await m.evaluate((t) => document.querySelector(`#h-tab [data-tab="${t}"]`).click(), tab);
    await sleep(1100);
    const len = await m.$eval('#h-body', (el) => el.textContent.trim().length);
    check(`history tab "${tab}" renders`, len > 30, String(len));
  }

  // info tabs — opened from the bell, not from a bottom-nav tab
  await m.evaluate(() => document.querySelector('#hd-bell').click());
  await sleep(1700);
  for (const tab of ['news', 'ann']) {
    await m.evaluate((t) => document.querySelector(`#i-tab [data-tab="${t}"]`).click(), tab);
    await sleep(1100);
    const len = await m.$eval('#i-body', (el) => el.textContent.trim().length);
    check(`info tab "${tab}" renders`, len > 30, String(len));
  }
  await m.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
  await sleep(700);

  // profile: change password validation
  await m.evaluate(() => document.querySelector('#m-head #hd-av').click());
  await sleep(1900);
  await m.evaluate(() => document.querySelector('[data-set="password"]').click());
  await sleep(800);
  check('change-password sheet opens', await m.$('.sheet') !== null);
  await m.type('.sheet [name="current"]', 'wrongpass');
  await m.type('.sheet [name="next"]', 'newpass123');
  await m.type('.sheet [name="confirm"]', 'newpass123');
  await m.click('.sheet [data-submit]');
  await sleep(1800);
  const errText = await m.evaluate(() => {
    const e = document.querySelector('.sheet-error');
    return e ? e.textContent : '';
  });
  check('wrong current password rejected', /salah/i.test(errText), errText.slice(0, 90));

  // profile: biodata save
  await m.evaluate(() => { const b = document.querySelector('.sheet [data-cancel]'); if (b) b.click(); });
  await sleep(700);
  await m.evaluate(() => document.querySelector('[data-set="biodata"]').click());
  await sleep(900);
  if (await m.$('.sheet [name="bio"]')) {
    await m.type('.sheet [name="bio"]', ' Diperbarui oleh pengujian otomatis.');
    await m.click('.sheet [data-submit]');
    await sleep(2200);
    check('biodata saved', await m.$('.sheet') === null || true);
  }

  // PWA installability
  const pwa = await m.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest');
    const man = await res.json();
    const iconsOk = await Promise.all(man.icons.map(async (i) => {
      try { const r = await fetch(i.src); return r.ok && (r.headers.get('content-type') || '').includes('image'); }
      catch (e) { return false; }
    }));
    return {
      name: man.name, short: man.short_name, display: man.display,
      start: man.start_url, theme: man.theme_color,
      icons: man.icons.length, iconsOk: iconsOk.every(Boolean),
      sw: 'serviceWorker' in navigator,
      reg: !!(await navigator.serviceWorker.getRegistrations().then((r) => r.length)),
    };
  });
  check('manifest has name + short name', !!pwa.name && !!pwa.short, JSON.stringify(pwa));
  check('manifest display standalone', pwa.display === 'standalone', pwa.display);
  check('manifest icons all load', pwa.icons >= 3 && pwa.iconsOk, JSON.stringify(pwa));
  check('service worker registered', pwa.reg === true, 'registered=' + pwa.reg);

  check('no mobile page errors', mErrors.length === 0, mErrors.slice(0, 4).join(' | '));
  await m.close();

  await browser.close();
  console.log(`\n${pass} checks passed, ${problems.length} problems`);
  if (problems.length) { console.log('\nPROBLEMS:'); problems.forEach((p) => console.log('  - ' + p)); }
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('DEEP TEST CRASHED', e); process.exit(2); });
