// ═══════════════════════════════════════════════════════════════════════
// routes/internal.js — endpoints meant to be called by Cloud Scheduler
// (a machine on a timer), not a logged-in user, so requireSession's
// "expects a sessionToken in the JSON body" check doesn't apply here.
// Protected instead by a shared secret header, same pattern as the
// Gmail connect link — set INTERNAL_TRIGGER_SECRET as a Cloud Run env
// var and configure the Scheduler job to send it as a header.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const marketingRouter = require('./marketing');
const utilityRouter = require('./utility');
const { pollAllInboxes, pollOutboundOffers } = marketingRouter;
const { sendWeeklyAdminDigest } = utilityRouter;

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const provided = req.headers['x-internal-secret'];
  if (!process.env.INTERNAL_TRIGGER_SECRET || provided !== process.env.INTERNAL_TRIGGER_SECRET) {
    return res.status(403).json({ success: false, error: 'Invalid or missing internal trigger secret.' });
  }
  next();
}

// POST /api/internal/pollInboundEmails — Cloud Scheduler hits this on a
// timer (recommend every 15 min) to check for new inbound leads.
router.post('/internal/pollInboundEmails', requireInternalSecret, async (req, res) => {
  try {
    const results = await pollAllInboxes('scheduler@internal');
    console.log('Scheduled inbound poll:', results);
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('Scheduled inbound poll failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/internal/pollOutboundOffers — separate, lower-frequency
// schedule recommended (e.g. every 30-60 min) since this is a
// record-keeping scan of Sent mail, not a lead you need to act on fast.
router.post('/internal/pollOutboundOffers', requireInternalSecret, async (req, res) => {
  try {
    const results = await pollOutboundOffers('scheduler@internal');
    console.log('Scheduled outbound poll:', results);
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('Scheduled outbound poll failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/internal/sendWeeklyDigest — recommend scheduling Monday 8-9am,
// matching the intended trigger window in code.js's own comment.
router.post('/internal/sendWeeklyDigest', requireInternalSecret, async (req, res) => {
  try {
    const result = await sendWeeklyAdminDigest();
    console.log('Scheduled weekly digest:', result);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Scheduled weekly digest failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
