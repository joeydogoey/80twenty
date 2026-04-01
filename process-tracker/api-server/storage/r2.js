'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

/**
 * Generate a pre-signed PUT URL for uploading a screenshot to R2.
 * @param {string} key  - Remote object key (e.g. "screenshots/2026/04/01/scr_....jpg")
 * @param {string} contentType
 * @returns {Promise<string>} Pre-signed URL valid for 5 minutes
 */
async function generateUploadUrl(key, contentType = 'image/jpeg') {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  // URL valid for 5 minutes — enough time for the desktop agent to upload
  return getSignedUrl(getClient(), command, { expiresIn: 300 });
}

/**
 * Build the public CDN URL for a remote key.
 */
function buildPublicUrl(key) {
  const base = process.env.R2_PUBLIC_URL || '';
  return base ? `${base.replace(/\/$/, '')}/${key}` : key;
}

module.exports = { generateUploadUrl, buildPublicUrl };
