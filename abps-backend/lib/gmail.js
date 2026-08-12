// ═══════════════════════════════════════════════════════════════════════
// lib/gmail.js — replaces GmailApp.search()/getMessages() from code.js.
//
// Refresh tokens for each connected account live in
// admin_db.gmail_connections (see routes/gmailAuth.js for the one-time
// consent flow that populates them) — this supports any number of
// personal or Workspace accounts without env-var sprawl.
// ═══════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { pool } = require('../db');

async function getGmailClient(userEmail) {
  const { rows } = await pool.query(
    `SELECT refresh_token FROM admin_db.gmail_connections WHERE email = $1 AND status = 'Active'`,
    [userEmail]
  );
  if (rows.length === 0) {
    throw new Error(`No active Gmail connection for ${userEmail}. Visit /api/gmailAuth/connect to authorize this account first.`);
  }

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: rows[0].refresh_token });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Returns every account with an Active connection — used by the polling
// route instead of a static CONNECTED_EMAILS env var, so newly connected
// accounts are picked up automatically without a redeploy.
async function listConnectedAccounts() {
  const { rows } = await pool.query(`SELECT email FROM admin_db.gmail_connections WHERE status = 'Active'`);
  return rows.map(r => r.email);
}

// Fetches unread messages, in small sequential batches (matching
// code.js's comment about avoiding runtime exceptions from processing
// too many at once) — returns plain {id, subject, from, body, date}.
async function fetchUnreadMessages(userEmail, maxResults = 10) {
  const gmail = await getGmailClient(userEmail);

  const { data: list } = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread',
    maxResults,
  });
  if (!list.messages?.length) return [];

  const messages = [];
  for (const m of list.messages) {
    const { data: full } = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const headers = full.payload.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let bodyText = '';
    const extractText = (part) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.parts) {
        part.parts.forEach(extractText);
      }
    };
    extractText(full.payload);

    messages.push({
      messageId: m.id,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      date: getHeader('Date'),
      body: bodyText,
    });
  }
  return messages;
}

async function markAsRead(userEmail, messageId) {
  const gmail = await getGmailClient(userEmail);
  await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: ['UNREAD'] } });
}

// Searches Sent mail matching a query (used for the outbound offer scan —
// same "in:sent subject:(quote OR offer...)" pattern as
// collectAndForwardOutboundOffers in code.js), with a lookback window
// instead of "unread" since sent mail doesn't have a read/unread signal
// that means anything here.
async function fetchSentMessagesMatching(userEmail, query, maxResults = 50) {
  const gmail = await getGmailClient(userEmail);

  const { data: list } = await gmail.users.threads.list({ userId: 'me', q: query, maxResults });
  if (!list.threads?.length) return [];

  const messages = [];
  for (const t of list.threads) {
    const { data: thread } = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'full' });
    const msgs = thread.messages || [];
    if (msgs.length === 0) continue;
    const latest = msgs[msgs.length - 1]; // latest message in thread, matching code.js
    const headers = latest.payload.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let bodyText = '';
    const extractText = (part) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.parts) {
        part.parts.forEach(extractText);
      }
    };
    extractText(latest.payload);

    messages.push({
      messageId: latest.id,
      threadId: t.id,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      internalDate: latest.internalDate,
      body: bodyText.slice(0, 1500), // matches the 1500-char cap in code.js
    });
  }
  return messages;
}

module.exports = { fetchUnreadMessages, fetchSentMessagesMatching, markAsRead, listConnectedAccounts };
