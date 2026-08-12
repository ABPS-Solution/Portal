// ═══════════════════════════════════════════════════════════════════════
// lib/mailer.js — replaces GmailApp.sendEmail() from code.js. Cloud Run
// has no direct Gmail-as-the-logged-in-user equivalent, so this sends
// via nodemailer's Gmail OAuth2 transport, reusing whichever account is
// registered in admin_db.gmail_connections as the sender (set
// DIGEST_SENDER_EMAIL to pick which one). That account needs the
// gmail.send scope in addition to gmail.readonly — see the note in
// routes/gmailAuth.js if you need to re-consent with the extra scope.
// ═══════════════════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { pool } = require('../db');

async function sendEmail({ to, subject, html }) {
  const senderEmail = process.env.DIGEST_SENDER_EMAIL;
  if (!senderEmail) throw new Error('DIGEST_SENDER_EMAIL environment variable is not set.');

  const { rows } = await pool.query(
    `SELECT refresh_token FROM admin_db.gmail_connections WHERE email = $1 AND status = 'Active'`,
    [senderEmail]
  );
  if (rows.length === 0) {
    throw new Error(`No active Gmail connection for ${senderEmail}. Connect it via /api/gmailAuth/connect first (with gmail.send scope).`);
  }

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: rows[0].refresh_token });
  const { token: accessToken } = await oauth2Client.getAccessToken();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: senderEmail,
      clientId: process.env.GMAIL_OAUTH_CLIENT_ID,
      clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
      refreshToken: rows[0].refresh_token,
      accessToken,
    },
  });

  await transporter.sendMail({ from: senderEmail, to, subject, html });
}

module.exports = { sendEmail };
