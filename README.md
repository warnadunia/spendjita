# 🎓 School Attendance System

A full-stack school attendance platform for **teachers, students and employees**, built as three
surfaces on one Node/Express backend:

| Surface | URL | What it is |
|---|---|---|
| **Public website** | `/` | Landing page with live stats + the dynamic QR codes |
| **QR kiosk** | `/kiosk` | One full-screen QR for check-in *and* check-out, rotating every 60 s |
| **Scan target** | `/scan.html` | What the QR resolves to — sign in & confirm with GPS |
| **Admin web** | `/admin` | Sidebar dashboard, full CRUD, reports, PWA branding studio |
| **Mobile PWA** | `/mobile` | Installable app for teachers, students, employees **and parents** |

Everything is seeded with realistic Indonesian junior-high-school demo data, so the app feels
alive on first load. The demo school is **SMP Negeri 1 Yogyakarta**, Jalan Cik Di Tiro No.29,
Yogyakarta — school code `SP1TA`, telephone `(0274) 560232`. Grades run **VII / VIII / IX**.

---

## Quick start

```bash
cd school-attendance
npm install
npm start
```

Then open **http://localhost:3000**.

### Demo accounts — password `demo123`

| Role | ID | Name |
|---|---|---|
| Administrator | `SP1TAADM` | Administrator Sekolah |
| Guru (teacher) | `SP1TAT001` | Drs. Adi Sucipto, M.Pd |
| Peserta Didik (student) | `SP1TA7A01` | Rafli Rahmawati |
| Karyawan (employee) | `SP1TAE001` | Dra. Suhartiningsih |
| Orang Tua / Wali (parent) | `SP1TAP001` | Budi Santoso |

Every ID is built from the school code `SP1TA`: the next character marks the role
(`T` guru, `E` karyawan, `P` orang tua, `ADM` administrator) and a student's ID
carries their class — `SP1TA7A01` is student 01 of **VII-A**, `SP1TA9C03` is
student 03 of **IX-C** (7/8/9 = kelas VII/VIII/IX).

The login screens have one-tap chips that fill these in. The **admin** panel rejects
teacher/student/employee logins and the **mobile** app rejects admin logins.

> Data lives in `data/db.json` and is created on first boot. Delete that folder (or hit
> *Muat ulang data demo* in Settings → Zona berisiko) to start over.

---

## Feature map

### Public webpage
- **Dynamic QR codes** for check-in **and** check-out, rendered server-side as SVG.
  The payload embeds the school code, name and GPS coordinates, and is regenerated on every
  request (`/api/public/qr/checkin.svg`), so the code always tracks the current host + location.
- Live attendance counters, refreshed every 20 s.
- `/kiosk` — a full-screen version for a tablet/TV at the school gate. **One QR only**, with a
  countdown bar; no side panels and no live attendance listing (that data lives on the admin
  dashboard). The code is re-minted on every 60-second slot and signed, so a screenshot is
  worthless a minute later.
- `/scan.html` — the QR target: sign in with ID + password, GPS-lock, confirm, done. Remembers
  the device, and supports "forgot password" inline.

### Admin web (sidebar navigation)
- **Dashboard** — dynamic & real-time (auto-refreshes every 15 s): counters, 7-day trend bars,
  per-class breakdown, role donut, live activity feed, pending requests, announcements, agenda.
- **Reports** — date range + role filters, KPI strip, status/role/class/date breakdowns,
  per-user leaderboard, extracurricular participation, **request analytics**, CSV export.
- **Requests** — Sickness, Family Agenda, Official Duty, Personal, Other. Approve/reject with a
  review note; approving awards profile points.
- **Academic calendar** — month grid with colour-coded event types, CRUD, multi-day events.

### Parents — following their own children
A parent is a **first-class account** (`role: 'parent'`) whose only job is to follow their own
children. The link lives in a `parent_links` collection, so one parent can watch several children
and a child can be followed by mother, father and guardian at the same time — without any of them
inheriting a school role.

