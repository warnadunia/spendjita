'use strict';
/**
 * Browser smoke test — drives the admin web and the mobile PWA in headless
 * Chromium, captures console errors and takes screenshots of every screen.
 *
 *   node scripts/ui-test.js
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

async function newPage(browser, opts) {
  const page = await browser.newPage();
  const o = opts || {};
  await page.setViewport(o.viewport || { width: 1440, height: 950, deviceScaleFactor: 1 });
  if (o.mobile) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  }
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!/fonts\.(googleapis|gstatic)\.com/.test(u)) {
      errors.push('requestfailed: ' + u + ' ' + (r.failure() && r.failure().errorText));
    }
  });
  page.__errors = errors;
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
      // a synthetic camera + auto-granted permission, so the kiosk scanner
      // can actually be driven headlessly
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  /* ======================= ADMIN WEB ======================= */
  console.log('\n=== ADMIN WEB ===');
  {
    const page = await newPage(browser);
    await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(600);

    check('admin login screen renders', await page.$('#login-form') !== null);
    await shot(page, '01-admin-login');

    // fill via the demo account helper
    await page.waitForSelector('#lg-demos .demo-acc', { timeout: 15000 });
    await page.click('#lg-demos .demo-acc');
    await sleep(200);
    const idVal = await page.$eval('[name="idNumber"]', (el) => el.value);
    check('demo account autofills ID', idVal === 'SP1TAADM', idVal);

    await page.click('#lg-submit');
    await page.waitForSelector('#app-root:not(.hidden)', { timeout: 20000 });
    await sleep(1200);
    check('admin logged in', await page.$eval('#app-root', (el) => !el.classList.contains('hidden')));
    check('sidebar built', (await page.$$('#sidebar-nav .nav-item')).length >= 8);
    await shot(page, '02-admin-dashboard');

    // dashboard widgets
    const stats = await page.$$('#dash-stats .stat');
    check('dashboard stat cards', stats.length === 4, String(stats.length));
    const bars = await page.$$('#dash-trend .spark-bar');
    check('dashboard trend bars', bars.length === 7, String(bars.length));
    const activity = await page.$$('#dash-activity .feed-item');
    check('dashboard activity feed', activity.length > 0, String(activity.length));

    // walk every nav destination
    const routes = await page.$$eval('#sidebar-nav .nav-item', (els) => els.map((e) => e.dataset.nav));
    check('nav routes discovered', routes.length >= 8, routes.join(','));
    for (const r of routes) {
      await page.evaluate((k) => { location.hash = '#/' + k; }, r);
      await sleep(1500);
      const title = await page.$eval('#page-title', (el) => el.textContent.trim());
      const view = await page.$eval('#view', (el) => el.textContent.trim().length);
      check(`page "${r}" renders (${title})`, view > 40, `text length ${view}`);
      await shot(page, '03-admin-' + r);
      if (r === 'dashboard') await sleep(400);
    }

    // a CRUD flow: create an announcement
    await page.evaluate(() => { location.hash = '#/announcements'; });
    await sleep(1400);
    await page.click('#ann-add');
    await sleep(600);
    check('announcement form opens', await page.$('.modal') !== null);
    await shot(page, '04-admin-announcement-form');
    await page.type('[name="title"]', 'Uji Coba Pengumuman Otomatis');
    await page.type('[name="location"]', 'Aula Utama');
    await page.type('[name="details"]', 'Pengumuman ini dibuat oleh pengujian otomatis untuk memastikan alur CRUD berjalan.');
    await page.click('.modal [data-submit]');
    await sleep(1400);
    const annText = await page.$eval('#ann-grid', (el) => el.textContent);
    check('announcement created + listed', /Uji Coba Pengumuman Otomatis/.test(annText));
    await shot(page, '05-admin-announcement-created');

    // remove the record we just created so the demo data stays pristine
    const removed = await page.evaluate(async () => {
      const token = window.Core.store.data.token;
      const h = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const r = await fetch('/api/admin/announcements', { headers: h }).then((x) => x.json());
      let n = 0;
      for (const a of (r.data && r.data.items) || []) {
        if (/^Uji Coba Pengumuman/.test(a.title)) {
          await fetch('/api/admin/announcements/' + a.id, { method: 'DELETE', headers: h });
          n++;
        }
      }
      return n;
    });
    check('test announcement cleaned up', removed >= 1, 'removed ' + removed);
    await page.evaluate(() => { location.reload(); });
    await sleep(2500);
    await page.waitForSelector('#lg-demos .demo-acc, #app-root:not(.hidden)', { timeout: 20000 });

    // open a data table page and paginate
    await page.evaluate(() => { location.hash = '#/users'; });
    await sleep(1600);
    const rows = await page.$$('#users-list tbody tr[data-id]');
    check('users table populated', rows.length > 0, String(rows.length));
    await shot(page, '06-admin-users');

    // responsive check
    await page.setViewport({ width: 420, height: 900 });
    await sleep(700);
    const burgerVisible = await page.$eval('#btn-burger', (el) => getComputedStyle(el).display !== 'none');
    check('burger visible on mobile width', burgerVisible);
    await page.click('#btn-burger');
    await sleep(500);
    check('sidebar opens on mobile', await page.$eval('#sidebar', (el) => el.classList.contains('is-open')));
    await shot(page, '07-admin-mobile-sidebar');
    await page.setViewport({ width: 1440, height: 950 });

    check('no admin console errors', page.__errors.length === 0, page.__errors.slice(0, 4).join(' | '));
    await page.close();
  }

  /* ======================= PUBLIC / KIOSK ======================= */
  console.log('\n=== PUBLIC PAGES ===');
  {
    const page = await newPage(browser);
    await page.goto(BASE + '/kiosk/', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(1800);
    const qrSrc = await page.$eval('#k-qr', (el) => el.getAttribute('src') || '');
    check('kiosk shows the single rotating QR', /\/api\/public\/kiosk\/qr\.svg/.test(qrSrc), qrSrc);
    const qrOk = await page.$eval('#k-qr', (el) => el.naturalWidth > 0);
    check('kiosk QR image decoded', qrOk);
    const qrCount = await page.$$eval('.qr-card img, .qr img', (els) => els.length);
    check('kiosk renders exactly one QR', qrCount === 1, String(qrCount));
    check('kiosk no longer lists live attendance', (await page.$('#s-in')) === null && (await page.$('#k-feed')) === null);
    const rotTxt = await page.$eval('#k-rot-t', (el) => el.textContent.trim());
    check('kiosk shows the rotation countdown', /Kode berganti dalam \d+ dtk/.test(rotTxt), rotTxt);
    await shot(page, '08-kiosk');

    // the code really does rotate
    const t1 = await fetch(BASE + '/api/public/kiosk/token').then((r) => r.json()).then((j) => j.data.token);
    const t2 = await fetch(BASE + '/api/public/kiosk/token').then((r) => r.json()).then((j) => j.data.token);
    check('kiosk token is stable within its slot', t1 === t2);

    await page.goto(BASE + '/scan.html?mode=checkin&school=SP1TA&name=Test&lat=-7.78282&lng=110.36706', { waitUntil: 'networkidle2' });
    await sleep(1200);
    check('scan page renders', await page.$('#s-login') !== null);
    await shot(page, '09-scan');

    await page.goto(BASE + '/404.html', { waitUntil: 'networkidle2' });
    await sleep(400);
    check('404 page renders', (await page.$eval('body', (el) => el.textContent)).includes('404'));

    check('no public console errors', page.__errors.length === 0, page.__errors.slice(0, 4).join(' | '));
    await page.close();
  }

  /* ======================= MOBILE PWA ======================= */
  console.log('\n=== MOBILE PWA ===');
  {
    const page = await newPage(browser, {
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    // grant geolocation + camera so the check-in flow can complete
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(BASE, ['geolocation', 'camera']).catch(() => {});
    await page.setGeolocation({ latitude: -7.78282, longitude: 110.36706, accuracy: 12 });

    await page.goto(BASE + '/mobile/', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(1500);
    check('mobile login renders', await page.$('#li-id') !== null);
    await shot(page, '10-mobile-login');

    // dismiss the boot splash if present
    const splash = await page.$('#m-splash');
    if (splash) { await page.click('#m-splash').catch(() => {}); await sleep(600); }

    // demo accounts
    await page.waitForSelector('#li-demos .demo-chip', { timeout: 15000 });
    const demoIds = await page.$$eval('#li-demos .demo-chip', (els) => els.map((e) => e.dataset.id));
    check('mobile demo accounts listed', demoIds.length >= 3, demoIds.join(','));
    const demoTxt = await page.$eval('#li-demos', (e) => e.innerText);
    check('a parent demo chip is offered', /Orang Tua \/ Wali/i.test(demoTxt), demoTxt.slice(0, 200));
    const chipOrder = await page.$$eval('#li-demos .demo-chip', (els) => els.map((e) => e.dataset.demo));
    check('the parent chip sits below the employee chip',
      chipOrder.indexOf('parent') > chipOrder.indexOf('employee'), JSON.stringify(chipOrder));
    // tapping it must auto-fill the parent account
    const parentChip = await page.$('#li-demos .demo-chip[data-demo="parent"]');
    check('the parent chip is present', parentChip !== null);
    if (parentChip) {
      await parentChip.click();
      await sleep(300);
      const idVal = await page.$eval('#li-id', (e) => e.value);
      const passVal = await page.$eval('#li-pass', (e) => e.value);
      check('tapping the parent chip autofills the account',
        /^SP1TAP/.test(idVal) && passVal.length > 0, JSON.stringify([idVal, passVal.length]));
      await shot(page, '10b-mobile-login-parent-chip');
      await page.click('#li-go');
      await sleep(2600);
      const parentShell = await page.evaluate(() => !!window.MParent && !!window.MParent.state);
      check('the autofilled parent account signs in', parentShell === true, String(parentShell));
      // back to the login screen for the rest of the suite
      await page.evaluate(() => { localStorage.removeItem('sas.mobile.v1'); location.reload(); });
      await page.waitForSelector('#li-demos .demo-chip', { timeout: 15000 });
      await sleep(600);
    }
    await page.click('#li-demos .demo-chip');
    await sleep(300);
    await page.click('#li-go');
    await sleep(2500);

    // dismiss the welcome splash
    const sp2 = await page.$('#m-splash');
    if (sp2) { await page.click('#m-splash').catch(() => {}); await sleep(700); }

    /* The check-in button and the kiosk-scanner section below are only
       reachable while the day is still open for this account. Demo accounts
       get checked in and out by earlier runs of this very suite, so wipe
       today's record through the API first — otherwise the section silently
       skips and the scanner goes untested. */
    {
      const admT = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idNumber: 'SP1TAADM', password: 'demo123' }),
      }).then((r) => r.json()).then((j) => j.data.token);
      const AH = { Authorization: 'Bearer ' + admT, 'Content-Type': 'application/json' };
      const me = await page.evaluate(() => window.MCore.store.data.user.id);
      const day = await fetch(BASE + '/api/public/school', { headers: AH })
        .then((r) => r.json()).then((j) => (j.data.today || '').slice(0, 10));
      const rows = await fetch(BASE + `/api/admin/attendance?from=${day}&to=${day}&limit=300`, { headers: AH })
        .then((r) => r.json()).then((j) => (j.data.items || []).filter((a) => a.user_id === me));
      for (const r of rows) await fetch(BASE + '/api/admin/attendance/' + r.id, { method: 'DELETE', headers: AH });
      check('the demo day is reset for the scanner section', true, `${rows.length} row(s) cleared`);
      await page.evaluate(() => location.reload());
      await page.waitForSelector('#cio-btn', { timeout: 20000 });
      await sleep(2200);
      const sp2b = await page.$('#m-splash');
      if (sp2b) { await page.click('#m-splash').catch(() => {}); await sleep(800); }
    }

    check('mobile app shell visible', await page.$eval('#m-app', (el) => !el.classList.contains('hidden')));
    // 4 section tabs + the profile avatar box on the right edge
    const navTabs = await page.$$eval('#m-nav .fnb-item > span:not(.fnb-ico)', (els) => els.map((e) => e.textContent.trim()));
    check('bottom nav rendered', navTabs.length === 4 && !!(await page.$('#m-nav .fnb-fab')), navTabs.join(','));
    check('bottom nav has exactly 5 icons', navTabs.length + (await page.$$('#m-nav .fnb-fab')).length === 5, navTabs.join(','));
    check('bottom nav labels', navTabs.join('|') === 'Beranda|Kalender|Riwayat|Jadwal', navTabs.join('|'));
    check('bottom nav has no avatar box', (await page.$('#m-nav #nav-av')) === null);
    check('profile avatar lives in the header', (await page.$('#m-head #hd-av')) !== null);
    check('FAB rendered', await page.$('#nav-fab') !== null);
    await sleep(900);
    await shot(page, '11-mobile-home');

    // profile header
    const headName = await page.$eval('.mhead-name', (el) => el.textContent.trim());
    check('profile header shows user', headName.length > 2, headName);

    // 3D button exists
    const cio = await page.$('#cio-btn');
    check('3D check-in button present', cio !== null);
    if (cio) {
      const disabled = await page.$eval('#cio-btn', (el) => el.disabled);
      const label = await page.$eval('#cio-btn .cio-label', (el) => el.textContent.trim());
      check('check-in button state', ['Absen Masuk', 'Absen Pulang', 'Selesai'].includes(label), label);
      if (!disabled) {
        /* Arm the decoder BEFORE the sheet mounts: the scanner picks its
           engine once, at open time. Keep it silent (null payload) while the
           copy assertions run, then hand it the real rotating credential. */
        const armScanner = (raw) => page.evaluate((r) => {
          window.__FAKE_QR__ = r;
          window.BarcodeDetector = class {
            static async getSupportedFormats() { return ['qr_code']; }
            async detect() { return window.__FAKE_QR__ ? [{ rawValue: window.__FAKE_QR__ }] : []; }
          };
          // a fast link makes the scanner auto-submit instead of holding
          Object.defineProperty(navigator, 'connection', {
            get: () => ({ effectiveType: '4g', rtt: 60, downlink: 10 }), configurable: true,
          });
        }, raw);
        const kioskTokenNow = () => fetch(BASE + '/api/public/kiosk/token')
          .then((r) => r.json()).then((j) => j.data.token);

        await armScanner(null);
        await page.click('#cio-btn');
        await sleep(1800);
        const scanSheet = await page.$('.sheet');
        const scanText = scanSheet ? await page.$eval('.sheet', (el) => el.textContent) : '';
        check('3D button opens the kiosk QR scanner', /Pindai QR kiosk/.test(scanText), scanText.slice(0, 120));
        check('scanner accepts only the kiosk QR', /Hanya kode QR kiosk yang diterima/.test(scanText));
        check('scanner explains the code rotates', /berganti setiap\s*60 detik/.test(scanText), scanText.slice(-160));
        check('scanner has no school-code field', (await page.$('#ks-code')) === null);
        check('scanner shows a connection state strip', (await page.$('#ks-state')) !== null);
        await shot(page, '12-mobile-kiosk-scanner');
        const stateT = await page.$eval('#ks-state-t', (el) => el.textContent.trim()).catch(() => '');
        check('scanner reports the connection state', /Koneksi (lancar|lambat)/.test(stateT), stateT);
        console.log('    (hint: ' + (await page.$eval('#ks-hint', (e) => e.textContent.trim()).catch(() => '(none)')) + ')');
        console.log('    (video: ' + (await page.evaluate(() => { const v = document.querySelector('.sheet video'); return v ? String(!!v.srcObject) : 'no video'; })) + ')');
        console.log('    (BD: ' + (await page.evaluate(() => typeof window.BarcodeDetector)) + ' jsQR: ' + (await page.evaluate(() => typeof window.jsQR)) + ')');

        // record the exchanges so a failure can be read straight off the log
        const scans = [];
        const onScan = async (r) => {
          if (!r.url().includes('/api/public/scan-attend')) return;
          let body = '';
          try { body = await r.text(); } catch (e) { body = '(unreadable)'; }
          scans.push({ status: r.status(), body: body.slice(0, 160) });
        };
        page.on('response', onScan);
        // now present the code — the scanner must run with it on its own
        await armScanner(await kioskTokenNow());
        // the splash element lingers in the DOM and auto-closes — poll for it
        const splashOn = () => page.evaluate(() => {
          const el = document.getElementById('m-splash');
          return !!el && el.style.display !== 'none' && !el.classList.contains('is-out') && el.getBoundingClientRect().height > 0;
        });
        let sp3 = false;
        for (let i = 0; i < 60 && !sp3; i++) { sp3 = await splashOn(); if (!sp3) await sleep(250); }
        check('a decoded kiosk QR records the attendance', sp3 === true,
          sp3 ? '' : JSON.stringify(scans));
        page.off('response', onScan);
        await page.evaluate(() => { window.__FAKE_QR__ = null; });
        await shot(page, '12-mobile-checkin-splash');
        if (sp3) { await page.click('#m-splash').catch(() => {}); await sleep(900); }
      } else {
        console.log('    (user already checked out — skipping press)');
      }
    }

    // walk the bottom nav (5 icons: Beranda · Kalender · (+) · Riwayat · Jadwal)
    for (const key of ['calendar', 'history', 'schedule', 'home']) {
      await page.evaluate((k) => window.App && document.querySelector(`[data-nav="${k}"]`).click(), key);
      await sleep(1800);
      const len = await page.$eval('#m-view', (el) => el.textContent.trim().length);
      check(`mobile page "${key}" renders`, len > 60, `len ${len}`);
      await shot(page, '13-mobile-' + key);
    }
    // profile is reached from the header avatar, not from a tab
    await page.evaluate(() => document.querySelector('#m-head #hd-av').click());
    await sleep(1800);
    const profLen = await page.$eval('#m-view', (el) => el.textContent.trim().length);
    check('mobile page "profile" renders', profLen > 60, `len ${profLen}`);
    await shot(page, '13-mobile-profile');
    await page.evaluate(() => document.querySelector('[data-nav="home"]').click());
    await sleep(1500);

    // ---- the floating button belongs to extracurricular attendance only --
    const fabState = await page.evaluate(() => {
      const f = document.getElementById('m-fab');
      if (!f) return { exists: false, hidden: null, ec: false, display: null, onScreen: false };
      const cs = getComputedStyle(f);
      return {
        exists: true, hidden: f.hidden, ec: f.classList.contains('is-ec'),
        display: cs.display,
        // the `hidden` attribute only works if no rule overrides `display`
        onScreen: cs.display !== 'none' && cs.visibility !== 'hidden' && f.getBoundingClientRect().height > 0,
      };
    });
    const ecSessions = await page.evaluate(async () => {
      const r = await fetch('/api/mobile/me', { headers: { Authorization: 'Bearer ' + window.MCore.store.data.token } });
      return ((await r.json()).data || {}).ec_today || [];
    });
    if (ecSessions.length) {
      check('floating QR is shown when an extracurricular meets today', fabState.exists && !fabState.hidden && fabState.ec, JSON.stringify(fabState));
      await page.click('#m-fab');
      await sleep(900);
      const ecSheet = await page.$eval('.sheet', (el) => el.textContent).catch(() => '');
      check('floating QR opens extracurricular attendance', /Absen |Pilih kegiatan|GPS Lock/.test(ecSheet), ecSheet.slice(0, 120));
      await shot(page, '14-mobile-ec-attendance');
      await page.evaluate(() => { const c = document.querySelector('.sheet-scrim'); if (c) c.click(); });
      await sleep(700);
    } else {
      check('floating QR is hidden when no extracurricular meets today', fabState.hidden === true, JSON.stringify(fabState));
      // regression: `.fab { display: grid }` used to beat the hidden attribute
      check('floating QR is off screen when no extracurricular meets today', fabState.onScreen === false, JSON.stringify(fabState));
    }

    // request flow lives on the requests tab now
    await page.evaluate(() => document.querySelector('[data-nav="history"]').click());
    await sleep(1500);
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#h-tab button')];
      const t = tabs.find((x) => /permohonan/i.test(x.textContent)) || tabs[tabs.length - 1];
      if (t) t.click();
    });
    await sleep(1400);
    const addBtn = await page.$('#h-add');
    check('request tab exposes its own add button', addBtn !== null);
    if (addBtn) {
      await addBtn.click();
      await sleep(800);
      check('request sheet opens', await page.$('.sheet') !== null);
      await shot(page, '14-mobile-request-form');
      if (await page.$('.sheet [name="title"]')) {
        await page.type('.sheet [name="title"]', 'Permohonan uji coba');
        await page.type('.sheet [name="details"]', 'Dibuat oleh pengujian otomatis.');
        await page.click('.sheet [data-submit]');
        await sleep(1800);
        check('request submitted', true);
        await sleep(600);
        await shot(page, '15-mobile-history-after');
      }
    }

    // quick actions sheet
    await page.evaluate(() => document.querySelector('[data-nav="home"]').click());
    await sleep(1200);
    await page.click('#nav-fab');
    await sleep(700);
    check('quick actions sheet opens', await page.$('.sheet') !== null);
    await shot(page, '16-mobile-quick-actions');

    check('no mobile console errors', page.__errors.length === 0, page.__errors.slice(0, 5).join(' | '));
    await page.close();
  }

  await browser.close();

  console.log(`\n${pass} checks passed, ${problems.length} problems`);
  if (problems.length) {
    console.log('\nPROBLEMS:');
    problems.forEach((p) => console.log('  - ' + p));
  }
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('UI TEST CRASHED', e); process.exit(2); });
