// ═══════════════════════════════════════════════════════════════════════
// lib/storage.js — uploads generated PDF buffers to a Cloud Storage
// bucket and returns a URL, replacing DriveApp.createFile() from
// code.js. Uses Cloud Run's attached service account automatically —
// no separate credentials file needed, unlike Drive's per-user OAuth.
//
// Setup required (one-time, in GCP Console or gcloud CLI):
//   gsutil mb -l asia-south1 gs://<your-bucket-name>
//   Grant the Cloud Run service account "Storage Object Admin" on it.
// Set env var GCS_BUCKET_NAME to the bucket you create.
// ═══════════════════════════════════════════════════════════════════════
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

async function uploadPdf(buffer, destPath) {
  if (!bucketName) throw new Error('GCS_BUCKET_NAME environment variable is not set.');
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(destPath);

  await file.save(Buffer.from(buffer), {
    contentType: 'application/pdf',
    metadata: { cacheControl: 'private, max-age=0' },
  });

  // Signed URL valid for 7 days — matches the "internal tool" access
  // pattern (users are already authenticated via the portal session;
  // this just needs to survive long enough to be viewed/downloaded
  // without making the bucket public).
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  return signedUrl;
}

module.exports = { uploadPdf };