| | |
| --- | --- |
| **Access** | Their own `id_number` + password. Admin creates the account and links it to a student from **Orang Tua & Peserta Didik**. |
| **Surface** | Parent mode inside the mobile PWA. Four tabs · Beranda · Sekolah · Ekskul · Surat · plus the bell for school information. |
| **Sees** | Where the child is right now, seven-day and historical attendance, the extracurriculars they joined with schedules and attendance, permission letters with their approval status, and the announcements/news published for students. |
| **Cannot do** | Record attendance, file a request, scan the kiosk QR, or reach the member API. `/api/mobile/*` refuses the role; `/api/parent/*` is the only surface, and every call is scoped to a linked child. |

Authorisation **is** the link: requesting another parent's child returns `403`, and the overview
reports the relationship (`Ayah` / `Ibu` / `Wali`) the account holds.

Demo parents (password `demo123`): `SP1TAP001` Budi Santoso (1 child), `SP1TAP002` Siti Rahayu
(2 children — shows the child switcher), `SP1TAP003` Agus Priyanto (1 child). The whole of
kelas VII-A has a guardian too, so the manager has a table worth searching.

#### Orang Tua & Peserta Didik — the admin manager
The manager is **statistics + one compact table**, not a wall of cards:

- **Statistics strip** — headcount of students in **kelas VII, VIII and IX**, the total number of
  **Orang Tua / Wali**, and a KPI row for total students, already linked, not yet linked, total
  links and coverage. The cards are computed school-wide and deliberately do **not** move while
  you search or filter.
- **Search** — one box across the student's name and ID, the parent's name, ID and phone, the
  class and the relationship.
- **Filters** — *Tingkat* (VII / VIII / IX) and *Hubungan* (Ayah / Ibu / Wali), plus paging.
- **Editable rows** — the pencil opens a dialog that re-links the row to another student or
  another parent account, changes the relationship, and edits the parent's own name, phone and
  email. The trash button unlinks after a confirmation.

`GET /api/admin/parent-links` returns `{items, total, page, limit, total_pages, stats}`, and
`PUT /api/admin/parent-links/:id` accepts `{student_id, parent_id, relationship, parent:{name,
phone, email}}` — the nested `parent` object writes through to the account itself.

### Kiosk QR — one rotating code for both directions
The kiosk screen shows **a single QR**, full screen, with no side panels and no live attendance
listing (those numbers live on the admin dashboard instead). It heals itself: a dropped poll is
retried, the failure screen only appears after three consecutive misses, and it is cleared — blur
included — as soon as the server answers again. The service worker never caches
`/api/public/kiosk/*`, so the screen cannot paint an already-expired code.

The code is minted from a **60-second time slot** and signed with the app secret
(`GET /api/public/kiosk/token`, rendered by `GET /api/public/kiosk/qr.svg`). Consequences:

- a photograph or screenshot of the screen is worthless one minute later — replaying it returns
  `410 Gone`;
- every kiosk renders the *identical* code for the whole slot and all of them change on the same
  minute boundary (the payload carries no issue time, only the slot);
- a one-slot grace window absorbs clock skew, so a code rendered just before the rollover still
  scans. The signed payload's `exp` runs to the end of that window (not to the rotation instant),
  otherwise the code would stop working the moment the screen changes — which is exactly when a
  slow connection needs the grace;
- the code encodes the school, the **school coordinates** and the **radius configured in
  Settings** — the radius is always enforced on this path, even when "allow outside confirm" is on.

Anyone who scans it with a plain camera app lands on `/scan.html`, which resolves the direction
from the member's own record for the day before confirming.
- **Announcements** — date, time, title, location, details, audience, pinning, plus an
  **attachment** and an **external link** with its own label. Attachments are **PDF-first** because
  the usual case is an official circular letter (surat edaran) or a letter from the principal:
  the picker is labelled for PDF, the card shows a red PDF chip, and the detail page embeds a
  **PDF reader** right in the modal. Images are previewed inline; anything else becomes a download
  row. Only an admin can add them; the server re-validates the payload (data-URL only, max 2 MB)
  and the link (http/https only). A **detail page** button on each card previews exactly what
  members will see in the app.
