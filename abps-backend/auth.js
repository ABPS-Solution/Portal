// ═══════════════════════════════════════════════════════════════════════
// auth.js — merged: session middleware (requireSession, requirePermission)
// + login routes (googleLogin, pullGlobalPersonnelDirectory) in one file.
//
// Ports: handleGoogleLogin(), verifyGoogleToken(), and the token-check
// block at the top of doPost() from code.js.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('./db');
const { mapPermissionsForFrontend } = require('./lib/permMap');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const SESSION_TTL_HOURS = 12; // matches your 12hr scheduled DB uptime window

const UNAUTHENTICATED_ACTIONS = new Set([
  'googleLogin',
  'pullGlobalPersonnelDirectory',
]);

// ── Middleware ─────────────────────────────────────────────────────────

async function requireSession(req, res, next) {
  const action = req.body?.action || req.path;
  if (UNAUTHENTICATED_ACTIONS.has(action)) return next();

  const sessionToken = req.body?.sessionToken || req.headers['x-session-token'];
  if (!sessionToken) {
    return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', error: 'No session token provided.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT email, first_name, last_name, department_id, token_expiry, perm_admin,
              perm_item_code_access, perm_create_boq, perm_authorize_boq, perm_manufacturing_clearance,
              perm_update_boq, perm_authorize_boq_update, perm_upload_drawings, perm_design_dashboard,
              perm_purchase_request_note, perm_material_list_purchase, perm_create_rm_po,
              perm_authorize_rm_po, perm_search_rm_po, perm_pps_tracking, perm_reserve_store_stock,
              perm_authorize_prn, perm_revise_prn, perm_authorize_prn_revision,
              perm_revise_rm_po, perm_authorize_rm_po_revision,
              perm_card_details, perm_search_company, perm_search_status, perm_search_qualification,
              perm_search_city_state, perm_search_tasks, perm_dispatch_bill, perm_commissioning_report, perm_purchase_order, perm_email_leads,
              perm_gate_entry, perm_store_entry_and_grn, perm_qa_check, perm_store_inward_rejected,
              perm_create_store_ticket, perm_approve_store_tickets, perm_live_spare_stock, perm_approve_job_card_increase, perm_search_store_tickets,
              perm_add_finished_goods_store, perm_live_fg_stock, perm_live_rm_stock,
              perm_expected_deliveries, perm_marketing_dashboard, perm_purchase_dashboard, perm_store_dashboard,
              perm_production_dashboard, perm_job_card_letterhead, perm_tour_expense, perm_project_status,
              perm_project_invoice_generation
       FROM admin_db.users
       WHERE session_token = $1 AND status = 'Active'`,
      [sessionToken]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', error: 'Invalid session.' });
    }

    const user = rows[0];
    if (!user.token_expiry || new Date(user.token_expiry) < new Date()) {
      return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', error: 'Session expired.' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('requireSession error:', err);
    return res.status(500).json({ success: false, error: 'Auth check failed.' });
  }
}

// Usage: requirePermission('perm_authorize_boq') as a route-level guard,
// same shape as ACTION_PERMISSIONS lookups in code.js.
function requirePermission(permColumn) {
  const permColumns = Array.isArray(permColumn) ? permColumn : [permColumn];
  return (req, res, next) => {
    if (!req.user || !permColumns.some(p => req.user[p])) {
      return res.status(403).json({ success: false, error: 'Access Denied: insufficient permissions for this action.' });
    }
    next();
  };
}

// ── Routes ─────────────────────────────────────────────────────────────

router.post('/pullGlobalPersonnelDirectory', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.email, u.first_name, u.last_name, d.name AS department
       FROM admin_db.users u
       JOIN admin_db.departments d ON d.department_id = u.department_id
       WHERE u.status = 'Active'
       ORDER BY d.name, u.first_name`
    );

    const personnelTree = {};
    rows.forEach(r => {
      if (!personnelTree[r.department]) personnelTree[r.department] = [];
      personnelTree[r.department].push(`${r.first_name} ${r.last_name}`.trim());
    });

    res.json({
      success: true,
      departmentsList: Object.keys(personnelTree),
      personnelTree,
    });
  } catch (err) {
    console.error('pullGlobalPersonnelDirectory error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/googleLogin', async (req, res) => {
  const { idToken, requestedEngineer } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.json({ success: false, error: 'Google signature authentication rejected.' });
    }

    const email = payload.email.toLowerCase().trim();

    const { rows } = await pool.query(
      `SELECT * FROM admin_db.users WHERE lower(email) = $1 AND status = 'Active'`,
      [email]
    );
    if (rows.length === 0) {
      return res.json({ success: false, error: 'No active account found for this email. Contact your administrator.' });
    }
    const user = rows[0];

    const fullName = `${user.first_name} ${user.last_name}`.trim();
    if (requestedEngineer && requestedEngineer.trim() !== fullName) {
      return res.json({ success: false, error: 'Selected engineer name does not match the authenticated Google account.' });
    }

    const sessionToken = crypto.randomUUID();
    const expiry = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

    await pool.query(
      `UPDATE admin_db.users SET session_token = $1, token_expiry = $2 WHERE email = $3`,
      [sessionToken, expiry, user.email]
    );

    const permissions = mapPermissionsForFrontend(user);

    res.json({
      success: true,
      sessionToken,
      expires: expiry.toISOString(),
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      permissions,
    });
  } catch (err) {
    console.error('googleLogin error:', err);
    res.status(500).json({ success: false, error: 'Login failed: ' + err.message });
  }
});

module.exports = { router, requireSession, requirePermission };
