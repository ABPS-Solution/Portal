// ═══════════════════════════════════════════════════════════════════════
// routes/gmailAuth.js — one-time OAuth consent flow to connect each
// Gmail account (personal or Workspace) that should be polled for
// inbound leads. Each account's owner (or an admin) visits /connect
// once, approves read-only Gmail access, and the resulting refresh
// token is stored in admin_db.gmail_connections — from then on,
// fetchAndProcessInboundEmailLeads can read that inbox indefinitely
// without any further manual step, until the token is revoked.
//
// This is the standard OAuth pattern for exactly this situation:
// personal Gmail accounts have no delegation mechanism, so each one
// needs its own one-time explicit consent.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { google } = require('googleapis');
const { pool } = require('../db');
const { requireSession, requirePermission } = require('../auth');
const { syncLiveRow } = require('../lib/liveSync');

const router = express.Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_OAUTH_CLIENT_ID,
    process.env.GMAIL_OAUTH_CLIENT_SECRET,
    process.env.GMAIL_OAUTH_REDIRECT_URI // e.g. https://your-cloud-run-url/api/gmailAuth/callback
  );
}

// GET /api/gmailAuth/connect?secret=... — a browser GET navigation, so it
// can't carry a JSON sessionToken body the way requireSession expects.
// Gated instead by a shared secret (GMAIL_CONNECT_SECRET) known only to
// admins — share the link as: https://<your-url>/api/gmailAuth/connect?secret=...&state=<admin-email>
// The 'state' param is echoed back by Google and used to record who
// initiated the connection, for the audit trail in gmail_connections.
router.get('/gmailAuth/connect', (req, res) => {
  if (!process.env.GMAIL_CONNECT_SECRET || req.query.secret !== process.env.GMAIL_CONNECT_SECRET) {
    return res.status(403).send('Invalid or missing secret.');
  }
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',  // required to get a refresh_token, not just an access_token
    prompt: 'consent',       // forces the consent screen every time, so a refresh_token is
                              // reissued even if this Google account previously authorized us
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'],
    state: req.query.state || '',
  });
  res.redirect(url);
});

// GET /api/gmailAuth/callback — Google redirects here after consent.
// Exchanges the auth code for tokens, identifies which email just
// authorized, and upserts the refresh token.
router.get('/gmailAuth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code.');

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      // Happens if the account already granted consent before and Google
      // didn't reissue a refresh_token — prompt:'consent' above should
      // prevent this, but surface a clear message if it still happens.
      return res.status(400).send('No refresh token returned. Try disconnecting this app at myaccount.google.com/permissions and reconnecting.');
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();
    const connectedEmail = profile.email.toLowerCase();

    await pool.query(
      `INSERT INTO admin_db.gmail_connections (email, refresh_token, connected_by, status)
       VALUES ($1, $2, $3, 'Active')
       ON CONFLICT (email) DO UPDATE SET refresh_token = $2, status = 'Active', connected_at = now()`,
      [connectedEmail, tokens.refresh_token, req.query.state || null]
    );
    syncLiveRow('gmail_connections', connectedEmail);

    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
      <h2>✅ Connected: ${connectedEmail}</h2>
      <p>This inbox will now be polled for inbound leads. You can close this tab.</p>
    </body></html>`);
  } catch (err) {
    console.error('gmailAuth callback error:', err);
    res.status(500).send('Connection failed: ' + err.message);
  }
});

// fetchConnectedGmailAccounts — admin view of what's currently connected.
// fetchConnectedGmailAccounts / revokeGmailConnection ARE normal JSON
// apFetch calls from the frontend admin panel, so they need requireSession
// applied explicitly here (the router itself is mounted without it, since
// /connect and /callback above are plain browser navigations).
router.post('/fetchConnectedGmailAccounts', requireSession, requirePermission('perm_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, connected_by, connected_at, last_used_at, status FROM admin_db.gmail_connections ORDER BY connected_at DESC`
    );
    res.json({ success: true, accounts: rows });
  } catch (err) {
    console.error('fetchConnectedGmailAccounts error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/revokeGmailConnection', requireSession, requirePermission('perm_admin'), async (req, res) => {
  const { email } = req.body;
  try {
    await pool.query(`UPDATE admin_db.gmail_connections SET status = 'Revoked' WHERE email = $1`, [email]);
    syncLiveRow('gmail_connections', email);
    res.json({ success: true });
  } catch (err) {
    console.error('revokeGmailConnection error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