- **News / information** — date, time, title, details, category, view counter, plus the same
  attachment + external-link fields and the same admin-only detail preview.
- **Extracurriculars** — one activity carries **many schedules** (day/time, optional grade-group
  restriction, optional venue), **many places/venues** (each with its own GPS Lock point and
  radius), **many mentors & coaches** (Pembina / Pelatih / Asisten Pelatih, one marked primary)
  and **many student members** grouped by grade (Kelas VII / VIII / IX). Attendance is recorded
  with **live GPS + selfie capture** against the venue of the session being attended.
  - **Jadwal** manager — add/edit/delete the weekly sessions.
  - **Tempat** manager — register venues, set their coordinates with "use my location".
  - **Anggota** manager — filter by grade group, bulk-enrol students from a searchable picker
    ("Tambah Anggota" → tick → choose group), change a member's group, remove a member.
  - **Pembina** manager — assign teachers *or* employees as mentors/coaches.
- **Jadwal Mengajar** — the class timetable. Admin assigns a teacher to a class, day, period,
  subject and room; filter by day / teacher / class; plus a read-only **weekly grid** of every
  class. This is what drives the teacher's and the student's daily schedule in the app.
- **Users** — teacher / student / employee CRUD, search, filters, detail drawer with history,
  password reset, point adjustment. The edit form also lists every extracurricular the person is
  attached to, and in which capacity (member + grade group, or mentor + role).
- **Activity log** — every check-in, login, request and admin action.
- **Settings — PWA / APK studio** — logo upload (drag & drop), brand colours, app name/tagline,
  timezone, splash-screen quotes, attendance rules (work hours, late tolerance, radius, method,
  GPS/selfie toggles), school map coordinates, and **Android TWA** package + SHA-256
  fingerprints published at `/.well-known/assetlinks.json`.

Saving brand colours **re-renders the PNG app icons** on the server and updates the web manifest.

### Mobile PWA
- **Point ranking strictly inside one role** — a student only ever sees students, a teacher only
  teachers, an employee only employees. There are no cross-role tabs: the sheet is scoped to the
  member's own role and always surfaces their row together with their true position inside it.
  Rows are labelled numerically instead of by level name:

  ```
  10 Point (173 / 175)      ← 10 points, rank 173 out of 175 people in this role
  ```
- **Splash screen** with a rotating encouraging quote on boot, after check-in and after
  check-out (quotes are editable in the admin Settings).
- **Login** with ID + password, "remember me", and a full forgot-password → 6-digit code → reset flow.
- **Floating bottom navigation** — a pill with exactly **five icons**:
  `Beranda` · `Kalender` · **(+)** · `Riwayat` · `Jadwal`.
  There is no "Info" tab (it lives behind the bell at the top) and no "Profil" tab (it lives in
  the **avatar box** at the top of the profile section). Tapping the header avatar opens the
  Profile page and it is ringed while you are there; the avatar refreshes when the photo changes.
- **Home** — profile header with the avatar box, **3-D check-in/check-out button** (CSS 3-D with
  pointer tilt, pulsing ring, press physics), stats, weekly strip, announcements, news, agenda,
  today's extracurriculars. Tapping an announcement or a news item opens its **detail page**.
  The 3-D button is the **kiosk scanner**: it opens the camera, reads the rotating code, and the
  server decides whether this scan is a check-in or a check-out. On a fast link it happens on its
  own; on a slow link the member taps **Proses Absen**. GPS is locked automatically and the
  configured radius is always enforced on this path.
- **Attendance history** — statistics for attendance *and* requests above the data grid,
  grouped by month, with a **FAB (+)** to file a request.
- **Academic calendar** — month grid. Tapping a date opens a **role-scoped day detail**:
  - **Student** → their daily class schedule + the sessions of the extracurriculars they follow
    (only the ones matching their grade group) + general school information.
  - **Teacher** → the class periods they are assigned to teach + the extracurriculars they coach.
  - **Employee** → general information only (events, announcements, news).
  - **Mentor / coach** (teacher or employee) → the extracurricular schedules they are assigned to.
  General information is **date-exact**: only the announcements and news *published on that very
  date* are listed, each tappable to open its detail page with the attachment and the link.
