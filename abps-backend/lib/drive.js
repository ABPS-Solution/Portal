// ═══════════════════════════════════════════════════════════════════════
// lib/drive.js — REVISED: uses a connected personal Gmail account's own
// "My Drive" via OAuth, instead of a service-account-owned Shared Drive.
//
// WHY THE CHANGE: Shared Drives require a Google Workspace subscription,
// which ABPS doesn't have — only personal Gmail accounts. Personal Gmail
// accounts DO have normal Drive storage, so instead of a service account
// (which has no storage on personal-account infrastructure), this reuses
// the same OAuth refresh-token pattern already built for Gmail polling
// (admin_db.gmail_connections) — one designated connected account acts
// as the "owner" of all portal-generated Drive files/folders.
//
// SETUP: set env var DRIVE_OWNER_EMAIL to whichever connected Gmail
// account should own these files — that account must have gone through
// /api/gmailAuth/connect (which now requests the drive.file scope too).
// ═══════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { Readable } = require('stream');
const { pool } = require('../db');

async function getDriveClient() {
  const ownerEmail = process.env.DRIVE_OWNER_EMAIL;
  if (!ownerEmail) throw new Error('DRIVE_OWNER_EMAIL environment variable is not set.');

  const { rows } = await pool.query(
    `SELECT refresh_token FROM admin_db.gmail_connections WHERE email = $1 AND status = 'Active'`,
    [ownerEmail]
  );
  if (rows.length === 0) {
    throw new Error(`No active connection for ${ownerEmail}. Visit /api/gmailAuth/connect to authorize this account (with Drive access) first.`);
  }

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: rows[0].refresh_token });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

function sanitize(name) {
  return (name || '').toString().trim().replace(/[\/\\?%*:|"<>]/g, '-');
}

async function findOrCreateFolder(parentId, name) {
  const drive = await getDriveClient();
  const cleanName = sanitize(name);
  const escaped = cleanName.replace(/'/g, "\\'");
  const { data } = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
  });
  if (data.files?.length) return data.files[0].id;

  const { data: created } = await drive.files.create({
    requestBody: { name: cleanName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return created.id;
}

async function ensureProjectFolderStructure(rootFolderId, projectId, customerName) {
  // Project ID itself already contains the full company name (current
  // format), so prefixing it again here just duplicated it in the folder
  // name -- just use the ID alone now. customerName param kept for
  // backward compatibility with existing call sites, just unused for naming.
  const projectFolderId = await findOrCreateFolder(rootFolderId, projectId);

  const subFolders = ['Drawings', 'Bill of Quantity', 'Bill of Quantity with Costing'];
  const subFolderIds = {};
  for (const name of subFolders) {
    subFolderIds[name] = await findOrCreateFolder(projectFolderId, name);
  }
  return { projectFolderId, subFolderIds };
}

async function ensureNestedFolderPath(rootFolderId, pathSegments) {
  let currentParent = rootFolderId;
  for (const segment of pathSegments) {
    if (!segment) continue;
    currentParent = await findOrCreateFolder(currentParent, segment);
  }
  return currentParent;
}

// Backend's own public origin, used to build links back into
// /api/driveFile/:fileId (see routes/driveFiles.js) — override via env var
// if the Cloud Run URL ever changes; defaults to the same URL already
// hardcoded as GAS_URL in index.html, so no new secret is introduced.
const BACKEND_PUBLIC_URL = (process.env.BACKEND_PUBLIC_URL || 'https://abps-backend-244281871074.asia-south1.run.app').replace(/\/$/, '');

// uploadFile — files are created WITHOUT any public sharing permission.
// Previously every generated document (BOQs, PRNs, POs, invoices, gate
// entry photos) was shared role:reader/type:anyone — permanent,
// unauthenticated, unrevocable-without-manual-cleanup access to anyone
// who ever obtained the link. The returned `url` now points at this
// app's own authenticated proxy (routes/driveFiles.js) instead of
// Drive's public webViewLink; the file itself stays private to
// DRIVE_OWNER_EMAIL, reachable only through that proxy, which requires a
// valid session token.
async function uploadFile(folderId, buffer, fileName, mimeType) {
  const drive = await getDriveClient();
  const { data: file } = await drive.files.create({
    requestBody: { name: sanitize(fileName), parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });

  return { fileId: file.id, url: `${BACKEND_PUBLIC_URL}/api/driveFile/${file.id}` };
}

// listFilesInFolder — ground truth for "what's actually in this Drive
// folder right now", used where a list must reflect files added or
// deleted directly in Drive, not just what our own DB happens to record.
// `url` is our own authenticated proxy (see uploadFile's comment) rather
// than Drive's webViewLink — these files carry no public Drive sharing
// permission, so the native link would just 403 for anyone who isn't
// signed into DRIVE_OWNER_EMAIL's own Google account.
async function listFilesInFolder(folderId) {
  const drive = await getDriveClient();
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 200,
  });
  return (data.files || []).map(f => ({ ...f, url: `${BACKEND_PUBLIC_URL}/api/driveFile/${f.id}` }));
}

async function deleteFile(fileId) {
  const drive = await getDriveClient();
  try {
    await drive.files.delete({ fileId });
  } catch (err) {
    // Best-effort — if it's already gone or something else is odd,
    // don't let cleanup itself throw and mask the original error.
    console.error(`deleteFile(${fileId}) failed (non-fatal, best-effort cleanup):`, err.message);
  }
}

module.exports = { getDriveClient, findOrCreateFolder, ensureProjectFolderStructure, ensureNestedFolderPath, uploadFile, deleteFile, listFilesInFolder };
