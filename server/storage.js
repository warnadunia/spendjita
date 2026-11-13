'use strict';
/**
 * Hybrid Cloud & Local Storage Helper
 *
 * Supports:
 * 1. Supabase Storage (Primary - uses SUPABASE_URL & SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY)
 * 2. Vercel Blob (Alternative - uses BLOB_READ_WRITE_TOKEN)
 * 3. Local disk fallback (for offline dev, stored in data/uploads/)
 */
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (e) {}
}

let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {}

let put = null;
try {
  const blobPkg = require('@vercel/blob');
  put = blobPkg.put;
} catch (e) {}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attendance-photos';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY && createClient) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  } catch (err) {
    console.error('[storage] Supabase init error:', err.message);
  }
}

let bucketEnsured = false;
async function ensureBucket(bucketName) {
  if (bucketEnsured || !supabase) return;
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (!error && buckets) {
      const exists = buckets.some((b) => b.name === bucketName);
      if (!exists) {
        await supabase.storage.createBucket(bucketName, {
          public: true,
          fileSizeLimit: 5242880, // 5MB limit
        });
      }
      bucketEnsured = true;
    }
  } catch (err) {
    // If permission prevents listBuckets or createBucket, continue anyway
    bucketEnsured = true;
  }
}

/**
 * Uploads a base64 string or dataURL to cloud storage (Supabase or Blob),
 * or writes to local disk in development.
 *
 * @param {string} base64Data - Data URL (data:image/jpeg;base64,...) or raw base64 string
 * @param {string} filenamePrefix - Prefix for the stored file (e.g. 'selfie', 'avatar', 'logo')
 * @returns {Promise<string>} Public URL or relative path to the uploaded file
 */
async function uploadBase64(base64Data, filenamePrefix = 'upload') {
  if (!base64Data || typeof base64Data !== 'string') return '';

  // Already a URL (http, https, or local upload path)
  if (base64Data.startsWith('http://') || base64Data.startsWith('https://') || base64Data.startsWith('/uploads/')) {
    return base64Data;
  }

  // Parse mime type and decode buffer
  let mimeType = 'image/jpeg';
  let buffer;
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    mimeType = matches[1];
    buffer = Buffer.from(matches[2], 'base64');
  } else {
    try {
      buffer = Buffer.from(base64Data, 'base64');
    } catch (e) {
      return base64Data;
    }
  }

  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const filename = `${filenamePrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

  // 1. Primary: Supabase Storage
  if (supabase) {
    try {
      await ensureBucket(SUPABASE_BUCKET);
      const filePath = `${filenamePrefix}/${filename}`;
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, buffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (!error && data) {
        const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
        if (publicData && publicData.publicUrl) {
          return publicData.publicUrl;
        }
      } else if (error) {
        console.error('[storage:supabase] Upload error:', error.message);
      }
    } catch (err) {
      console.error('[storage:supabase] Error:', err.message);
    }
  }

  // 2. Alternative: Vercel Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && put) {
    try {
      const blob = await put(filename, buffer, {
        access: 'public',
        contentType: mimeType,
      });
      return blob.url;
    } catch (err) {
      console.error('[storage:blob] Upload error:', err.message);
    }
  }

  // 3. Fallback: Save to local disk (/data/uploads) for offline development
  try {
    const localFilePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(localFilePath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.error('[storage:local] Save error, keeping base64:', err.message);
    return base64Data;
  }
}

module.exports = {
  uploadBase64,
  UPLOADS_DIR,
};