- **Pengumuman & Berita** — opened from the **bell** at the top of the screen (segmented
  Pengumuman / Berita tabs). Tapping a row opens the item's **detail page**: full body,
  the attachment (a PDF reader for circular letters, an inline preview for images, a download
  button otherwise) and the external link (opens in a new tab). Opening a news item counts a view.
- **Jadwal** — the weekly timetable as its own tab: six day tabs defaulting to today, the class
  timetable (or teaching load for a teacher) sorted by period, and the extracurricular sessions
  for that day with their venue and grade group. Employees see a note pointing them to the
  calendar instead.
- **Profile** — the **avatar box** at the top of the profile section is the entry point: tap it
  (in the header, on any page) to get here. Score points with level ring and rank, statistics,
  edit biodata (with photo), change password, **Ekstrakurikuler saya**, **Jadwal mingguan**
  (jumps to the Jadwal tab), leaderboard, logout.
- **Kiosk QR scanning** — `Beranda` → the 3-D button **only opens the scanner**. It never records
  anything from GPS alone: an attendance is sent **only** after the camera has decoded a signed
  kiosk QR. There is no school-code field and no code fallback.
  - **Decoding** uses the native `BarcodeDetector` where the browser offers it and falls back to a
    bundled `jsQR` build (`/vendor/jsQR.js`) on iOS Safari and Firefox, which have no
    `BarcodeDetector`. Both engines feed the same parser.
  - **Only the kiosk QR is accepted.** A foreign barcode — a product code, a poster, a Wi-Fi
    login — is ignored and the scanner keeps looking; nothing is sent for it.
  - One scan records either the check-in or the check-out; the member never picks a direction.

  The scanner first probes the link (`navigator.connection`, falling back to a `/api/health`
  round trip) and then behaves in one of two ways:

  | link | behaviour |
  | --- | --- |
  | **fast** (4G / health reachable in < 1 s) | the decoded code is sent at once — the attendance is recorded **automatically**, no tap needed |
  | **slow** (2G/3G/save-data, or the probe times out) | the code is **held** and a **Proses Absen** button appears; the member taps it to send it |

  A held code carries a live countdown (≈55 s) and is dropped when it expires, so a slow member is
  always told to rescan rather than silently submitting a stale credential.
- **Extracurriculars** — a member only ever sees the activities they are assigned to. Opening one
  shows its schedules (grouped by day), venues with coordinates, mentors/coaches, the member's own
  grade-group peers, and their attendance history.
  - **The floating QR button is extracurricular-only.** It appears *only* when the member has a
    session scheduled that day, shows a count badge when there is more than one, and opens the
    attendance sheet (or a picker when several activities meet). With no session it leaves the
    screen entirely — `.fab[hidden]` overrides `.fab { display: grid }`, because the `hidden`
    attribute alone is beaten by any `display` rule.
  - Attendance is recorded with **GPS Lock against the session venue** plus a **mandatory live
    selfie**. The selfie is captured straight from `getUserMedia` — there is no file input at all,
    so a picture from the gallery can never be attached — and the preview is overlaid with a
    **face-outline guide** (oval mask + centre mark + shoulder line) to frame the shot. When the
    browser exposes `FaceDetector`, the hint also reports whether a face is visible.
- Offline-capable via a service worker; installable to the home screen.

---

## Architecture

```
school-attendance/
├── server/
│   ├── index.js        # express app, routes, manifest, TWA asset links, icons
│   ├── db.js           # atomic write-through JSON store (data/db.json)
│   ├── seed.js         # realistic demo dataset generator
│   ├── util.js         # ids, timezone/date helpers, scrypt hashing, HMAC tokens
│   ├── auth.js         # session middleware, role guards, profile points/levels
│   ├── attendance.js   # check-in/out, geofencing, status, aggregation
│   ├── schedule.js     # EC membership/mentoring/venues/schedules, class timetable,
│   │                   # role-scoped calendar day detail, per-role point ranking
│   ├── assets.js       # SVG avatars, logos, QR codes
│   ├── png.js          # zero-dependency PNG encoder + icon rasteriser
│   ├── icons.js        # PWA icon generation + Digital Asset Links
│   └── routes/         # auth, admin, mobile, public
├── public/
│   ├── index.html      # public landing page
│   ├── kiosk/          # big-screen QR
│   ├── scan.html       # QR target
│   ├── 404.html, sw.js
│   ├── assets/base.css # shared design tokens & primitives
│   ├── admin/          # core.js · list.js · pages-a.js · pages-b.js · pages-c.js · app.js
│   └── mobile/         # core.js · app.js
└── scripts/            # smoke.js · ui-test.js · ui-deep.js · ui-features.js
```

