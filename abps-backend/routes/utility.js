// ═══════════════════════════════════════════════════════════════════════
// routes/utility.js — small "feed a dropdown" / "refresh permissions"
// endpoints that don't belong to one specific business module but that
// the frontend calls constantly. Ports: getEngineers,
// getStoreOperatorsList, getUniqueCompaniesList, getUniqueQualifications,
// getUniqueCityStatePayloadTree, pullLiveActiveProjectCodes,
// fetchDrawingDocumentsList, getSessionPermissions.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('../db');
const { mapPermissionsForFrontend } = require('../lib/permMap');

const router = express.Router();

// getSessionPermissions — index.html explicitly re-fetches this on every
// page load (see its own comment: "permissions are re-fetched from the
// server on every subsequent page load"), so this is not optional.
// requireSession has already loaded req.user with all perm_* columns —
// this route just reshapes that into the {permissions, isAdmin, ...}
// envelope the frontend expects.
router.post('/getSessionPermissions', async (req, res) => {
  const permissions = mapPermissionsForFrontend(req.user);
  res.json({
    success: true,
    permissions,
    isAdmin: !!req.user.perm_admin,
    firstName: req.user.first_name,
    lastName: req.user.last_name,
    email: req.user.email,
  });
});

router.post('/getEngineers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.email, u.first_name, u.last_name FROM admin_db.users u
       JOIN admin_db.departments d ON d.department_id = u.department_id
       WHERE d.name = 'Marketing' AND u.status = 'Active' ORDER BY u.first_name`
    );
    // email is what actually gets stored/filtered on (engineer_name columns
    // are FK'd to admin_db.users.email) — name is display-only. Every
    // dropdown/checkbox built from this list must submit .email as the
    // value and show .name as the label, never the reverse.
    res.json({ success: true, engineers: rows.map(r => ({ email: r.email, name: `${r.first_name} ${r.last_name}` })) });
  } catch (err) {
    console.error('getEngineers error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/getStoreOperatorsList', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.email, u.first_name, u.last_name FROM admin_db.users u
       JOIN admin_db.departments d ON d.department_id = u.department_id
       WHERE d.name IN ('Store', 'Admin') AND u.status = 'Active' ORDER BY u.first_name`
    );
    res.json({ success: true, operators: rows.map(r => `${r.first_name} ${r.last_name}`) });
  } catch (err) {
    console.error('getStoreOperatorsList error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/getUniqueCompaniesList', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT DISTINCT company_name FROM marketing.companies ORDER BY company_name`);
    // Frontend's dropdown builder (triggerCompanyDropdownArrayFetch) reads
    // item.companyValue / item.displayLabel — plain strings here would
    // silently render as "undefined" option text/value.
    res.json({ success: true, companies: rows.map(r => ({ companyValue: r.company_name, displayLabel: r.company_name })) });
  } catch (err) {
    console.error('getUniqueCompaniesList error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/getUniqueQualifications', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT type_of_customer FROM marketing.companies WHERE type_of_customer IS NOT NULL AND type_of_customer != ''`
    );
    res.json({ success: true, quals: rows.map(r => r.type_of_customer) });
  } catch (err) {
    console.error('getUniqueQualifications error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Returns a nested { state: [cities] } tree, matching the "payload tree"
// shape implied by the original action name — used to cascade a
// state-dropdown into a filtered city-dropdown on the search screen.
router.post('/getUniqueCityStatePayloadTree', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT country, state, city FROM marketing.companies
       WHERE country IS NOT NULL AND country != '' ORDER BY country, state, city`
    );
    // Frontend expects a 3-level tree: Country -> State -> [Cities].
    // The old version built only State -> [Cities], which made the UI
    // render states as countries and array indices as state names.
    const tree = {};
    rows.forEach(r => {
      const country = (r.country || '').trim();
      const state = (r.state || '').trim();
      if (!country) return;
      if (!tree[country]) tree[country] = {};
      if (state) {
        if (!tree[country][state]) tree[country][state] = [];
        if (r.city && !tree[country][state].includes(r.city)) tree[country][state].push(r.city);
      }
    });
    res.json({ success: true, tree });
  } catch (err) {
    console.error('getUniqueCityStatePayloadTree error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pullLiveActiveProjectCodes', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT project_id, company_name FROM project.projects WHERE project_status = 'Active' ORDER BY project_id`);
    const projectMeta = {};
    rows.forEach(r => { projectMeta[r.project_id] = { companyName: r.company_name }; });
    res.json({ success: true, projects: rows.map(r => r.project_id), projectMeta });
  } catch (err) {
    console.error('pullLiveActiveProjectCodes error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// sendWeeklyAdminDigest — ported from code.js: last 7 days of audit_log,
// grouped by action, emailed to every Active Admin-department user.
// Exported separately (like pollAllInboxes in marketing.js) so
// routes/internal.js can trigger it on a schedule (recommend Monday
// 8-9am, matching the original's intended trigger window).
async function sendWeeklyAdminDigest() {
  const { sendEmail } = require('../lib/mailer');

  const { rows: adminUsers } = await pool.query(
    `SELECT u.email FROM admin_db.users u JOIN admin_db.departments d ON d.department_id = u.department_id
     WHERE d.name = 'Admin' AND u.status = 'Active'`
  );
  if (adminUsers.length === 0) return { sent: 0, note: 'No active Admin users found.' };

  const { rows: recentAudit } = await pool.query(
    `SELECT action_performed, COUNT(*) AS cnt FROM admin_db.audit_log
     WHERE ts >= now() - interval '7 days' GROUP BY action_performed ORDER BY cnt DESC`
  );
  const { rows: [{ total }] } = await pool.query(
    `SELECT COUNT(*) AS total FROM admin_db.audit_log WHERE ts >= now() - interval '7 days'`
  );

  const tableRows = recentAudit.map(r =>
    `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0">${r.action_performed}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${r.cnt}</td></tr>`
  ).join('');

  const html = `<div style="font-family:Arial,sans-serif;font-size:13px;color:#1a2332">
    <h2 style="color:#0056b3">ABPS Portal — Weekly Activity Digest</h2>
    <p>Period: last 7 days | Total audit events: <strong>${total}</strong></p>
    <table style="border-collapse:collapse;width:100%;max-width:500px">
      <thead><tr style="background:#0056b3;color:#fff">
        <th style="padding:8px 10px;text-align:left">Action</th>
        <th style="padding:8px 10px;text-align:center">Count</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="color:#6b7a8d;font-size:11px;margin-top:20px">Auto-generated by ABPS Portal. Do not reply.</p>
  </div>`;

  for (const admin of adminUsers) {
    await sendEmail({ to: admin.email, subject: 'ABPS Portal — Weekly Activity Digest', html });
  }
  return { sent: adminUsers.length };
}

router.post('/sendWeeklyAdminDigest', async (req, res) => {
  if (!req.user.perm_admin) return res.status(403).json({ success: false, error: 'Admin only.' });
  try {
    const result = await sendWeeklyAdminDigest();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('sendWeeklyAdminDigest error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.sendWeeklyAdminDigest = sendWeeklyAdminDigest; // exposed for the internal scheduler route