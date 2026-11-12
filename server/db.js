'use strict';
/**
 * Hybrid persistent data store.
 *
 * Supports:
 * 1. Supabase Postgres (Remote cloud DB) when SUPABASE_URL & SUPABASE_KEY are provided.
 * 2. Local JSON file (data/db.json) for offline local development.
 */
const fs = require('fs');
const path = require('path');
let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = [
  'schools',
  'users',
  'attendance',
  'requests',
  'announcements',
  'news',
  'events',
  'extracurriculars',
  'ec_attendance',
  'settings',
  'logs',
  'ec_members',
  'ec_mentors',
  'ec_places',
  'ec_schedules',
  'class_schedules',
  'parent_links',
];

let cache = null;
let flushTimer = null;
let dirty = new Set();
let supabase = null;

// Initialize Supabase client if environment variables exist
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (SUPABASE_URL && SUPABASE_KEY && createClient) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  } catch (err) {
    console.error('[db] Supabase init error:', err.message);
  }
}

function empty() {
  const db = {};
  COLLECTIONS.forEach((c) => (db[c] = []));
  return db;
}

function seedDefaults(db) {
  db.settings.push({
    id: 'school_default',
    school_id: 'school_default',
    school_name: 'SMP Negeri 1 Yogyakarta',
    school_code: 'SP1TA',
    school_address: 'Jalan Cik Di Tiro No.29, Yogyakarta, Daerah Istimewa Yogyakarta, Indonesia',
    school_phone: '+62 274 782 111',
    school_email: 'info@sp1yogyakarta.sch.id',
    logo: '',
    theme_primary: '#4f46e5',
    theme_accent: '#f59e0b',
    app_name: 'Absensi SMP Negeri 1 Yogyakarta',
    app_short_name: 'Absensi',
    app_tagline: 'Tuntas, Berkarya, Berprestasi',
    timezone: 'Asia/Jakarta',
    work_start: '07:30',
    work_end: '15:30',
    late_after_minutes: 10,
    leave_early_minutes: 45,
    checkin_radius_m: 120,
    ec_radius_m: 60,
    require_gps: true,
    require_selfie: false,
    allow_outside_confirm: true,
    checkin_method: 'qr_gps',
    checkout_enabled: true,
    splash_quotes: [
      'Setiap langkah kecil adalah awal dari pencapaian yang besar.',
      'Datang tepat waktu adalah bentuk hormat terhadap waktu dan diri sendiri.',
      'Belajarlah hari ini, berkaryalah esok.',
      'Kehadiranmu adalah kekuatan kelas ini.',
      'Sekali lagi, kamu mampu!',
      'Manfaatkan hari ini sebaik-baiknya.',
      'Kedisiplinan membangun kebiasaan, kebiasaan membangun karakter.',
      'Semangat pagi, hari ini akan menjadi luar biasa.',
    ],
    checkin_splash_quote: '',
    checkout_splash_quote: '',
    brand_config: {},
    updated_at: new Date().toISOString(),
  });
}

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      cache = empty();
      COLLECTIONS.forEach((c) => {
        cache[c] = Array.isArray(raw[c]) ? raw[c] : [];
      });
      if (!cache.settings.length) seedDefaults(cache);
      return cache;
    }
  } catch (err) {
    console.error('[db] failed to load local file:', err.message);
  }
  cache = empty();
  seedDefaults(cache);
  saveNow();
  return cache;
}

// Background sync to Supabase if configured
async function syncToSupabase(name) {
  if (!supabase) return;
  try {
    const data = cache[name] || [];
    const { error } = await supabase
      .from('collections')
      .upsert({ name, data, updated_at: new Date().toISOString() }, { onConflict: 'name' });
    if (error) console.error(`[db] sync to Supabase failed for ${name}:`, error.message);
  } catch (err) {
    console.error(`[db] Supabase error for ${name}:`, err.message);
  }
}

// Background sync all collections from Supabase
async function syncFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('collections').select('name, data');
    if (!error && Array.isArray(data) && data.length) {
      data.forEach((row) => {
        if (row.name && Array.isArray(row.data)) {
          cache[row.name] = row.data;
        }
      });
      console.log('[db] Synced collections from Supabase.');
    }
  } catch (err) {
    console.error('[db] failed syncing from Supabase:', err.message);
  }
}

function saveNow() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 0), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    // In serverless / read-only environment, ignore local fs write errors
  }

  if (supabase && dirty.size) {
    dirty.forEach((coll) => syncToSupabase(coll));
  }
  dirty.clear();
}

function scheduleFlush(collectionName) {
  if (collectionName) dirty.add(collectionName);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty.size) saveNow();
  }, 150);
}

function ensure() {
  if (!cache) {
    load();
    if (supabase) {
      syncFromSupabase().catch(() => {});
    }
  }
  return cache;
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */
function all(name) {
  const db = ensure();
  if (!db[name]) db[name] = [];
  return db[name];
}

function insert(name, doc) {
  const db = ensure();
  if (!doc.id) doc.id = require('./util').uid(name.slice(0, 3));
  doc.created_at = doc.created_at || new Date().toISOString();
  doc.updated_at = new Date().toISOString();
  db[name].push(doc);
  scheduleFlush(name);
  return doc;
}

function update(name, id, patch) {
  const db = ensure();
  const row = db[name].find((r) => r.id === id);
  if (!row) return null;
  Object.keys(patch || {}).forEach((k) => {
    if (patch[k] !== undefined) row[k] = patch[k];
  });
  row.updated_at = new Date().toISOString();
  scheduleFlush(name);
  return row;
}

function remove(name, id) {
  const db = ensure();
  const i = db[name].findIndex((r) => r.id === id);
  if (i < 0) return false;
  db[name].splice(i, 1);
  scheduleFlush(name);
  return true;
}

function find(name, fn) {
  return all(name).filter(fn);
}

function findOne(name, fn) {
  return all(name).find(fn) || null;
}

function count(name, fn) {
  return fn ? all(name).filter(fn).length : all(name).length;
}

function replaceAll(name, rows) {
  const db = ensure();
  db[name] = rows;
  scheduleFlush(name);
}

function save(name) {
  ensure();
  dirty.add(name);
  saveNow();
}

module.exports = {
  COLLECTIONS,
  DATA_DIR,
  DB_FILE,
  load,
  ensure,
  save,
  all,
  insert,
  update,
  remove,
  find,
  findOne,
  count,
  replaceAll,
  saveNow,
};
