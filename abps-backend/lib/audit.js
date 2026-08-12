// ═══════════════════════════════════════════════════════════════════════
// lib/audit.js — ports writeAuditLog() from code.js. Every module's
// routes call this after a successful write, same as Apps Script did.
// ═══════════════════════════════════════════════════════════════════════
const { pool } = require('../db');

async function writeAuditLog(userEmail, engineerName, entityModified, actionPerformed, recordId, summary, remarks) {
  try {
    await pool.query(
      `INSERT INTO admin_db.audit_log
         (user_context, engineer_name, entity_modified, action_performed, record_id_reference, core_summary, operational_remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userEmail, engineerName || null, entityModified, actionPerformed, recordId?.toString() || null,
       summary || null, remarks ? JSON.stringify(remarks) : null]
    );
  } catch (err) {
    // Audit log failures should never block the primary operation —
    // matches the "best effort" behavior of the Apps Script version,
    // but we log loudly so it's visible in Cloud Logging.
    console.error('writeAuditLog failed:', err);
  }
}

module.exports = { writeAuditLog };
