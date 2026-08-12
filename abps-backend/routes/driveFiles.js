// ═══════════════════════════════════════════════════════════════════════
// routes/driveFiles.js — authenticated proxy for Drive files uploaded via
// lib/drive.js's uploadFile(). Those files carry no public Drive sharing
// permission (see the comment at uploadFile itself) — this route is the
// ONLY way to read their bytes, and it requires a valid, unexpired
// session token.
//
// A plain <a href> / window.open() navigation can't send a JSON body or
// a custom header the way apFetch does, so auth here is a ?token=
// query-string parameter instead of requireSession's usual body/header
// check — same session_token values, just carried differently. Mounted
// in server.js BEFORE the requireSession-guarded routers, same reason
// gmailAuth/internal are: app.use('/api', requireSession, ...) runs for
// every /api/* request regardless of path match, so a later-mounted
// router with its own auth scheme would never be reached if it sat
// behind that gate.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('../db');
const { getDriveClient } = require('../lib/drive');

const router = express.Router();

router.get('/driveFile/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const token = req.query.token;
  if (!token) return res.status(401).send('Missing session token.');

  try {
    const { rows } = await pool.query(
      `SELECT token_expiry FROM admin_db.users WHERE session_token = $1 AND status = 'Active'`,
      [token]
    );
    if (rows.length === 0) return res.status(401).send('Invalid session.');
    if (!rows[0].token_expiry || new Date(rows[0].token_expiry) < new Date()) {
      return res.status(401).send('Session expired. Please log in again.');
    }

    const drive = await getDriveClient();
    const { data: meta } = await drive.files.get({ fileId, fields: 'name, mimeType' });
    const { data: stream } = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(meta.name || fileId).replace(/"/g, "'")}"`);
    // Internal documents change rarely once generated, but never assume
    // immutable — a QA Revision, PO revision, etc. can regenerate the
    // same logical document under a new fileId, not overwrite this one.
    res.setHeader('Cache-Control', 'private, max-age=300');

    stream.on('error', (err) => {
      console.error(`driveFile stream error for ${fileId}:`, err.message);
      if (!res.headersSent) res.status(502).send('Failed to read file from Drive.');
    });
    stream.pipe(res);
  } catch (err) {
    console.error(`driveFile(${fileId}) error:`, err.message);
    const status = err.code === 404 ? 404 : 500;
    res.status(status).send(status === 404 ? 'File not found.' : 'Failed to load file.');
  }
});

module.exports = router;
