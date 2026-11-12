'use strict';
/**
 * Vercel Blob storage helper for uploading files, selfies, and avatars.
 */
let put = null;
try {
  const blobPkg = require('@vercel/blob');
  put = blobPkg.put;
} catch (e) {
  // package not installed or optional
}

async function uploadBase64(base64Data, filenamePrefix = 'upload') {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !put) {
    // Fallback: return raw base64 if Blob token is not configured
    return base64Data;
  }

  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let mimeType = 'image/jpeg';
    let buffer;

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Data, 'base64');
    }

    const ext = mimeType.split('/')[1] || 'jpg';
    const filename = `${filenamePrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: mimeType,
    });

    return blob.url;
  } catch (err) {
    console.error('[blob] upload error, falling back to base64:', err.message);
    return base64Data;
  }
}

module.exports = {
  uploadBase64,
};