### Notes on the stack

- **No database server, no build step.** Persistence is a single JSON file with atomic
  (temp-file + rename) writes and a short write-behind buffer. Swapping in SQLite/Postgres means
  replacing `server/db.js` only — every route goes through `db.all/find/insert/update/remove`.
- **Only two npm dependencies** (`express`, `qrcode`). Passwords use Node's `scrypt`;
  sessions are HMAC-signed tokens; PNG icons are encoded with `zlib` — so the app installs and
  boots anywhere Node 18+ runs.
- **Server-rendered QR codes.** The QR SVG is generated per request from the live school
  coordinates and current host, which is what makes it genuinely *dynamic*.
- **Timezone-aware.** All "today" logic uses the school's configured timezone (default
  `Asia/Jakarta`, UTC+7), not the server's local time.

### Security

- Passwords hashed with `scrypt` + per-user salt, compared in constant time.
- Tokens are HMAC-SHA256 signed with an expiry; `APP_SECRET` overrides the default.
- Route guards: `/api/admin/*` admin-only, `/api/mobile/*` teacher/student/employee/admin.
- Users can only read and mutate their *own* attendance, requests and profile.
- **Assignment scoping**: `/api/mobile/extracurriculars` (and every EC sub-resource) only ever
  returns activities the caller is attached to — as an enrolled student, or as a mentor/coach.
  Attendance for an unassigned activity is rejected with `403`.
- **Role scoping**: the academic-calendar day detail and the point ranking are resolved
  server-side from the caller's role, so the client can never ask for another role's data.
- Passwords are never returned by any endpoint.

> ⚠️ This is a **demo** build: the password-reset code is returned in the API response instead
> of being emailed, and there is no rate limiting. Harden both before production.

---

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `/forgot-password`, `/reset-password`, `/change-password`, `PUT /profile`, `GET /me`, `GET /demo-accounts`, `GET /points-leaderboard` |
| Public | `GET /api/public/school`, `/live`, `GET /api/public/qr/:mode.svg` (legacy per-direction codes), `GET /api/public/kiosk/token`, `GET /api/public/kiosk/qr.svg` (the single rotating code), `POST /scan/resolve`, `/scan/login`, `/scan/confirm` |
| Mobile · kiosk scan | `POST /api/public/scan-attend` — accepts `{ token }` (the rotating kiosk QR, expires in 60 s); decides check-in vs check-out from today's record and always enforces the configured radius. The mobile app never sends a school code |
| Mobile · sessions | `GET /api/mobile/me` and `/dashboard` return `ec_today` — the sessions that gate the floating extracurricular button |
| Admin | `GET /api/admin/dashboard`, CRUD `/users`, `/attendance`, `/requests`, `/announcements`, `/news`, `/events`, `/extracurriculars` (+ `/attendance` sub-resource), `GET /reports`, `GET /reports/export.csv`, `GET/PUT /settings`, `POST /settings/logo`, `/settings/geo`, `GET /logs`, `POST /demo/reset` |
| Admin · scheduling | CRUD `/api/admin/class-schedules` (teacher timetable), CRUD `/api/admin/ec-schedules`, `/ec-places`, `/ec-mentors`, `/ec-members` (+ `POST /ec-members/bulk`), `GET /api/admin/ec-candidates`, `GET /api/admin/ec-load`, `GET /api/admin/users/:id/extracurriculars` |
| Admin · media | `POST`/`PUT` `/api/admin/announcements` and `/api/admin/news` accept `attachment` (`{name,type,size,data}` data-URL, max 2 MB) and `link_url` + `link_label` (http/https only). Both are rejected with `400` when malformed, and only an admin session may write them. |
| Mobile | `GET /api/mobile/me`, `/dashboard`, `/attendance`, `/weekly`, `/requests`, `/announcements`, `/news` (+ `POST /news/:id/view`), `/events`, `/extracurriculars` (+ `/:id`), `/leaderboard` (own role only, plus `groups` for every role), `/calendar/day` (role-scoped **and** date-exact), `/schedule/today`, `/schedule/week`, `POST /checkin`, `/checkout`, `POST /extracurriculars/:id/attendance` |

