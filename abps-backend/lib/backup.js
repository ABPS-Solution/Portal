// ═══════════════════════════════════════════════════════════════════════
// lib/backup.js — Daily spreadsheet backup to Drive folders.
//
// Replaces dailyPortalBackup.js, the old Google Apps Script version
// (DriveApp, ScriptApp.getOAuthToken(), PropertiesService) — those APIs
// only exist inside an actual Apps Script execution context, so that
// script stopped working entirely the day the old Apps Script project
// was decommissioned during migration. There has been no automated
// spreadsheet backup since then. This is the replacement, built on the
// same Drive OAuth pattern as lib/drive.js, triggered by Cloud Scheduler
// instead of an Apps Script time-driven trigger.
// ═══════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { Readable } = require('stream');
const { pool } = require('../db');
const { SPREADSHEET_IDS } = require('./sheetsRegistry');

const BACKUP_FOLDER_IDS = {
  ADMIN:      '1ok-21u94OFUDyEboL3bsn9tST2TlBzJn',
  MARKETING:  '1kD7RXAXYjrxmed9SpIPde5nYYg2cdGYa',
  DESIGN:     '1Ih0ThvmGXH_a7YM6OBKyKwCexp59S5cF',
  PURCHASE:   '1MIhediqcOtqIDGe80a1zXlkB5PSKLacI',
  INVENTORY:  '1bly0trXriVxo-NhOvArVVKiXHWJEWOlG',
  PRODUCTION: '1u8IqwvR9YTjrz-pWhE0XtbRdBUZvSZbQ',
  ACCOUNTS:   '1oZpMgClUFZ0aD2xVsVeQn7LR0IsLZexk',
};

async function getDriveClient() {
  const ownerEmail = process.env.DRIVE_OWNER_EMAIL;
  if (!ownerEmail) throw new Error('DRIVE_OWNER_EMAIL environment variable is not set.');
  const { rows } = await pool.query(
    `SELECT refresh_token FROM admin_db.gmail_connections WHERE email = $1 AND status = 'Active'`,
    [ownerEmail]
  );
  if (rows.length === 0) {
    throw new Error(`No active connection for ${ownerEmail}. Visit /api/gmailAuth/connect to authorize this account first.`);
  }
  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: rows[0].refresh_token });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function backupOneWorkbook(sheetKey, spreadsheetId, folderId, dateStr, report) {
  if (!spreadsheetId || !folderId) {
    report.skipped.push({ sheet: sheetKey, reason: 'Missing spreadsheet ID or backup folder ID' });
    return;
  }
  try {
    const drive = await getDriveClient();
    const fileName = `ABPS ${sheetKey} Database_${dateStr}.xlsx`;

    const exportRes = await drive.files.export(
      { fileId: spreadsheetId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(exportRes.data);

    // Remove any existing backup with today's filename first — prevents
    // duplicates if this ever runs twice in a day (matches the old
    // script's same safeguard).
    const { data: existing } = await drive.files.list({
      q: `'${folderId}' in parents and name = '${fileName}' and trashed = false`,
      fields: 'files(id)',
    });
    for (const f of existing.files || []) {
      await drive.files.update({ fileId: f.id, requestBody: { trashed: true } });
    }

    await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Readable.from(buffer) },
      fields: 'id',
    });
    report.backedUp.push({ sheet: sheetKey, fileName });
  } catch (err) {
    report.errors.push({ sheet: sheetKey, error: err.message });
  }
}

async function runDailyBackup() {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // yyyy-mm-dd in IST
  const report = { backedUp: [], skipped: [], errors: [] };
  for (const sheetKey of Object.keys(SPREADSHEET_IDS)) {
    await backupOneWorkbook(sheetKey, SPREADSHEET_IDS[sheetKey], BACKUP_FOLDER_IDS[sheetKey], dateStr, report);
  }
  return report;
}

module.exports = { runDailyBackup };
