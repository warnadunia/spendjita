'use strict';
/**
 * Feature UI test — covers the role-scoped scheduling & extracurricular work:
 *
 *   • admin: class timetable CRUD, extracurricular schedules / places /
 *     members / mentors managers
 *   • mobile: avatar bottom-nav, role-scoped calendar day detail,
 *     point rank grouped by role, assigned-extracurricular scoping
 *
 *   node scripts/ui-features.js
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('/tmp/pwtest/node_modules/puppeteer');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SHOTS = path.join(__dirname, '..', 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const problems = [];
let pass = 0;

function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { problems.push(label + (extra ? ' :: ' + extra : '')); console.log('  ✗', label, extra || ''); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, opts) {
  const o = opts || {};
  const page = await browser.newPage();
  await page.setViewport(o.viewport || { width: 1440, height: 950, deviceScaleFactor: 1 });
  if (o.mobile) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  }
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!/fonts\.(googleapis|gstatic)\.com/.test(u)) errors.push('requestfailed: ' + u);
  });
  page.__errors = errors;
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

/** Log in on the admin web. */
async function adminLogin(page) {
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(700);
  await page.waitForSelector('#lg-demos .demo-acc', { timeout: 20000 });
  await page.click('#lg-demos .demo-acc');
  await sleep(250);
  await page.click('#lg-submit');
  await page.waitForSelector('#app-root:not(.hidden)', { timeout: 25000 });
  await sleep(1400);
}

/** Log in on the mobile PWA with an explicit id number. */
async function mobileLogin(page, idNumber) {
  // Each mobile persona must start from a clean session — localStorage is
  // shared across pages in the same browser context.
  await page.goto(BASE + '/mobile/', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  await page.waitForSelector('#li-id', { timeout: 20000 });
  await page.click('#li-id');
  await page.type('#li-id', idNumber);
  await page.click('#li-pass');
  await page.type('#li-pass', 'demo123');
  await page.click('#li-go');
  await page.waitForSelector('#m-app:not(.hidden)', { timeout: 25000 });
  await sleep(1800);
}

/**
 * Swap the device camera for a canvas. Lets the decode loop be driven
 * headlessly: `painter` draws whatever the "lens" should see.
 */
const FAKE_CAMERA = (p, painter) => p.evaluate((src) => {
  window.__paint = eval(src);
  navigator.mediaDevices.getUserMedia = () => {
    const cv = document.createElement('canvas');
    cv.width = 640; cv.height = 640;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 640, 640);
    return Promise.resolve(window.__paint(ctx, cv)).then(() => cv.captureStream(15));
  };
}, painter);

const PAINT_QR = `(ctx, cv) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => { ctx.drawImage(img, 40, 40, 560, 560); resolve(); };
  img.onerror = () => reject(new Error('qr gagal dimuat'));
  img.src = '/api/public/kiosk/qr.svg?size=560&t=' + Date.now();
})`;

const PAINT_TEXT = (text) => `(ctx, cv) => { ctx.fillStyle = '#000'; ctx.font = '40px sans-serif';
  ctx.fillText(${JSON.stringify(text)}, 60, 320); return Promise.resolve(); }`;