Responses are wrapped as `{ ok: true, data }` or `{ ok: false, error }`. List endpoints accept
`q`, `page`, `limit` and resource-specific filters and return `{ items, total, page, total_pages }`.

### Scoping rules worth knowing

- **Assignment scoping** — a member only ever sees the extracurriculars they are enrolled in or
  appointed to coach; EC attendance is rejected unless the session belongs to an assigned activity.
- **Role scoping** — the point ranking is computed and served *within* a single role; the calendar
  day detail only contains the schedules that belong to the caller's role.
- **Date scoping** — the calendar day detail lists only the announcements/news whose `date`
  equals the requested day, never the latest ones.
- **Admin-only authoring** — attachments and external links can only be created, changed or
  removed through the admin API; the mobile endpoints are strictly read-only for this data.
- **Only the kiosk QR is accepted** on the mobile scanner — the school code is never used and no
  manual entry exists in the app.
- **Replay protection** — the kiosk credential is signed and self-expiring. A tampered or expired
  token is rejected with `410`, so a stored or photographed code cannot be reused.
- **Live-only selfies** — extracurricular attendance is captured from the camera stream; no file
  input exists in that flow, so gallery images cannot be substituted.

---

## Testing

Four suites, all green:

```bash
node scripts/smoke.js        # 192 API checks (auth, CRUD, geofence, scan flow, CSV,
                             #               assignment + role scoping, timetable CRUD,
                             #               attachment + link validation, date-exact day
                             #               detail, intra-role ranking, rotating kiosk
                             #               QR + scan-attend replay protection, kiosk
                             #               token lifetime, parent links: statistics,
                             #               pagination, search, filters, editing + overview)
node scripts/ui-test.js      #  75 browser checks + screenshots for every screen
                             #               (incl. the parent demo chip and a real
                             #               end-to-end kiosk scan)
node scripts/ui-deep.js      #  90 checks: layout audit + end-to-end CRUD flows
node scripts/ui-features.js  # 236 checks: teacher timetable, EC managers (schedules/places/
                             #             members/mentors), 5-icon bottom nav + header avatar
                             #             box, Jadwal tab, bell info sheet, role-scoped
                             #             calendar day detail, "N Point (rank / total)"
                             #             ranking, single rotating kiosk QR, kiosk scanner
                             #             (QR-only, jsQR fallback, auto on a fast link,
                             #             "Proses Absen" on a slow one, self-healing kiosk
                             #             screen), extracurricular-only floating QR, live
                             #             selfie with face frame, PDF attachment reader,
                             #             parent mode + the parent link manager:
                             #             grade statistics, search, filters, paging and
                             #             editing a link
```

`ui-test.js` writes screenshots to `screenshots/`. The browser suites drive headless Chromium via
Puppeteer (installed to `/tmp/pwtest` in this workspace) and assert on real DOM state, console
errors, horizontal overflow and element geometry.

---

## Packaging the PWA as an APK

1. Open **Settings → Identitas aplikasi (PWA / APK)** and set the **Android package name**.
2. Add the **SHA-256 certificate fingerprint** (Android Studio copies it colon-separated; both
   formats are accepted). It is published at `/.well-known/assetlinks.json`.
3. Build with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or PWABuilder.

The manifest already declares `display: standalone`, maskable icons, shortcuts for
*Absen Masuk / Absen pulang / Tambah Permohonan*, and the brand colour from Settings.