/** The floating button must be gone from the screen, not merely flagged. */
const fabVisible = (page) => page.evaluate(() => {
  const el = document.getElementById('m-fab');
  if (!el) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
});

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
      // a synthetic camera + auto-granted permission, so the live selfie and
      // the QR scanner can actually be driven headlessly
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--allow-file-access-from-files',
    ],
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ['geolocation', 'camera']).catch(() => {});

  /* ================================================================ *
   *  ADMIN — class timetable + extracurricular sub managers
   * ================================================================ */
  console.log('\n=== ADMIN: JADWAL MENGAJAR ===');
  const admin = await newPage(browser);
  await adminLogin(admin);

  const routes = await admin.$$eval('#sidebar-nav .nav-item', (els) => els.map((e) => e.dataset.nav));
  check('nav includes classSchedules', routes.includes('classSchedules'), routes.join(','));

  await admin.evaluate(() => { location.hash = '#/classSchedules'; });
  await sleep(1800);
  const csRows = await admin.$$('#cs-list tbody tr[data-id]');
  check('class schedule table populated', csRows.length > 5, String(csRows.length));
  await shot(admin, 'f01-admin-class-schedules');

  // ---- create a schedule for a teacher -------------------------------
  await admin.click('#cs-add');
  await sleep(700);
  check('class schedule form opens', await admin.$('.modal') !== null);
  const teacherOpts = await admin.$$eval('#cs-teacher option', (els) => els.length);
  check('teacher dropdown populated', teacherOpts > 5, String(teacherOpts));
  await admin.select('.modal [name="day"]', 'Senin');
  await admin.click('.modal [name="class_name"]', { clickCount: 3 });
  await admin.type('.modal [name="class_name"]', 'ZZ-UJI');
  await admin.click('.modal [name="subject"]', { clickCount: 3 });
  await admin.type('.modal [name="subject"]', 'Uji Otomatis');
  const tId = await admin.$eval('#cs-teacher option:nth-child(2)', (el) => el.value);
  await admin.select('#cs-teacher', tId);
  await shot(admin, 'f02-admin-class-schedule-form');
  await admin.click('.modal [data-submit]');
  await sleep(1800);
  const created = await admin.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/class-schedules?class_name=ZZ-UJI', { headers: h }).then((x) => x.json());
    return (r.data && r.data.items) || [];
  });
  check('class schedule created', created.length === 1, String(created.length));
  check('created schedule has a teacher', created[0] && !!created[0].teacher_id);

  // ---- weekly grid ----------------------------------------------------
  await admin.click('#cs-week');
  await sleep(1200);
  const gridText = await admin.$eval('.modal .modal-body, .modal', (el) => el.textContent);
  check('weekly grid renders classes', /Kelas VII-A/.test(gridText));
  await shot(admin, 'f03-admin-week-grid');
  await admin.click('.modal [data-cancel]');
  await sleep(500);

  // ---- delete it again ------------------------------------------------
  const deleted = await admin.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/class-schedules?class_name=ZZ-UJI', { headers: h }).then((x) => x.json());
    let n = 0;
    for (const s of (r.data && r.data.items) || []) {
      await fetch('/api/admin/class-schedules/' + s.id, { method: 'DELETE', headers: h });
      n++;
    }
    return n;
  });
  check('class schedule deleted', deleted === 1, String(deleted));

  /* ------------------ extracurricular sub managers ------------------- */
  console.log('\n=== ADMIN: EKSTRAKURIKULER MANAGERS ===');
  await admin.evaluate(() => { location.hash = '#/extracurriculars'; });
  await sleep(1800);
  const cards = await admin.$$('#ec-grid .card');
  check('extracurricular cards render', cards.length >= 8, String(cards.length));
  const kpis = await admin.$$eval('#ec-grid .kpi-cell', (els) => els.length);
  check('EC cards show member/schedule/place/mentor KPIs', kpis >= 32, String(kpis));
  await shot(admin, 'f04-admin-extracurriculars');

  const ecId = await admin.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
    const r = await fetch('/api/admin/extracurriculars', { headers: h }).then((x) => x.json());
    return r.data.items[0].id;
  });

  // schedules
  await admin.click('[data-ec-sched="' + ecId + '"]');
  await sleep(1400);
  check('schedule manager opens', await admin.$('.modal') !== null);
  const schedText = await admin.$eval('.modal', (el) => el.textContent);
  check('schedule manager lists days', /Senin|Selasa|Rabu|Kamis|Jumat|Sabtu/.test(schedText));
  await shot(admin, 'f05-admin-ec-schedules');
  await admin.click('.modal [data-add]');
  await sleep(800);
  await admin.select('.modal [name="day"]', 'Minggu');
  await admin.click('.modal [data-submit]');
  await sleep(1600);
  const schedAdded = await admin.evaluate(async (id) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
    const r = await fetch('/api/admin/ec-schedules?extracurricular_id=' + id, { headers: h }).then((x) => x.json());
    return (r.data.items || []).filter((s) => s.day === 'Minggu').length;
  }, ecId);
  check('EC schedule added', schedAdded === 1, String(schedAdded));
  await admin.evaluate(async (id) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/ec-schedules?extracurricular_id=' + id, { headers: h }).then((x) => x.json());
    for (const s of (r.data.items || [])) {
      if (s.day === 'Minggu') await fetch('/api/admin/ec-schedules/' + s.id, { method: 'DELETE', headers: h });
    }
  }, ecId);
  await sleep(400);
  await admin.click('.modal [data-cancel]');
  await sleep(500);

  // places
  await admin.click('[data-ec-places="' + ecId + '"]');
  await sleep(1400);
  const placeText = await admin.$eval('.modal', (el) => el.textContent);
  check('place manager opens', /radius/.test(placeText), placeText.slice(0, 80));
  await shot(admin, 'f06-admin-ec-places');
  await admin.click('.modal [data-add]');
  await sleep(800);
  await admin.type('.modal [name="name"]', 'Tempat Uji Otomatis');
  await admin.click('.modal [data-submit]');
  await sleep(1600);
  const placeAdded = await admin.evaluate(async (id) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
    const r = await fetch('/api/admin/ec-places?extracurricular_id=' + id, { headers: h }).then((x) => x.json());
    return (r.data.items || []).filter((p) => /^Tempat Uji/.test(p.name)).length;
  }, ecId);
  check('EC place added', placeAdded === 1, String(placeAdded));
  await admin.evaluate(async (id) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/ec-places?extracurricular_id=' + id, { headers: h }).then((x) => x.json());
    for (const p of (r.data.items || [])) {
      if (/^Tempat Uji/.test(p.name)) await fetch('/api/admin/ec-places/' + p.id, { method: 'DELETE', headers: h });
    }
  }, ecId);
  await sleep(400);
  await admin.click('.modal [data-cancel]');
  await sleep(500);

  // members (bulk add + grade group)
  await admin.click('[data-ec-members="' + ecId + '"]');
  await sleep(1600);
  const memberChips = await admin.$$eval('.modal [data-grp]', (els) => els.length);
  check('member manager groups rendered', memberChips >= 1, String(memberChips));
  const memberIds = (id) => admin.evaluate(async (x) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
    const r = await fetch('/api/admin/ec-members?extracurricular_id=' + x + '&limit=500', { headers: h }).then((y) => y.json());
    return (r.data.items || []).map((m) => m.id);
  }, id);
  const beforeIds = await memberIds(ecId);
  const beforeCount = beforeIds.length;
  await shot(admin, 'f07-admin-ec-members');
  await admin.click('.modal [data-add]');
  await sleep(1600);
  await admin.waitForSelector('#am-list [data-pick]', { timeout: 20000 });
  await admin.select('#am-group', 'Kelas VII');
  await admin.click('#am-all');
  await sleep(400);
  const picked = await admin.$$eval('#am-list [data-pick]', (els) => els.filter((e) => e.checked).length);
  check('bulk picker selects candidates', picked > 0, String(picked));
  await shot(admin, 'f08-admin-ec-add-members');
  await admin.click('.modal [data-submit]');
  await sleep(1800);
  const afterIds = await memberIds(ecId);
  const afterCount = afterIds.length;
  check('members bulk added', afterCount > beforeCount, `${beforeCount} → ${afterCount}`);
  // Cleanup removes exactly the rows this run created, so the suite stays
  // idempotent no matter which grade group the picker happened to use.
  const addedIds = afterIds.filter((id) => beforeIds.indexOf(id) === -1);
  await admin.evaluate(async (ids) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    for (const id of ids) await fetch('/api/admin/ec-members/' + id, { method: 'DELETE', headers: h });
  }, addedIds);
  const restoredIds = await memberIds(ecId);
  check('bulk-added members are cleaned up again', restoredIds.length === beforeCount,
    `${beforeCount} → ${afterCount} → ${restoredIds.length}`);
  await sleep(500);
  const modalOpen = await admin.$('.modal');
  if (modalOpen) { await admin.click('.modal [data-cancel]').catch(() => {}); await sleep(500); }

  // mentors
  await admin.click('[data-ec-mentors="' + ecId + '"]');
  await sleep(1500);
  const mentorText = await admin.$eval('.modal', (el) => el.textContent);
  check('mentor manager opens', /Pembina/.test(mentorText));
  await shot(admin, 'f09-admin-ec-mentors');
  await admin.click('.modal [data-add]');
  await sleep(1200);
  const staffOpts = await admin.$$eval('#mt-user option', (els) => els.length);
  check('mentor picker lists teachers + employees', staffOpts > 5, String(staffOpts));
  const newMentor = await admin.$eval('#mt-user optgroup:nth-of-type(2) option', (el) => el.value);
  await admin.select('#mt-user', newMentor);
  await admin.select('.modal [name="mentor_role"]', 'Asisten Pelatih');
  await admin.click('.modal [data-submit]');
  await sleep(1600);
  const mentorCount = await admin.evaluate(async (id) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
    const r = await fetch('/api/admin/ec-mentors?extracurricular_id=' + id, { headers: h }).then((x) => x.json());
    return r.data.items.length;
  }, ecId);
  check('mentor added', mentorCount >= 4, String(mentorCount));
  await admin.evaluate(async (id) => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/ec-mentors?extracurricular_id=' + id, { headers: h }).then((x) => x.json());
    for (const m of (r.data.items || [])) {
      if (m.mentor_role === 'Asisten Pelatih' && !m.is_primary) {
        await fetch('/api/admin/ec-mentors/' + m.id, { method: 'DELETE', headers: h });
        break;
      }
    }
  }, ecId);
  await sleep(400);
  const m2 = await admin.$('.modal');
  if (m2) { await admin.click('.modal [data-cancel]').catch(() => {}); await sleep(400); }

  /* ---------- user form shows the extracurricular assignments ---------- */
  await admin.evaluate(() => { location.hash = '#/users'; });
  await sleep(1700);
  await admin.evaluate(() => {
    const s = document.querySelector('#users-list [data-search], #users-list input[type="search"], #users-list .toolbar input');
    if (!s) return;
    s.value = 'SP1TA7A01';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1800);
  const editBtn = await admin.$('#users-list [data-act="edit"]');
  check('student row found via search', editBtn !== null);
  if (editBtn) {
    await editBtn.click();
    await sleep(1800);
    const formText = await admin.$eval('.modal', (el) => el.textContent);
    check('user form lists extracurricular assignments', /Ekstrakurikuler & penugasan|Ekstrakurikuler &amp; penugasan/.test(formText), formText.slice(-160));
    const ecLines = await admin.$$eval('#u-ec .badge', (els) => els.map((e) => e.textContent.trim()));
    check('user form shows at least one assignment', ecLines.length >= 1, ecLines.join(','));
    await shot(admin, 'f22-admin-user-extracurriculars');
    await admin.click('.modal [data-cancel]');
    await sleep(500);
  }

  /* ------------------ announcements & news media --------------------- */
  console.log('\n=== ADMIN: PENGUMUMAN & BERITA (lampiran + tautan) ===');
  const fixture = path.join(SHOTS, '.uji-lampiran.png');
  fs.writeFileSync(fixture, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'));

  await admin.evaluate(() => { location.hash = '#/announcements'; });
  await sleep(1800);
  await admin.click('#ann-add');
  await sleep(700);
  check('announcement form opens', (await admin.$('.modal')) !== null);
  const formText0 = await admin.$eval('.modal', (el) => el.textContent);
  check('form offers an attachment picker', /Lampiran/.test(formText0), formText0.slice(0, 160));
  check('form offers an external-link field', /Tautan eksternal/.test(formText0));
  check('attachment picker starts empty', /Belum ada lampiran/.test(formText0));

  await admin.click('.modal [name="title"]', { clickCount: 3 });
  await admin.type('.modal [name="title"]', 'Uji lampiran dan tautan');
  await admin.click('.modal [name="details"]', { clickCount: 3 });
  await admin.type('.modal [name="details"]', 'Pengumuman uji untuk memastikan lampiran dan tautan eksternal tersimpan dengan benar.');
  await admin.click('.modal [name="link_url"]');
  await admin.type('.modal [name="link_url"]', 'https://sp1yogyakarta.sch.id/daftar');
  await admin.click('.modal [name="link_label"]');
  await admin.type('.modal [name="link_label"]', 'Form pendaftaran');
  const fileInput = await admin.$('.modal input[type="file"]');
  check('file input exists for the attachment', fileInput !== null);
  if (fileInput) await fileInput.uploadFile(fixture);
  await sleep(900);
  const attPicked = await admin.$eval('#att-box', (el) => el.textContent);
  check('picked file is shown in the picker', /uji-lampiran\.png/.test(attPicked), attPicked.replace(/\s+/g, ' ').slice(0, 90));
  await shot(admin, 'f23-admin-announcement-media-form');

  await admin.click('.modal [data-submit]');
  await sleep(2000);
  check('announcement saved', (await admin.$('.modal')) === null);

  const annStored = await admin.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
    return ((r.data && r.data.items) || []).find((a) => a.title === 'Uji lampiran dan tautan') || null;
  });
  check('attachment persisted', !!(annStored && annStored.attachment && annStored.attachment.data), annStored && !!annStored.attachment);
  check('external link persisted', !!(annStored && annStored.link_url === 'https://sp1yogyakarta.sch.id/daftar'
    && annStored.link_label === 'Form pendaftaran'), annStored && annStored.link_url);
  const cardText = await admin.$eval('#ann-grid', (el) => el.textContent);
  check('card shows the attachment chip', /uji-lampiran\.png/.test(cardText), cardText.slice(0, 160));
  check('card shows the link chip', /Form pendaftaran/.test(cardText));
  await shot(admin, 'f24-admin-announcement-chips');

  // detail page preview — click the view button on OUR card
  const viewBtn = await admin.evaluateHandle(() => {
    const card = [...document.querySelectorAll('#ann-grid .card')]
      .find((c) => /Uji lampiran dan tautan/.test(c.textContent));
    return card ? card.querySelector('[data-view]') : null;
  });
  check('detail button on the card', !!(viewBtn && viewBtn.asElement()));
  if (viewBtn && viewBtn.asElement()) {
    await viewBtn.asElement().click();
    await sleep(900);
    const detText = await admin.$eval('.modal', (el) => el.textContent);
    check('detail page opens', /Detail pengumuman/.test(detText), detText.slice(0, 100));
    check('detail page shows the attachment', /uji-lampiran\.png/.test(detText));
    check('detail page shows the external link', /Form pendaftaran/.test(detText) && /sp1yogyakarta\.sch\.id/.test(detText));
    const imgOk = await admin.$('.modal .att-view img');
    check('image attachment is previewed inline', imgOk !== null);
    const linkHref = await admin.$eval('.modal .att-link', (el) => el.getAttribute('href'));
    check('external link points at the URL', linkHref === 'https://sp1yogyakarta.sch.id/daftar', linkHref);
    await shot(admin, 'f25-admin-announcement-detail');
    await admin.click('.modal .modal-close');
    await sleep(500);
  }

  // same on news
  await admin.evaluate(() => { location.hash = '#/news'; });
  await sleep(1800);
  await admin.click('#news-add');
  await sleep(700);
  const newsForm = await admin.$eval('.modal', (el) => el.textContent);
  check('news form offers the same media fields', /Lampiran/.test(newsForm) && /Tautan eksternal/.test(newsForm));
  await admin.click('.modal [name="title"]', { clickCount: 3 });
  await admin.type('.modal [name="title"]', 'Berita uji tautan');
  await admin.click('.modal [name="details"]', { clickCount: 3 });
  await admin.type('.modal [name="details"]', 'Berita uji untuk memastikan tautan eksternal tersimpan dengan benar.');
  await admin.click('.modal [name="link_url"]');
  await admin.type('.modal [name="link_url"]', 'https://example.org/pengumuman');
  await admin.click('.modal [data-submit]');
  await sleep(1800);
  const newsStored = await admin.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const r = await fetch('/api/admin/news', { headers: h }).then((x) => x.json());
    return ((r.data && r.data.items) || []).find((a) => a.title === 'Berita uji tautan') || null;
  });
  check('news external link persisted', !!(newsStored && newsStored.link_url === 'https://example.org/pengumuman'), newsStored && newsStored.link_url);
  const newsCard = await admin.$eval('#news-grid', (el) => el.textContent);
  check('news card shows the link chip', /example\.org/.test(newsCard), newsCard.slice(0, 160));
  await shot(admin, 'f26-admin-news-link');

  // cleanup — idempotent, so a previously aborted run cannot leak fixtures
  const cleanup = await admin.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
    const TITLES = [/^Uji lampiran dan tautan$/, /^Berita uji tautan$/];
    const sweep = async (url) => {
      const r = await fetch(url, { headers: h }).then((x) => x.json());
      let n = 0;
      for (const it of ((r.data && r.data.items) || [])) {
        if (TITLES.some((re) => re.test(it.title))) {
          await fetch(url + '/' + it.id, { method: 'DELETE', headers: h });
          n++;
        }
      }
      return n;
    };
    const removed = (await sweep('/api/admin/announcements')) + (await sweep('/api/admin/news'));
    const a = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
    const n = await fetch('/api/admin/news', { headers: h }).then((x) => x.json());
    const left = [...((a.data && a.data.items) || []), ...((n.data && n.data.items) || [])]
      .filter((it) => TITLES.some((re) => re.test(it.title))).length;
    return { removed, left };
  });
  check('test announcements/news removed', cleanup.left === 0, JSON.stringify(cleanup));
  try { fs.unlinkSync(fixture); } catch (e) { /* ignore */ }

  check('no admin console errors', admin.__errors.length === 0, admin.__errors.slice(0, 4).join(' | '));
  await admin.close();

  /* ================================================================ *
   *  MOBILE — student
   * ================================================================ */
  console.log('\n=== MOBILE: PESERTA DIDIK ===');
  const stu = await newPage(browser, {
    mobile: true,
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  await stu.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });
  await mobileLogin(stu, 'SP1TA7A01');
  await sleep(800);

  // ---- bottom nav: exactly five icons, no Info, no Profil -------------
  const navLabels = await stu.$$eval('.fnb .fnb-item > span:not(.fnb-ico):not(.fnb-badge)', (els) => els.map((e) => e.textContent.trim()));
  check('bottom nav has no Profil tab', !navLabels.includes('Profil'), navLabels.join(','));
  check('bottom nav has no Info tab', !navLabels.includes('Info'), navLabels.join(','));
  check('bottom nav keeps 4 section tabs', navLabels.length === 4, navLabels.join(','));
  check('bottom nav labels are Beranda|Kalender|Riwayat|Jadwal', navLabels.join('|') === 'Beranda|Kalender|Riwayat|Jadwal', navLabels.join('|'));
  const fabCount = (await stu.$$('#m-nav .fnb-fab')).length;
  check('centre FAB is the fifth icon', fabCount === 1, fabCount);
  check('bottom nav has no avatar box', (await stu.$('#m-nav #nav-av')) === null);

  // the profile entry is the avatar box at the top of the profile section
  const av = await stu.$('#m-head #hd-av');
  check('avatar box present in the header', av !== null);
  const avStyle = await stu.$eval('#m-head #hd-av .mhead-av-wrap', (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(el).borderRadius };
  });
  check('header avatar box is rounded and 54px', avStyle.w === 54 && avStyle.h === 54 && avStyle.radius !== '0px', JSON.stringify(avStyle));
  await shot(stu, 'f10-mobile-home-avatar-nav');

  // ---- clicking the avatar opens the profile page ---------------------
  await stu.click('#m-head #hd-av');
  await sleep(1800);
  const profTitle = await stu.$eval('#m-view', (el) => el.textContent);
  check('avatar click opens profile page', /Poin profil/.test(profTitle) && /Statistik saya/.test(profTitle));
  const avActive = await stu.$eval('#m-head #hd-av', (el) => el.classList.contains('is-active'));
  check('avatar box is highlighted on profile', avActive);
  await shot(stu, 'f11-mobile-profile');

  // ---- point rank: own role only, no cross-role tabs -------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('[data-set]')].find((x) => x.dataset.set === 'leaderboard');
    b && b.click();
  });
  await sleep(1000);
  check('point rank has no role tabs', (await stu.$$('.sheet .rank-tabs .rank-tab')).length === 0);
  const rankSub = await stu.$eval('.sheet .sheet-sub', (el) => el.textContent.trim());
  check('point rank is scoped to own role', /Peserta Didik/.test(rankSub) && /peran Anda sendiri/.test(rankSub), rankSub);
  const rankRows2 = await stu.$$eval('.sheet .rank-row-t', (els) => els.map((e) => e.textContent.trim()));
  check('point rank lists rows', rankRows2.length > 0, String(rankRows2.length));
  const rankMe = await stu.$eval('.sheet', (el) => el.textContent);
  check('point rank shows own position', /dari \d+/.test(rankMe), rankMe.slice(0, 120));
  await shot(stu, 'f12-mobile-rank-groups');
  await stu.evaluate(() => {
    const c = document.querySelector('.sheet-scrim');
    if (c) c.click();
  });
  await sleep(600);

  // ---- assigned extracurriculars -------------------------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('[data-set]')].find((x) => x.dataset.set === 'ec');
    b && b.click();
  });
  await sleep(1600);
  const ecSheet = await stu.$eval('.sheet', (el) => el.textContent);
  check('my-extracurricular sheet opens', /Ekstrakurikuler saya/.test(ecSheet));
  const ecItems = await stu.$$('.sheet [data-ec]');
  check('student sees only assigned extracurriculars', ecItems.length >= 1 && ecItems.length <= 3, String(ecItems.length));
  await shot(stu, 'f13-mobile-my-extracurriculars');
  await stu.click('.sheet [data-ec]');
  await sleep(1800);
  const ecDetail = await stu.$eval('.sheet', (el) => el.textContent);
  check('EC detail shows schedules block', /Jadwal kegiatan/.test(ecDetail));
  check('EC detail shows places block', /Tempat kegiatan/.test(ecDetail));
  check('EC detail shows mentors block', /Pembina & pelatih|Pembina &amp; pelatih/.test(ecDetail));
  check('EC detail shows grade peers block', /Anggota kelompok/.test(ecDetail), ecDetail.slice(0, 120));
  await shot(stu, 'f14-mobile-ec-detail');
  await stu.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
  await sleep(500);
  await stu.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
  await sleep(600);

  // ---- academic calendar: role scoped day detail ----------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'calendar');
    b && b.click();
  });
  await sleep(1800);
  check('calendar page renders', await stu.$('.mcal') !== null);
  await stu.evaluate(() => {
    const cells = [...document.querySelectorAll('.mcal-c:not(.out)')];
    (cells[Math.min(9, cells.length - 1)] || cells[0]).click();
  });
  await sleep(1600);
  const dayText = await stu.$eval('.sheet', (el) => el.textContent);
  check('day detail shows class schedule for student', /Jadwal Pelajaran/.test(dayText), dayText.slice(0, 160));
  check('day detail shows EC schedule for student', /Jadwal Ekstrakurikuler/.test(dayText));
  check('day detail shows general info', /Informasi Umum/.test(dayText));
  check('day detail shows role scope note', /ekstrakurikuler yang Anda ikuti/i.test(dayText));
  await shot(stu, 'f15-mobile-day-detail-student');
  await stu.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
  await sleep(500);

  // ---- home shows today's schedule ------------------------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'home');
    b && b.click();
  });
  await sleep(1800);
  const homeText = await stu.$eval('#m-view', (el) => el.textContent);
  check('home shows today schedule card', /Jadwal hari ini/.test(homeText));
  check('home shows assigned extracurricular card', /Ekstrakurikuler saya/.test(homeText));
  await shot(stu, 'f16-mobile-home-schedule');

  // ---- weekly schedule is now its own "Jadwal" tab --------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'schedule');
    b.click();
  });
  await sleep(1800);
  const weekText = await stu.$eval('#m-view', (el) => el.textContent);
  check('Jadwal tab opens the weekly schedule', /Jadwal pelajaran/.test(weekText), weekText.slice(0, 140));
  const jadwalTabs = await stu.$$eval('#wk-tabs .rank-tab', (els) => els.map((e) => e.textContent.trim()));
  check('Jadwal tab shows six day tabs', jadwalTabs.join('|') === 'Sen|Sel|Rab|Kam|Jum|Sab', jadwalTabs.join('|'));
  const jadwalDay = await stu.$eval('#wk-body', (el) => el.textContent);
  check('Jadwal tab names the selected day', /Pelajaran · (Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)/.test(jadwalDay), jadwalDay.replace(/\s+/g, ' ').slice(0, 90));
  // The school day is computed, never hard-coded — this suite runs every day.
  const ID_DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const schoolDow = ID_DOW[new Date(Date.now() + 7 * 3600000).getUTCDay()];
  check('Jadwal tab defaults to today',
    new RegExp('Pelajaran · ' + schoolDow).test(jadwalDay),
    'expected ' + schoolDow + ' — got ' + jadwalDay.replace(/\s+/g, ' ').slice(0, 90));
  check('Jadwal tab shows the extracurricular block', /Ekstrakurikuler/.test(weekText));
  check('Jadwal tab is a page, not a sheet', (await stu.$('.sheet')) === null);
  const jadwalActive = await stu.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'schedule');
    return b.classList.contains('is-active');
  });
  check('Jadwal tab is highlighted', jadwalActive);
  await shot(stu, 'f17-mobile-jadwal-tab');

  // ---- the bell opens Pengumuman & Berita -----------------------------
  await stu.evaluate(() => document.querySelector('#hd-bell').click());
  await sleep(1400);
  const infoText = await stu.$eval('.sheet', (el) => el.textContent);
  check('bell opens the info sheet', /Pengumuman/.test(infoText) && /Berita/.test(infoText), infoText.slice(0, 120));
  const infoRows = await stu.$$('.sheet .mitem');
  check('info sheet lists rows', infoRows.length > 0, String(infoRows.length));
  await shot(stu, 'f17b-mobile-info-sheet');

  // ---- tap a row -> detail page ---------------------------------------
  await stu.evaluate(() => {
    const row = document.querySelector('.sheet [data-ann], .sheet [data-news]');
    if (row) row.click();
  });
  await sleep(1200);
  const sheetsNow = await stu.$$('.sheet');
  const detailText = await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet')];
    return (all[all.length - 1] || {}).textContent || '';
  });
  check('tapping a row opens the detail page', /Detail pengumuman|Detail berita/.test(detailText), detailText.slice(0, 120));
  check('detail page shows the full body', /Diterbitkan/.test(detailText), detailText.slice(-120));
  await shot(stu, 'f17c-mobile-detail-page');
  for (let i = 0; i < sheetsNow.length; i++) {
    await stu.evaluate(() => {
      const c = document.querySelector('.sheet-scrim');
      if (c) c.click();
    });
    await sleep(400);
  }
  await sleep(400);

  // ---- home card -> detail page ---------------------------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'home');
    b.click();
  });
  await sleep(1800);
  await stu.evaluate(() => {
    const row = document.querySelector('#m-view [data-ann], #m-view [data-news]');
    if (row) row.click();
  });
  await sleep(1200);
  const homeDetail = await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet')];
    return (all[all.length - 1] || {}).textContent || '';
  });
  check('home card opens the detail page', /Detail pengumuman|Detail berita/.test(homeDetail), homeDetail.slice(0, 120));
  await stu.evaluate(() => {
    const c = document.querySelector('.sheet-scrim');
    if (c) c.click();
  });
  await sleep(500);

  /* ------------------ member-facing media + date-exact info ----------- */
  console.log('\n=== MOBILE: LAMPIRAN, TAUTAN & INFO SESUAI TANGGAL ===');

  // Admin publishes an announcement dated TODAY with an attachment + link.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const todayIso = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); // Asia/Jakarta
  const tomorrowIso = new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10);
  const admTok = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
  }).then((r) => r.json()).then((j) => j.data.token);
  const AH = { Authorization: 'Bearer ' + admTok, 'Content-Type': 'application/json' };
  const media = await fetch(BASE + '/api/admin/announcements', {
    method: 'POST', headers: AH,
    body: JSON.stringify({
      title: 'Uji tanggal lampiran tautan',
      details: 'Pengumuman ini hanya boleh muncul pada tanggal terbitnya saja, lengkap dengan lampiran dan tautan.',
      date: todayIso, time: '07:30', location: 'Aula Utama', audience: 'Semua',
      attachment: { name: 'poster.png', type: 'image/png', size: 70, data: PNG },
      link_url: 'https://sp1yogyakarta.sch.id/daftar', link_label: 'Form pendaftaran',
    }),
  }).then((r) => r.json());
  const mediaId = media.data && media.data.announcement && media.data.announcement.id;
  check('fixture announcement published for today', !!mediaId, JSON.stringify(media).slice(0, 200));

  // reload so the mobile app refetches everything
  await stu.reload({ waitUntil: 'networkidle2' });
  await sleep(2600);

  // ---- calendar: it must show only on its own date --------------------
  await stu.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'calendar');
    b && b.click();
  });
  await sleep(1800);
  await stu.evaluate((iso) => {
    const c = document.querySelector(`.mcal-c[data-day="${iso}"]`);
    if (c) c.click();
  }, todayIso);
  await sleep(1800);
  const dayOn = await stu.$eval('.sheet', (el) => el.textContent);
  check('dated announcement appears on its own date', /Uji tanggal lampiran tautan/.test(dayOn), dayOn.slice(-200));
  check('its row offers a "read more" affordance', /Baca selengkapnya/.test(dayOn));
  check('its row shows a link chip', /Form pendaftaran/.test(dayOn));
  await shot(stu, 'f18-mobile-day-dated-info');

  // tap the row -> detail page with the attachment and the link
  await stu.evaluate(() => {
    const row = document.querySelector('.sheet [data-media]');
    if (row) row.click();
  });
  await sleep(1400);
  const detOn = await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet')];
    return (all[all.length - 1] || {}).textContent || '';
  });
  check('day row opens the detail page', /Detail pengumuman/.test(detOn), detOn.slice(0, 120));
  const attImg = await stu.$('.sheet .mattach-img');
  check('attachment is previewed inline on mobile', attImg !== null);
  const linkEl = await stu.$eval('.sheet .mlink', (el) => ({ href: el.getAttribute('href'), target: el.getAttribute('target') })).catch(() => null);
  check('external link renders with target=_blank', !!linkEl && linkEl.href === 'https://sp1yogyakarta.sch.id/daftar' && linkEl.target === '_blank', JSON.stringify(linkEl));
  const dlEl = await stu.$('.sheet .mattach-bar a[download]');
  check('attachment has a download action', dlEl !== null);
  await shot(stu, 'f19-mobile-detail-attachment-link');
  await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet-scrim')];
    if (all.length) all[all.length - 1].click();
  });
  await sleep(600);
  await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet-scrim')];
    if (all.length) all[all.length - 1].click();
  });
  await sleep(600);

  // next day must NOT list it. The cell may sit in the following month, so
  // page the calendar forward until it is rendered.
  for (let i = 0; i < 3; i++) {
    const found = await stu.evaluate((iso) => {
      const c = document.querySelector(`.mcal-c[data-day="${iso}"]`);
      if (c) { c.click(); return true; }
      const next = document.getElementById('cal-next');
      if (next) next.click();
      return false;
    }, tomorrowIso);
    await sleep(1500);
    if (found) break;
  }
  const dayOff = await stu.$eval('.sheet', (el) => el.textContent);
  check('the same announcement is absent the next day', !/Uji tanggal lampiran tautan/.test(dayOff), dayOff.slice(-160));
  await shot(stu, 'f20-mobile-day-next-empty');
  await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet-scrim')];
    if (all.length) all[all.length - 1].click();
  });
  await sleep(600);

  // ---- the same detail page is reachable from the bell ----------------
  await stu.evaluate(() => document.querySelector('#hd-bell').click());
  await sleep(1600);
  await stu.evaluate(() => {
    const rows = [...document.querySelectorAll('.sheet [data-ann]')];
    const row = rows.find((r) => /Uji tanggal lampiran tautan/.test(r.textContent));
    if (row) row.click();
  });
  await sleep(1300);
  const bellDet = await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet')];
    return (all[all.length - 1] || {}).textContent || '';
  });
  check('bell -> row -> detail page works', /Detail pengumuman/.test(bellDet) && /poster\.png/.test(bellDet), bellDet.slice(0, 140));
  await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet-scrim')];
    if (all.length) all[all.length - 1].click();
  });
  await sleep(500);
  await stu.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet-scrim')];
    if (all.length) all[all.length - 1].click();
  });
  await sleep(600);

  // cleanup
  if (mediaId) {
    const del = await fetch(BASE + '/api/admin/announcements/' + mediaId, { method: 'DELETE', headers: AH }).then((r) => r.status);
    check('fixture announcement removed', del === 200, String(del));
  }
  // Earlier aborted runs can leave fixtures behind — sweep them all up.
  const stales = await fetch(BASE + '/api/admin/announcements', { headers: AH }).then((r) => r.json())
    .then((j) => ((j.data && j.data.items) || []).filter((a) => /^Uji tanggal lampiran tautan$/.test(a.title)));
  for (const st of stales) await fetch(BASE + '/api/admin/announcements/' + st.id, { method: 'DELETE', headers: AH });
  const leftover = await fetch(BASE + '/api/admin/announcements', { headers: AH }).then((r) => r.json())
    .then((j) => ((j.data && j.data.items) || []).filter((a) => /^Uji tanggal lampiran tautan$/.test(a.title)).length);
  check('no fixture leftovers', leftover === 0, String(leftover));

  check('no student console errors', stu.__errors.length === 0, stu.__errors.slice(0, 4).join(' | '));
  await stu.close();

  /* ================================================================ *
   *  MOBILE — teacher (assigned schedule + EC mentoring)
   * ================================================================ */
  console.log('\n=== MOBILE: GURU ===');
  const tea = await newPage(browser, {
    mobile: true,
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  await tea.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });
  await mobileLogin(tea, 'SP1TAT001');
  await sleep(800);

  await tea.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'calendar');
    b && b.click();
  });
  await sleep(1800);
  await tea.evaluate(() => {
    const cells = [...document.querySelectorAll('.mcal-c:not(.out)')];
    (cells[Math.min(9, cells.length - 1)] || cells[0]).click();
  });
  await sleep(1600);
  const teaDay = await tea.$eval('.sheet', (el) => el.textContent);
  check('teacher day detail shows teaching schedule', /Jadwal Mengajar/.test(teaDay), teaDay.slice(0, 160));
  check('teacher day detail shows EC schedule', /Jadwal Ekstrakurikuler/.test(teaDay));
  await shot(tea, 'f18-mobile-day-detail-teacher');
  await tea.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
  await sleep(500);

  const teaEc = await tea.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + window.MCore.store.data.token };
    const r = await fetch('/api/mobile/extracurriculars', { headers: h }).then((x) => x.json());
    return { n: r.data.items.length, names: r.data.items.map((e) => e.name), coach: r.data.items.map((e) => e.is_coach) };
  });
  check('teacher sees only coached extracurriculars', teaEc.n >= 1 && teaEc.n <= 8 && teaEc.coach.every(Boolean), JSON.stringify(teaEc.names));
  await shot(tea, 'f19-mobile-teacher-home');

  check('no teacher console errors', tea.__errors.length === 0, tea.__errors.slice(0, 4).join(' | '));
  await tea.close();

  /* ================================================================ *
   *  MOBILE — employee (general information only)
   * ================================================================ */
  console.log('\n=== MOBILE: KARYAWAN ===');
  const emp = await newPage(browser, {
    mobile: true,
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  await emp.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });
  await mobileLogin(emp, 'SP1TAE001');
  await sleep(800);

  await emp.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'calendar');
    b && b.click();
  });
  await sleep(1800);
  await emp.evaluate(() => {
    const cells = [...document.querySelectorAll('.mcal-c:not(.out)')];
    (cells[Math.min(9, cells.length - 1)] || cells[0]).click();
  });
  await sleep(1600);
  const empDay = await emp.$eval('.sheet', (el) => el.textContent);
  check('employee sees no class schedule', !/Jadwal Pelajaran|Jadwal Mengajar/.test(empDay), empDay.slice(0, 160));
  check('employee sees general information', /Informasi Umum/.test(empDay));
  await shot(emp, 'f20-mobile-day-detail-employee');
  await emp.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
  await sleep(500);

  await emp.evaluate(() => {
    const b = [...document.querySelectorAll('.fnb-item')].find((x) => x.dataset.nav === 'home');
    b && b.click();
  });
  await sleep(1600);
  const empHome = await emp.$eval('#m-view', (el) => el.textContent);
  check('employee home has no class schedule card', !/Jadwal hari ini|Jadwal mengajar hari ini/.test(empHome));
  await shot(emp, 'f21-mobile-employee-home');

  check('no employee console errors', emp.__errors.length === 0, emp.__errors.slice(0, 4).join(' | '));
  await emp.close();

  /* ================================================================ *
   *  PARENTS — their own account, following only their own children
   * ================================================================ */
  console.log('\n=== ORANG TUA: AKUN & HUBUNGAN ===');
  let madeParentId = '';
  let madeLinkId = '';
  {
    const a = await newPage(browser, { viewport: { width: 1440, height: 950 } });
    await adminLogin(a);
    await sleep(1500);

    const navItems = await a.$$eval('#sidebar-nav .nav-item', (els) => els.map((e) => e.textContent.trim()));
    check('the parent page appears in the sidebar', navItems.some((n) => /Orang Tua/i.test(n)), JSON.stringify(navItems));
    await a.evaluate(() => {
      const n = Array.from(document.querySelectorAll('#sidebar-nav .nav-item')).find((x) => /Orang Tua/i.test(x.textContent));
      n.click();
    });
    await sleep(2200);
    check('the parent page opens', /Orang Tua & Peserta Didik/.test(await a.$eval('.view-title', (e) => e.textContent)));

    /* ---- statistics ------------------------------------------------- */
    const statsText = await a.$eval('#pl-stats', (e) => e.innerText);
    check('the page shows the grade statistics',
      /Siswa Kelas VII/i.test(statsText) && /Siswa Kelas VIII/i.test(statsText)
      && /Siswa Kelas IX/i.test(statsText), statsText.slice(0, 200));
    const statVals = await a.$$eval('#pl-stats .stat-val', (els) => els.map((e) => e.textContent.trim()));
    check('the grade statistics carry a headcount',
      statVals.length >= 4 && statVals.slice(0, 3).every((v) => parseInt(v.replace(/\D/g, ''), 10) > 0),
      JSON.stringify(statVals));
    const parentStatIdx = await a.$$eval('#pl-stats .stat', (els) =>
      els.findIndex((e) => /Orang Tua/i.test(e.textContent)));
    check('the page counts the parents and guardians',
      parentStatIdx >= 0
      && parseInt(statVals[parentStatIdx].replace(/\D/g, ''), 10) >= 3,
      JSON.stringify([parentStatIdx, statVals[parentStatIdx]]));
    check('the page reports coverage of linked students',
      /Belum Terhubung/i.test(statsText), statsText.slice(0, 260));

    /* ---- the table -------------------------------------------------- */
    const linksText = await a.$eval('#pl-list', (e) => e.innerText);
    check('existing links are shown in a table',
      (await a.$$('#pl-list table.data tbody tr[data-id]')).length > 0, linksText.slice(0, 160));
    // The table is paginated, so the whole seeded set is confirmed through the
    // API while the first page is confirmed on screen.
    const seeded = await a.evaluate(async () => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
      const r = await fetch('/api/admin/parent-links?limit=500', { headers: h }).then((x) => x.json());
      return (r.data.items || []).map((l) => l.parent && l.parent.name);
    });
    check('the seeded demo links are present',
      seeded.includes('Siti Rahayu') && seeded.includes('Budi Santoso'), JSON.stringify(seeded.slice(0, 5)));
    check('the table renders a real parent row',
      /Siti Rahayu|Agus Priyanto|Hartono Wijaya|Budi Santoso/.test(linksText), linksText.slice(0, 200));
    check('the table offers a search box', !!(await a.$('#pl-list [data-search]')));
    const filterCount = await a.$$eval('#pl-list [data-toolbar] select[name^="f_"]', (els) => els.length);
    check('the table offers filters', filterCount >= 2, String(filterCount));
    await shot(a, 'f52-admin-parent-links');

    /* ---- search narrows the table ----------------------------------- */
    await a.type('#pl-list [data-search]', 'Siti');
    await sleep(1400);
    const searched = await a.$$eval('#pl-list tbody tr[data-id]', (els) => els.map((e) => e.innerText));
    check('searching narrows the table to the matches',
      searched.length > 0 && searched.every((t) => /Siti/i.test(t)), JSON.stringify(searched.slice(0, 3)));
    await shot(a, 'f52b-admin-parent-search');

    /* ---- the grade filter ------------------------------------------- */
    await a.click('#pl-list [data-search]', { clickCount: 3 });
    await a.keyboard.press('Backspace');
    await sleep(1200);
    await a.select('#pl-list [data-toolbar] select[name="f_grade"]', 'IX');
    await sleep(1400);
    const gradeRows = await a.$$eval('#pl-list tbody tr[data-id]', (els) => els.map((e) => e.innerText));
    check('the grade filter narrows the table',
      gradeRows.every((t) => /IX-/.test(t)), JSON.stringify(gradeRows.slice(0, 3)));
    await a.select('#pl-list [data-toolbar] select[name="f_grade"]', '');
    await sleep(1200);

    /* ---- editing a row ----------------------------------------------- */
    const EDITED = 'Nama Orang Tua Diubah';
    const before = await a.evaluate(async () => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
      const r = await fetch('/api/admin/parent-links?limit=50', { headers: h }).then((x) => x.json());
      const row = (r.data.items || [])[0];
      return { id: row.id, name: row.parent.name, relationship: row.relationship };
    });
    await a.click('#pl-list tbody tr[data-id] [data-pl-edit]');
    await sleep(1200);
    check('the edit dialog opens', !!(await a.$('#pl-e-rel')));
    await a.select('#pl-e-rel', 'Ayah');
    await a.click('#pl-e-name', { clickCount: 3 });
    await a.type('#pl-e-name', EDITED);
    await shot(a, 'f52c-admin-parent-edit');
    await a.evaluate(() => document.querySelector('.modal [data-submit]').click());
    await sleep(2200);
    check('the edit dialog closes after saving', (await a.$('#pl-e-rel')) === null);
    const after = await a.evaluate(async (edited) => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
      const r = await fetch('/api/admin/parent-links?limit=50', { headers: h }).then((x) => x.json());
      return (r.data.items || []).some((l) => l.parent && l.parent.name === edited);
    }, EDITED);
    check('the edited name is persisted', after === true, String(after));
    // restore exactly what was there, so a re-run sees the seeded data again
    await a.evaluate(async (b) => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
      await fetch('/api/admin/parent-links/' + b.id, {
        method: 'PUT', headers: h,
        body: JSON.stringify({ relationship: b.relationship, parent: { name: b.name } }),
      });
    }, before);
    await sleep(1800);
    const restored = await a.evaluate(async (b) => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token };
      const r = await fetch('/api/admin/parent-links?limit=50', { headers: h }).then((x) => x.json());
      const row = (r.data.items || []).find((l) => l.id === b.id);
      return row && row.parent.name === b.name && row.relationship === b.relationship;
    }, before);
    check('the row is restored after the edit', restored === true, String(restored));

    /* ---- create a parent account through the form ---- */
    const stamp = 'UJI' + String(Date.now()).slice(-6);
    await a.evaluate(() => document.getElementById('pl-parent').click());
    await sleep(900);
    await a.type('#pl-n-name', 'Uji Orang Tua');
    await a.type('#pl-n-id', stamp);
    await a.type('#pl-n-phone', '+62 811 000 111');
    await a.evaluate(() => document.querySelector('.modal [data-submit]').click());
    await sleep(2200);
    const stillOpen = await a.$('.modal');
    check('the new-parent form closes after saving', stillOpen === null);

    /* ---- link it to a student ---- */
    await a.evaluate(() => document.getElementById('pl-add').click());
    await sleep(1200);
    const opts = await a.evaluate(() => ({
      parents: Array.from(document.querySelectorAll('#pl-f-parent option')).map((o) => ({ v: o.value, t: o.textContent })),
      students: Array.from(document.querySelectorAll('#pl-f-student option')).map((o) => ({ v: o.value, t: o.textContent })),
    }));
    check('the form offers the parent accounts', opts.parents.some((o) => o.t.includes(stamp)), JSON.stringify(opts.parents.slice(-2)));
    check('the form offers the students', opts.students.length > 5, opts.students.length);

    const pickParent = opts.parents.find((o) => o.t.includes(stamp));
    const pickStudent = opts.students[0];
    await a.select('#pl-f-parent', pickParent.v);
    await a.select('#pl-f-student', pickStudent.v);
    await a.select('#pl-f-rel', 'Wali');
    await a.evaluate(() => document.querySelector('.modal [data-submit]').click());
    await sleep(2400);
    // the table is paginated, so search for the row we just created
    await a.type('#pl-list [data-search]', 'Uji Orang Tua');
    await sleep(1500);
    const afterLink = await a.$eval('#pl-list', (e) => e.innerText);
    check('the new link shows up in the list', afterLink.includes('Uji Orang Tua'), afterLink.slice(0, 200));
    await shot(a, 'f53-admin-parent-linked');

    /* ---- and unlink it again ---- */
    const delBtn = await a.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-pl-del]'));
      for (const b of rows) {
        const row = b.closest('tr[data-id]');
        if (row && row.textContent.includes('Uji Orang Tua')) return b;
      }
      return null;
    });
    const delEl = delBtn.asElement();
    check('the new link offers an unlink button', delEl !== null);
    if (delEl) {
      await delEl.click();
      await sleep(1000);
      // the confirmation dialog
      const confirmBtn = await a.$('.modal [data-submit]');
      check('unlinking asks for confirmation', confirmBtn !== null);
      if (confirmBtn) {
        await confirmBtn.click();
        await sleep(2400);
      }
      const afterDel = await a.$eval('#pl-list', (e) => e.innerText);
      check('the link is gone after unlinking', !afterDel.includes('Uji Orang Tua'), afterDel.slice(0, 160));
    }

    // clear the search so the page is left in a neutral state
    await a.evaluate(() => {
      const el = document.querySelector('#pl-list [data-search]');
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await sleep(1000);

    check('no console errors on the parent manager', a.__errors.length === 0, a.__errors.slice(0, 4).join(' | '));

    // remember the ids so the throwaway account can be deleted through the API
    const admT = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
    }).then((r) => r.json()).then((j) => j.data.token);
    const AHH = { Authorization: 'Bearer ' + admT, 'Content-Type': 'application/json' };
    const found = await fetch(BASE + '/api/admin/users?role=parent&limit=200', { headers: AHH })
      .then((r) => r.json()).then((j) => (j.data.items || []).find((u) => u.id_number === stamp));
    madeParentId = found ? found.id : '';
    const linksLeft = await fetch(BASE + '/api/admin/parent-links', { headers: AHH }).then((r) => r.json());
    const stray = (linksLeft.data.items || []).find((l) => l.parent && l.parent.id_number === stamp);
    madeLinkId = stray ? stray.id : '';
    await a.close();
  }

  console.log('\n=== ORANG TUA: TAMPILAN APLIKASI ===');
  {
    const p = await newPage(browser, {
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    await mobileLogin(p, 'SP1TAP002');
    await sleep(2600);

    check('the parent gets the parent shell', (await p.evaluate(() => !!window.MParent && !!window.MParent.state)) === true);
    const navTxt = await p.$eval('#m-nav', (e) => e.innerText);
    check('bottom nav shows the four parent sections',
      /Beranda/.test(navTxt) && /Sekolah/.test(navTxt) && /Ekskul/.test(navTxt) && /Surat/.test(navTxt),
      navTxt.replace(/\n/g, '|'));
    check('the centre action button is not offered to a parent', (await p.$('#nav-fab')) === null);
    check('there is no floating extracurricular button', (await fabVisible(p)) === false);
    check('the header names the role', /Orang Tua/.test(await p.$eval('#m-head', (e) => e.innerText)),
      (await p.$eval('#m-head', (e) => e.innerText)).replace(/\n/g, '|'));

    const home = await p.$eval('#m-view', (e) => e.innerText);
    check('home shows where the child is right now', /masuk/i.test(home) && /pulang/i.test(home), home.slice(0, 160));
    check('home shows the attendance counters', /hadir/i.test(home) && /terlambat/i.test(home) && /kehadiran/i.test(home), home.slice(0, 200));
    check('home covers school hours and after school',
      /Pelajaran hari ini|Kegiatan setelah sekolah/.test(home), home.slice(0, 300));
    check('home covers letters and information', /Surat & izin/.test(home) && /Informasi sekolah/.test(home));
    await shot(p, 'f50-parent-home');

    /* ---- child switcher ---- */
    const chips = await p.$$('[data-pkid]');
    check('a parent with two children gets a switcher', chips.length === 2, chips.length);
    const first = await p.$eval('.p-today-name', (e) => e.textContent.trim()).catch(() => '');
    if (chips.length > 1) {
      await chips[1].click();
      await sleep(2600);
      const second = await p.$eval('.p-today-name', (e) => e.textContent.trim()).catch(() => '');
      check('switching children loads the other child', !!second && second !== first, first + ' -> ' + second);
    }

    /* ---- the other sections ---- */
    for (const [key, label, needle] of [
      ['pschool', 'school hours', /Tujuh hari terakhir/],
      ['pec', 'extracurricular', /kali hadir/],
      ['pletters', 'letters', /.+/],
      ['pinfo', 'information', /Pengumuman/],
      ['pprofile', 'profile', /Anak yang terhubung/],
    ]) {
      await p.evaluate((k) => window.MParent.go(k), key);
      await sleep(1900);
      const txt = await p.$eval('#m-view', (e) => e.innerText);
      check(`the "${label}" section renders`, needle.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 150));
      await shot(p, 'f51-parent-' + key);
    }

    /* ---- reading an announcement reuses the shared reader ---- */
    await p.evaluate(() => window.MParent.go('pinfo'));
    await sleep(1600);
    await p.evaluate(() => { const c = document.querySelector('[data-popen]'); if (c) c.click(); });
    await sleep(1700);
    const sheetTxt = await p.$eval('.sheet', (e) => e.innerText).catch(() => '');
    check('tapping an item opens its detail', /Detail pengumuman|Detail berita/.test(sheetTxt), sheetTxt.slice(0, 120));

    check('no console errors in the parent app', p.__errors.length === 0, p.__errors.slice(0, 4).join(' | '));
    await p.close();
  }

  {
    // the throwaway account created by the admin test
    const admT = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
    }).then((r) => r.json()).then((j) => j.data.token);
    const AHH = { Authorization: 'Bearer ' + admT, 'Content-Type': 'application/json' };
    if (madeLinkId) await fetch(BASE + '/api/admin/parent-links/' + madeLinkId, { method: 'DELETE', headers: AHH });
    if (madeParentId) {
      const st = await fetch(BASE + '/api/admin/users/' + madeParentId, { method: 'DELETE', headers: AHH }).then((r) => r.status);
      check('the throwaway parent account is removed', st === 200, String(st));
    }
  }

  /* ================================================================ *
   *  LAYOUT AUDIT on the new surfaces
   * ================================================================ */
  /* ================================================================ *
   *  KIOSK — one full-screen rotating QR, no live listing
   * ================================================================ */
  console.log('\n=== KIOSK: SATU QR DINAMIS ===');
  {
    const k = await newPage(browser, { viewport: { width: 1440, height: 900 } });
    await k.goto(BASE + '/kiosk/', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(2600);

    const qrs = await k.$$eval('img[id^="k-qr"], .qr-card img', (els) => els.length);
    check('kiosk renders exactly one QR code', qrs === 1, String(qrs));
    const qrSrc = await k.$eval('#k-qr', (el) => el.getAttribute('src') || '');
    check('the QR is the rotating kiosk credential', /\/api\/public\/kiosk\/qr\.svg/.test(qrSrc), qrSrc);
    const decoded = await k.$eval('#k-qr', (el) => el.naturalWidth > 0);
    check('the QR image decodes', decoded);
    check('no live attendance listing', (await k.$('#s-in')) === null && (await k.$('#k-feed')) === null);
    check('no "cara menggunakan" side panel', (await k.$('.steps')) === null);

    // full screen: the QR fills the middle band and nothing scrolls
    const geom = await k.evaluate(() => {
      const card = document.querySelector('.qr-card').getBoundingClientRect();
      return {
        vw: innerWidth, vh: innerHeight,
        cardW: Math.round(card.width), cardH: Math.round(card.height),
        scrollX: document.documentElement.scrollWidth > innerWidth + 1,
        scrollY: document.documentElement.scrollHeight > innerHeight + 1,
      };
    });
    check('kiosk is full screen (no scrolling)', !geom.scrollX && !geom.scrollY, JSON.stringify(geom));
    check('the QR is large', geom.cardW >= 260 && geom.cardH >= 260, JSON.stringify(geom));
    check('the QR fits the viewport height', geom.cardH <= geom.vh, JSON.stringify(geom));

    // rotation countdown + the token really rotating
    const rot1 = await k.$eval('#k-rot-t', (el) => el.textContent.trim());
    check('rotation countdown is shown', /Kode berganti dalam \d+ dtk/.test(rot1), rot1);
    const tk1 = await fetch(BASE + '/api/public/kiosk/token').then((r) => r.json()).then((j) => j.data);
    check('token advertises a 60s rotation', tk1.rotate_seconds === 60 && tk1.ttl <= 60, JSON.stringify({ r: tk1.rotate_seconds, ttl: tk1.ttl }));
    check('token carries the school location and radius',
      typeof tk1.location.lat === 'number' && tk1.radius > 0, JSON.stringify(tk1.location) + ' r=' + tk1.radius);
    await shot(k, 'f30-kiosk-single-qr');

    /* ---- the failure screen must never stick ------------------------ */
    const fatal0 = await k.evaluate(() => !document.getElementById('k-fatal').hidden);
    check('kiosk shows no failure screen while the server answers', fatal0 === false);
    check('kiosk stage is not blurred', (await k.$eval('#stage', (el) => el.style.filter)) === '');
    check('kiosk renders the school name and radius',
      (await k.$eval('#k-name', (el) => el.textContent.trim())).length > 3
      && /\d+\s*m/.test(await k.$eval('#k-radius', (el) => el.textContent.trim())),
      await k.$eval('#k-name', (el) => el.textContent.trim()));

    check('no kiosk console errors', k.__errors.length === 0, k.__errors.slice(0, 4).join(' | '));

    // Simulate an outage, then confirm the screen heals itself. Errors logged
    // during the deliberate offline window are not real failures.
    const errsBeforeOutage = k.__errors.length;
    await k.setOfflineMode(true);
    await sleep(6500);
    const fatal1 = await k.evaluate(() => !document.getElementById('k-fatal').hidden);
    check('kiosk reports the outage after repeated misses', fatal1 === true);
    await k.setOfflineMode(false);
    let healed = false;
    for (let i = 0; i < 30 && !healed; i++) {
      healed = await k.evaluate(() => document.getElementById('k-fatal').hidden
        && document.getElementById('stage').style.filter === '');
      if (!healed) await sleep(600);
    }
    check('kiosk clears the failure screen once the server is back', healed === true);
    const strayErrs = k.__errors.slice(errsBeforeOutage)
      .filter((e) => !/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|kiosk\/token/.test(e));
    check('no kiosk console errors outside the simulated outage', strayErrs.length === 0,
      strayErrs.slice(0, 4).join(' | '));
    await k.close();
  }

  /* ================================================================ *
   *  MOBILE — kiosk scan, EC floating QR, live selfie, rank format
   * ================================================================ */
  console.log('\n=== MOBILE: SCAN KIOSK · SELFIE LIVE · FORMAT PERINGKAT ===');
  {
    const p = await newPage(browser, {
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    await p.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });

    // Guarantee an extracurricular session today so the floating button and
    // the live-selfie flow can be exercised deterministically.
    const admTok2 = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
    }).then((r) => r.json()).then((j) => j.data.token);
    const AH2 = { Authorization: 'Bearer ' + admTok2, 'Content-Type': 'application/json' };
    const ID_DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dowName = ID_DOW[new Date(Date.now() + 7 * 3600000).getUTCDay()];
    const stud = await fetch(BASE + '/api/admin/users?q=SP1TA7A01&role=student&limit=5', { headers: AH2 })
      .then((r) => r.json()).then((j) => (j.data.items || [])[0]);
    const ecAssigned = stud
      ? await fetch(BASE + '/api/admin/users/' + stud.id + '/extracurriculars', { headers: AH2 }).then((r) => r.json())
      : { data: { items: [] } };
    const ecId = ((ecAssigned.data && ecAssigned.data.items) || [])[0];
    let tempSchedule = null;
    if (ecId && dowName !== 'Minggu') {
      const res = await fetch(BASE + '/api/admin/ec-schedules', {
        method: 'POST', headers: AH2,
        body: JSON.stringify({ extracurricular_id: ecId.id, day: dowName, start_time: '15:00', end_time: '16:30' }),
      }).then((r) => r.json());
      tempSchedule = res.data && res.data.schedule ? res.data.schedule.id : null;
    }
    check('an extracurricular session exists for today', !!tempSchedule, JSON.stringify({ dow: dowName, ec: ecId && ecId.name }));

    await mobileLogin(p, 'SP1TA7A01');
    await sleep(1500);

    // ---- the 3-D button opens the kiosk scanner --------------------
    const cio = await p.$('#cio-btn');
    const disabled = cio ? await p.$eval('#cio-btn', (el) => el.disabled) : true;
    if (cio && !disabled) {
      await p.click('#cio-btn');
      await sleep(1800);
      const scanText = await p.$eval('.sheet', (el) => el.textContent);
      check('home button opens the kiosk QR scanner', /Pindai QR kiosk/.test(scanText), scanText.slice(0, 140));
      check('scanner explains the rotating code', /berganti setiap\s*60 detik/.test(scanText), scanText.slice(-160));
      const hasVideo = await p.$('.sheet video');
      check('scanner starts the camera', hasVideo !== null);
      check('scanner has NO school-code field', (await p.$('#ks-code')) === null);
      check('scanner says only the kiosk QR is accepted', /Hanya kode QR kiosk yang diterima/.test(scanText));
      const stateT = await p.$eval('#ks-state-t', (el) => el.textContent.trim());
      check('scanner reports the connection state', /Koneksi (lancar|lambat)/.test(stateT), stateT);
      await shot(p, 'f31-mobile-kiosk-scanner');
      await p.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
      await sleep(800);
    } else {
      console.log('    (student already finished today — scanner sheet section skipped)');
    }

    // ---- point rank: "10 Point (173 / 175)" -------------------------
    await p.evaluate(() => document.querySelector('#m-head #hd-av').click());
    await sleep(1900);
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('[data-set]')].find((x) => x.dataset.set === 'leaderboard');
      b && b.click();
    });
    await sleep(1200);
    const rankLabels = await p.$$eval('.sheet .rank-row-p', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    check('rank rows use the points (rank / total) form',
      rankLabels.length > 0 && rankLabels.every((t) => /^[\d.]+ Point \(\d+ \/ \d+\)$/.test(t)),
      rankLabels.slice(0, 3).join(' | '));
    const rankInline = await p.$eval('.sheet .rank-inline, .sheet .badge', (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    check('own position uses the same form', /Point \(\d+ \/ \d+\)/.test(rankInline), rankInline);
    check('rank rows no longer show the level name', !/Pemula|Mahir|Ahli/.test(rankLabels.join(' ')), rankLabels.slice(0, 3).join(' | '));
    await shot(p, 'f32-mobile-rank-format');
    await p.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
    await sleep(700);

    // ---- floating QR: extracurricular only -------------------------
    const fab = await p.evaluate(() => {
      const f = document.getElementById('m-fab');
      return f ? { hidden: f.hidden, ec: f.classList.contains('is-ec'), label: f.getAttribute('aria-label') || '' } : null;
    });
    const ecToday = await p.evaluate(async () => {
      const r = await fetch('/api/mobile/me', { headers: { Authorization: 'Bearer ' + window.MCore.store.data.token } });
      return ((await r.json()).data || {}).ec_today || [];
    });
    check('today\'s extracurricular sessions are exposed to the app', ecToday.length > 0, JSON.stringify(ecToday));
    check('floating button is shown because an extracurricular meets today',
      fab && fab.hidden === false && fab.ec === true, JSON.stringify(fab));
    check('floating button is really on screen when a session meets', (await fabVisible(p)) === true);
    if (ecToday.length && fab && !fab.hidden) {
      check('floating button is labelled for extracurricular', /ekstrakurikuler/i.test(fab.label), fab.label);
      await p.click('#m-fab');
      await sleep(1200);
      const ecText = await p.$eval('.sheet', (el) => el.textContent);
      check('floating QR opens extracurricular attendance', /GPS Lock|Foto selfie|Pilih kegiatan/.test(ecText), ecText.slice(0, 140));

      // ---- live selfie: camera only, face frame, no gallery ---------
      let selfieBtn = await p.$('#ec-shot');
      if (!selfieBtn) {
        // More than one activity meets today, so the floating button opens a
        // picker first — choose the first one to reach the attendance sheet.
        const first = await p.$('.sheet [data-ec]');
        if (first) { await first.click(); await sleep(1700); selfieBtn = await p.$('#ec-shot'); }
      }
      check('EC sheet offers the selfie capture', selfieBtn !== null);
      if (selfieBtn) {
        await selfieBtn.click();
        await sleep(1800);
        const camText = await p.evaluate(() => {
          const all = [...document.querySelectorAll('.sheet')];
          return (all[all.length - 1] || {}).textContent || '';
        });
        check('live selfie sheet opens', /Ambil selfie/.test(camText), camText.slice(0, 100));
        const frame = await p.$('.selfie-frame ellipse');
        check('a face outline guide is drawn', frame !== null);
        const video = await p.$('.selfie-cam video');
        check('selfie uses the live camera stream', video !== null);
        const fileInputs = await p.$$eval('.sheet input[type="file"]', (els) => els.length);
        check('no gallery file input is offered', fileInputs === 0, String(fileInputs));
        check('EC selfie is marked mandatory', /Wajib/.test((await p.$eval('.sheet', (el) => el.textContent))));
        await shot(p, 'f33-mobile-live-selfie');
        // take the picture
        await p.evaluate(() => {
          const all = [...document.querySelectorAll('.sheet')];
          const last = all[all.length - 1];
          const b = last && last.querySelector('#sf-shoot');
          if (b) b.click();
        });
        await sleep(1200);
        const shotOk = await p.evaluate(() => {
          const all = [...document.querySelectorAll('.sheet')];
          const last = all[all.length - 1];
          const img = last && last.querySelector('#sf-prev img');
          return img ? (img.getAttribute('src') || '').slice(0, 22) : '';
        });
        check('capturing produces a JPEG data URL from the camera', shotOk.startsWith('data:image/jpeg;base64'), shotOk);
        await shot(p, 'f34-mobile-selfie-captured');
        // close both sheets
        for (let i = 0; i < 3; i++) {
          await p.evaluate(() => {
            const cs = [...document.querySelectorAll('.sheet-scrim')];
            if (cs.length) cs[cs.length - 1].click();
          });
          await sleep(600);
        }
      }
    }
    check('no console errors on the scan/selfie run', p.__errors.length === 0, p.__errors.slice(0, 4).join(' | '));
    await p.close();

    if (tempSchedule) {
      const del = await fetch(BASE + '/api/admin/ec-schedules/' + tempSchedule, { method: 'DELETE', headers: AH2 }).then((r) => r.status);
      check('temporary extracurricular session removed', del === 200, String(del));
    }
  }

  /* ================================================================ *
   *  KIOSK SCAN — auto on a fast link, "Proses Absen" on a slow one
   * ================================================================ */
  console.log('\n=== MOBILE: AUTO vs MANUAL (KONEKSI) ===');
  {
    // A member who has not recorded anything today, so both directions run.
    const admTok3 = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
    }).then((r) => r.json()).then((j) => j.data.token);
    const AH3 = { Authorization: 'Bearer ' + admTok3, 'Content-Type': 'application/json' };
    const srvDay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const allStu = await fetch(BASE + '/api/admin/users?role=student&limit=200', { headers: AH3 })
      .then((r) => r.json()).then((j) => j.data.items || []);
    const todayRows = await fetch(BASE + '/api/admin/attendance?from=' + srvDay + '&to=' + srvDay + '&limit=200', { headers: AH3 })
      .then((r) => r.json()).then((j) => j.data.items || []);
    const busyIds = new Set(todayRows.map((a) => a.user_id));
    const freshStu = allStu.find((u) => !busyIds.has(u.id));
    check('found a student with a clean slate today', !!freshStu, freshStu && freshStu.id_number);

    const q = await newPage(browser, {
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    // Record every scan-attend exchange so a failure can be read straight off
    // the log instead of guessed at.
    const scans = [];
    q.on('response', async (r) => {
      if (!r.url().includes('/api/public/scan-attend')) return;
      let body = '';
      try { body = await r.text(); } catch (e) { body = '(unreadable)'; }
      scans.push({ status: r.status(), at: Date.now(), body: body.slice(0, 200) });
    });
    await q.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });
    await mobileLogin(q, freshStu.id_number);
    await sleep(1500);

    /** Install a stubbed BarcodeDetector that decodes the given raw value. */
    const armScanner = (raw, conn) => q.evaluate((r, c) => {
      window.__FAKE_QR__ = r;
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['qr_code']; }
        async detect() { return window.__FAKE_QR__ ? [{ rawValue: window.__FAKE_QR__ }] : []; }
      };
      if (c) Object.defineProperty(navigator, 'connection', { get: () => c, configurable: true });
    }, raw, conn);

    const kioskTokenNow = () => fetch(BASE + '/api/public/kiosk/token')
      .then((r) => r.json()).then((j) => j.data.token);

    /** The splash element stays in the DOM once closed — check it is on screen. */
    const splashOn = () => q.evaluate(() => {
      const el = document.getElementById('m-splash');
      if (!el) return false;
      return el.style.display !== 'none' && !el.classList.contains('is-out') && el.getBoundingClientRect().height > 0;
    });
    /** The splash auto-closes after ~4 s, so poll for it instead of sleeping. */
    const waitSplash = async (ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await splashOn()) return true;
        await sleep(250);
      }
      return false;
    };

    /* ---------------- 1. fast link → auto check-in ---------------- */
    await armScanner(null, { effectiveType: '4g' });
    await q.click('#cio-btn');
    await sleep(1800);
    const state1 = await q.$eval('#ks-state-t', (el) => el.textContent.trim()).catch(() => '');
    check('fast link reports "Koneksi lancar"', /Koneksi lancar/.test(state1), state1);
    const goHidden1 = await q.$eval('#ks-go', (el) => el.classList.contains('hidden')).catch(() => null);
    check('fast link hides the manual button', goHidden1 === true, String(goHidden1));
    // now present a code: it must go through on its own
    await armScanner(await kioskTokenNow(), { effectiveType: '4g' });
    const splash1 = await waitSplash(12000);
    check('the decoded code auto-records the check-in', splash1 === true);
    await shot(q, 'f40-mobile-auto-scan');
    if (splash1) { await q.click('#m-splash').catch(() => {}); await sleep(1000); }

    const rec1 = await fetch(BASE + '/api/admin/attendance?from=' + srvDay + '&to=' + srvDay + '&limit=200', { headers: AH3 })
      .then((r) => r.json()).then((j) => (j.data.items || []).find((a) => a.user_id === freshStu.id));
    check('the check-in is stored with the QR method', !!(rec1 && rec1.check_in_at && rec1.check_in_method === 'qr'),
      rec1 && rec1.check_in_method);
    check('the check-in is geofenced', !!(rec1 && rec1.check_in_dist < 30), rec1 && rec1.check_in_dist);

    /* ---------------- 2. slow link → manual "Proses Absen" --------- */
    await q.evaluate(() => { window.__FAKE_QR__ = null; });
    await armScanner(null, { effectiveType: '2g' });
    await q.click('#cio-btn');
    await sleep(2000);
    const state2 = await q.$eval('#ks-state-t', (el) => el.textContent.trim()).catch(() => '');
    check('slow link reports "Koneksi lambat"', /Koneksi lambat/.test(state2), state2);
    await armScanner(await kioskTokenNow(), { effectiveType: '2g' });
    await sleep(3000);
    const splash2 = await splashOn();
    check('slow link does NOT auto-submit', splash2 === false);
    const goVisible = await q.$eval('#ks-go', (el) => !el.classList.contains('hidden') && !el.disabled).catch(() => false);
    check('slow link reveals the "Proses Absen" button', goVisible === true, String(goVisible));
    const heldState = await q.$eval('#ks-state-t', (el) => el.textContent.trim()).catch(() => '');
    check('the decoded code is held with a countdown', /Kode terbaca.*Proses Absen/.test(heldState), heldState);
    await shot(q, 'f41-mobile-slow-manual');

    console.log('    (countdown at click time: ' + heldState + ')');
    await q.click('#ks-go');
    const splash3 = await waitSplash(12000);
    check('pressing "Proses Absen" records the check-out', splash3 === true,
      splash3 ? '' : JSON.stringify(scans));
    if (splash3) { await q.click('#m-splash').catch(() => {}); await sleep(900); }

    const rec2 = await fetch(BASE + '/api/admin/attendance?from=' + srvDay + '&to=' + srvDay + '&limit=200', { headers: AH3 })
      .then((r) => r.json()).then((j) => (j.data.items || []).find((a) => a.user_id === freshStu.id));
    check('the check-out is stored', !!(rec2 && rec2.check_out_at), rec2 && rec2.check_out_at);
    check('one code served both directions', !!(rec1 && rec2 && rec1.id === rec2.id), rec1 && rec2 && rec1.id === rec2.id);

    check('no console errors on the auto/manual run', q.__errors.length === 0, q.__errors.slice(0, 4).join(' | '));
    await q.close();
  }

  /* ================================================================ *
   *  KIOSK SCANNER — only the QR, never a GPS-only check-in
   * ================================================================ */
  console.log('\n=== MOBILE: PEMINDAI KIOSK — HANYA QR ===');
  {
    const admTok4 = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
    }).then((r) => r.json()).then((j) => j.data.token);
    const AH4 = { Authorization: 'Bearer ' + admTok4, 'Content-Type': 'application/json' };
    const day4 = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const stu4 = await fetch(BASE + '/api/admin/users?role=student&limit=300', { headers: AH4 })
      .then((r) => r.json()).then((j) => j.data.items || []);
    const rows4 = await fetch(BASE + '/api/admin/attendance?from=' + day4 + '&to=' + day4 + '&limit=300', { headers: AH4 })
      .then((r) => r.json()).then((j) => j.data.items || []);
    const busy4 = new Set(rows4.map((a) => a.user_id));
    // On some weekdays nearly every student has a session, so rather than hunt
    // for a member without one, create a throwaway student: no memberships, no
    // attendance record, deleted again at the end of the block.
    const stamp = 'UJI' + String(Date.now()).slice(-6);
    const made = await fetch(BASE + '/api/admin/users', {
      method: 'POST', headers: AH4,
      body: JSON.stringify({
        name: 'Uji Pemindai ' + stamp, id_number: stamp, role: 'student',
        password: 'demo123', class_name: 'X-A', status: 'active',
      }),
    }).then((r) => r.json());
    const subject = made.data && made.data.user;
    check('a throwaway member with no extracurricular was created', !!subject, JSON.stringify(made).slice(0, 160));

    /* ---- the floating button must be OFF SCREEN without a session ---- */
    const q = await newPage(browser, {
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    await q.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });
    await mobileLogin(q, subject.id_number);
    await sleep(1800);
    const noEcToday = await q.evaluate(async () => {
      const r = await fetch('/api/mobile/me', { headers: { Authorization: 'Bearer ' + window.MCore.store.data.token } });
      return ((await r.json()).data || {}).ec_today || [];
    });
    check('the member has no extracurricular session today', noEcToday.length === 0, JSON.stringify(noEcToday));
    const fabOn = await fabVisible(q);
    const fabAttr = await q.evaluate(() => { const f = document.getElementById('m-fab'); return f ? f.hidden : null; });
    check('floating button is hidden (attribute) with no session', fabAttr === true, String(fabAttr));
    check('floating button is hidden ON SCREEN with no session', fabOn === false,
      'display=' + await q.evaluate(() => { const f = document.getElementById('m-fab'); return f ? getComputedStyle(f).display : null; }));
    await shot(q, 'f42-mobile-no-fab');

    /* ---- a foreign barcode must never send an attendance ---- */
    await FAKE_CAMERA(q, PAINT_TEXT('HELLO123'));
    const sent = [];
    q.on('request', (r) => { if (r.url().includes('/api/public/scan-attend')) sent.push(1); });
    check('the member can still scan today (button enabled)',
      (await q.$eval('#cio-btn', (el) => el.disabled)) === false);
    await q.click('#cio-btn');
    await sleep(1500);
    check('the 3-D button opens the scanner without recording anything', (await q.$('.sheet')) !== null);
    await sleep(6000);
    check('a foreign barcode never sends an attendance', sent.length === 0, sent.length + ' calls');
    check('the scanner stays open after a foreign barcode', (await q.$('.sheet')) !== null);
    await shot(q, 'f43-mobile-foreign-qr');

    /* ---- the bundled decoder works when BarcodeDetector is missing ---- */
    await q.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
    await sleep(900);
    await q.evaluate(() => { Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true }); });
    await FAKE_CAMERA(q, PAINT_QR);
    sent.length = 0;
    await q.click('#cio-btn');
    await sleep(1500);
    const engine = await q.evaluate(() => ({ BD: typeof window.BarcodeDetector, jsQR: typeof window.jsQR }));
    check('the bundled QR decoder is loaded when BarcodeDetector is missing',
      engine.jsQR === 'function', JSON.stringify(engine));
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = sent.length > 0; if (!ok) await sleep(400); }
    check('the kiosk QR is decoded without BarcodeDetector', ok, sent.length + ' calls');
    const rec4 = await fetch(BASE + '/api/admin/attendance?from=' + day4 + '&to=' + day4 + '&limit=300', { headers: AH4 })
      .then((r) => r.json()).then((j) => (j.data.items || []).find((a) => a.user_id === subject.id));
    check('that scan is stored as a QR check-in', !!(rec4 && rec4.check_in_at && rec4.check_in_method === 'qr'),
      rec4 && rec4.check_in_method);
    check('no console errors in the scanner run', q.__errors.length === 0, q.__errors.slice(0, 4).join(' | '));
    await q.close();

    // remove the throwaway member again
    if (subject) {
      const gone = await fetch(BASE + '/api/admin/users/' + subject.id, { method: 'DELETE', headers: AH4 }).then((r) => r.status);
      check('the throwaway member is removed', gone === 200, String(gone));
    }
  }

  /* ================================================================ *
   *  PDF attachment — the usual case for a circular letter
   * ================================================================ */
  console.log('\n=== ADMIN + MOBILE: LAMPIRAN PDF ===');
  {
    const pdfPath = path.join(SHOTS, '.uji-surat-edaran.pdf');
    // A minimal one-page PDF we can hand to the uploader.
    const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 14 Tf 20 120 Td (Surat Edaran Uji) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
    fs.writeFileSync(pdfPath, Buffer.from(pdf, 'latin1'));

    const a = await newPage(browser);
    await adminLogin(a);
    await a.evaluate(() => { location.hash = '#/announcements'; });
    await sleep(1800);
    await a.click('#ann-add');
    await sleep(700);
    const pickLabel = await a.$eval('[data-att="pick"]', (el) => el.textContent.trim());
    check('the picker is labelled for PDF', /PDF/.test(pickLabel), pickLabel);
    await a.click('.modal [name="title"]', { clickCount: 3 });
    await a.type('.modal [name="title"]', 'Surat edaran uji PDF');
    await a.click('.modal [name="details"]', { clickCount: 3 });
    await a.type('.modal [name="details"]', 'Surat edaran resmi yang dilampirkan dalam bentuk PDF.');
    const fi = await a.$('.modal input[type="file"]');
    check('file input accepts PDF', fi !== null);
    if (fi) await fi.uploadFile(pdfPath);
    await sleep(900);
    const box = await a.$eval('#att-box', (el) => el.textContent);
    check('the PDF is shown in the picker', /uji-surat-edaran\.pdf/.test(box), box.replace(/\s+/g, ' ').slice(0, 90));
    await shot(a, 'f35-admin-pdf-picker');
    await a.click('.modal [data-submit]');
    await sleep(2000);

    const stored = await a.evaluate(async () => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
      const r = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
      return ((r.data && r.data.items) || []).find((x) => x.title === 'Surat edaran uji PDF') || null;
    });
    check('the PDF attachment persisted', !!(stored && stored.attachment && /^data:application\/pdf/.test(stored.attachment.data)),
      stored && stored.attachment && stored.attachment.type);
    const chipCls = await a.evaluate(() => {
      const card = [...document.querySelectorAll('#ann-grid .card')].find((c) => /Surat edaran uji PDF/.test(c.textContent));
      const chip = card && card.querySelector('.chip');
      return chip ? chip.className : '';
    });
    check('the card shows a PDF chip', /chip-pdf/.test(chipCls), chipCls);

    const viewH = await a.evaluateHandle(() => {
      const card = [...document.querySelectorAll('#ann-grid .card')].find((c) => /Surat edaran uji PDF/.test(c.textContent));
      return card ? card.querySelector('[data-view]') : null;
    });
    if (viewH && viewH.asElement()) {
      await viewH.asElement().click();
      await sleep(900);
      const frame = await a.$('.modal .att-pdf-frame');
      check('the detail page embeds a PDF reader', frame !== null);
      const src = frame ? await a.$eval('.modal .att-pdf-frame', (el) => el.getAttribute('src') || '') : '';
      check('the reader points at the PDF data', src.startsWith('data:application/pdf'), src.slice(0, 32));
      await shot(a, 'f36-admin-pdf-reader');
      await a.click('.modal .modal-close');
      await sleep(500);
    }
    await shot(a, 'f37-admin-pdf-card');

    // ---- the member sees the same PDF reader -----------------------
    const m = await newPage(browser, {
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    await m.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });
    await mobileLogin(m, 'SP1TA7A01');
    await sleep(1200);
    await m.evaluate(() => document.querySelector('#hd-bell').click());
    await sleep(1600);
    await m.evaluate(() => {
      const row = [...document.querySelectorAll('.sheet [data-ann]')].find((r) => /Surat edaran uji PDF/.test(r.textContent));
      if (row) row.click();
    });
    await sleep(1400);
    const mPdf = await m.$('.sheet .mpdf-frame');
    check('mobile detail page embeds the PDF reader', mPdf !== null);
    const mSrc = mPdf ? await m.$eval('.sheet .mpdf-frame', (el) => el.getAttribute('src') || '') : '';
    check('mobile reader points at the PDF data', mSrc.startsWith('data:application/pdf'), mSrc.slice(0, 32));
    const mChip = await m.$eval('.sheet', (el) => el.textContent);
    check('mobile detail names the PDF file', /uji-surat-edaran\.pdf/.test(mChip), mChip.slice(0, 160));
    await shot(m, 'f38-mobile-pdf-reader');
    await m.close();

    // cleanup
    const left = await a.evaluate(async () => {
      const h = { Authorization: 'Bearer ' + window.Core.store.data.token, 'Content-Type': 'application/json' };
      const r = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
      for (const it of ((r.data && r.data.items) || [])) {
        if (/^Surat edaran uji PDF$/.test(it.title)) await fetch('/api/admin/announcements/' + it.id, { method: 'DELETE', headers: h });
      }
      const r2 = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
      return ((r2.data && r2.data.items) || []).filter((x) => /^Surat edaran uji PDF$/.test(x.title)).length;
    });
    check('PDF fixture removed', left === 0, String(left));
    check('no console errors in the PDF run', a.__errors.length === 0, a.__errors.slice(0, 4).join(' | '));
    await a.close();
    try { fs.unlinkSync(pdfPath); } catch (e) { /* ignore */ }
  }

  console.log('\n=== LAYOUT AUDIT ===');
  const audit = await newPage(browser);
  await adminLogin(audit);
  for (const r of ['classSchedules', 'extracurriculars']) {
    await audit.evaluate((k) => { location.hash = '#/' + k; }, r);
    await sleep(1600);
    for (const w of [1440, 900]) {
      await audit.setViewport({ width: w, height: 900 });
      await sleep(600);
      const overflow = await audit.evaluate(() => {
        const bad = [];
        const docW = document.documentElement.clientWidth;
        document.querySelectorAll('#view *').forEach((el) => {
          const r2 = el.getBoundingClientRect();
          if (r2.width === 0) return;
          let p = el;
          let fixed = false;
          while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            if (cs.position === 'fixed' || cs.transform !== 'none' || cs.overflowX !== 'visible') { fixed = true; break; }
            p = p.parentElement;
          }
          if (fixed) return;
          if (r2.right > docW + 2 || r2.left < -2) bad.push(el.className || el.tagName);
        });
        return bad.slice(0, 5);
      });
      check(`no horizontal overflow on ${r} @${w}px`, overflow.length === 0, overflow.join(' | '));
    }
  }
  await audit.close();

  await browser.close();

  console.log('\n────────────────────────────────────────');
  console.log(`  ${pass} passed, ${problems.length} problems`);
  if (problems.length) {
    console.log('\nProblems:');
    problems.forEach((p) => console.log('  • ' + p));
    process.exit(1);
  }
  console.log('  ALL GREEN');
})().catch((err) => { console.error(err); process.exit(1); });
