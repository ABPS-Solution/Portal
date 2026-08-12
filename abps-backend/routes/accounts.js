// ═══════════════════════════════════════════════════════════════════════
// routes/accounts.js — Tour Expense Tracker (Accounts department).
// Every balance-touching action locks the employee row with FOR UPDATE
// inside a transaction before reading/updating balance, so two people
// submitting for the same employee at nearly the same moment can't
// silently overwrite each other (see db.js withTransaction comment).
// Single permission (perm_tour_expense) gates the whole module.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { syncLiveRow } = require('../lib/liveSync');

const router = express.Router();

// ── List Departments (for the Add Employee dropdown) ───────────────────
router.post('/accounts/listTourDepartments', requirePermission('perm_tour_expense'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT name FROM admin_db.departments ORDER BY name`);
    res.json({ success: true, departments: rows.map(r => r.name) });
  } catch (err) {
    console.error('listTourDepartments error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Add Employee ──────────────────────────────────────────────────────
router.post('/accounts/addTourEmployee', requirePermission('perm_tour_expense'), async (req, res) => {
  const { employeeName, departmentName } = req.body;
  if (!employeeName) return res.status(400).json({ success: false, error: 'employeeName is required.' });

  try {
    const { rows: [emp] } = await pool.query(
      `INSERT INTO accounts.tour_employees (employee_name, department_name, balance)
       VALUES ($1, $2, 0) RETURNING employee_id`,
      [employeeName, departmentName || null]
    );
    await writeAuditLog(req.user.email, req.body.operatorName, 'TourEmployees', 'CREATE', emp.employee_id,
      `Added tour expense employee "${employeeName}".`);
    res.json({ success: true, employeeId: emp.employee_id });
    syncLiveRow('tour_employees', emp.employee_id);
  } catch (err) {
    console.error('addTourEmployee error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Search Employees (list, optionally filtered by name) ───────────────
router.post('/accounts/searchTourEmployees', requirePermission('perm_tour_expense'), async (req, res) => {
  const { searchTerm } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT employee_id, employee_name, department_name, balance
       FROM accounts.tour_employees
       WHERE status = 'Active' AND ($1::text IS NULL OR employee_name ILIKE '%' || $1 || '%')
       ORDER BY employee_name`,
      [searchTerm || null]
    );
    res.json({ success: true, employees: rows });
  } catch (err) {
    console.error('searchTourEmployees error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Get one employee's detail + their pending (Unchecked) vouchers ─────
router.post('/accounts/getTourEmployeeDetail', requirePermission('perm_tour_expense'), async (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ success: false, error: 'employeeId is required.' });

  try {
    const { rows: [employee] } = await pool.query(
      `SELECT employee_id, employee_name, department_name, balance FROM accounts.tour_employees WHERE employee_id = $1`,
      [employeeId]
    );
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found.' });

    const { rows: pendingVouchers } = await pool.query(
      `SELECT voucher_id, customer_name, purpose_of_visit, voucher_amount, created_date
       FROM accounts.tour_vouchers WHERE employee_id = $1 AND status = 'Unchecked' ORDER BY created_date DESC`,
      [employeeId]
    );
    res.json({ success: true, employee, pendingVouchers });
  } catch (err) {
    console.error('getTourEmployeeDetail error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Pay Advance ──────────────────────────────────────────────────────
router.post('/accounts/payTourAdvance', requirePermission('perm_tour_expense'), async (req, res) => {
  const { employeeId, amount } = req.body;
  const numAmount = Number(amount);
  if (!employeeId || !numAmount || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'employeeId and a positive amount are required.' });
  }

  try {
    const newBalance = await withTransaction(async (client) => {
      const { rows: [emp] } = await client.query(
        `SELECT balance FROM accounts.tour_employees WHERE employee_id = $1 FOR UPDATE`, [employeeId]
      );
      if (!emp) throw new Error('Employee not found.');

      await client.query(
        `INSERT INTO accounts.tour_advances (employee_id, amount) VALUES ($1, $2)`, [employeeId, numAmount]
      );
      const updatedBalance = Number(emp.balance) + numAmount;
      await client.query(`UPDATE accounts.tour_employees SET balance = $1 WHERE employee_id = $2`, [updatedBalance, employeeId]);
      return updatedBalance;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'TourAdvances', 'CREATE', employeeId,
      `Paid advance of ${numAmount} to employee ${employeeId}. New balance: ${newBalance}.`);
    res.json({ success: true, newBalance });
    syncLiveRow('tour_employees', employeeId);
  } catch (err) {
    console.error('payTourAdvance error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Add Voucher ──────────────────────────────────────────────────────
router.post('/accounts/addTourVoucher', requirePermission('perm_tour_expense'), async (req, res) => {
  const { employeeId, customerName, purposeOfVisit, voucherAmount } = req.body;
  const numAmount = Number(voucherAmount);
  if (!employeeId || !customerName || !numAmount || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'employeeId, customerName, and a positive voucherAmount are required.' });
  }

  try {
    const { voucherId, newBalance } = await withTransaction(async (client) => {
      const { rows: [emp] } = await client.query(
        `SELECT balance FROM accounts.tour_employees WHERE employee_id = $1 FOR UPDATE`, [employeeId]
      );
      if (!emp) throw new Error('Employee not found.');

      const { rows: [voucher] } = await client.query(
        `INSERT INTO accounts.tour_vouchers (employee_id, customer_name, purpose_of_visit, voucher_amount, status)
         VALUES ($1, $2, $3, $4, 'Unchecked') RETURNING voucher_id`,
        [employeeId, customerName, purposeOfVisit || null, numAmount]
      );
      const updatedBalance = Number(emp.balance) - numAmount;
      await client.query(`UPDATE accounts.tour_employees SET balance = $1 WHERE employee_id = $2`, [updatedBalance, employeeId]);
      return { voucherId: voucher.voucher_id, newBalance: updatedBalance };
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'TourVouchers', 'CREATE', voucherId,
      `Created voucher of ${numAmount} for employee ${employeeId}. New balance: ${newBalance}.`);
    res.json({ success: true, voucherId, newBalance });
    syncLiveRow('tour_employees', employeeId);
    syncLiveRow('tour_vouchers', voucherId);
  } catch (err) {
    console.error('addTourVoucher error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Search Vouchers (list all Unchecked vouchers) ───────────────────────
router.post('/accounts/searchTourVouchers', requirePermission('perm_tour_expense'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.voucher_id, v.created_date, e.department_name, e.employee_name, v.customer_name,
              v.purpose_of_visit, v.voucher_amount
       FROM accounts.tour_vouchers v JOIN accounts.tour_employees e ON e.employee_id = v.employee_id
       WHERE v.status = 'Unchecked' ORDER BY v.created_date`
    );
    res.json({ success: true, vouchers: rows });
  } catch (err) {
    console.error('searchTourVouchers error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Check Voucher ────────────────────────────────────────────────────
// Balance adjustment = voucher_amount - checked_amount, added back to
// balance (voucher creation already subtracted the original voucher_amount).
router.post('/accounts/checkTourVoucher', requirePermission('perm_tour_expense'), async (req, res) => {
  const { voucherId, checkedAmount } = req.body;
  const numChecked = Number(checkedAmount);
  if (!voucherId || checkedAmount === undefined || checkedAmount === null || isNaN(numChecked) || numChecked < 0) {
    return res.status(400).json({ success: false, error: 'voucherId and a valid non-negative checkedAmount are required.' });
  }

  try {
    const { newBalance, employeeId } = await withTransaction(async (client) => {
      const { rows: [voucher] } = await client.query(
        `SELECT employee_id, voucher_amount, status FROM accounts.tour_vouchers WHERE voucher_id = $1 FOR UPDATE`, [voucherId]
      );
      if (!voucher) throw new Error('Voucher not found.');
      if (voucher.status !== 'Unchecked') throw new Error('This voucher has already been checked.');

      const { rows: [emp] } = await client.query(
        `SELECT balance FROM accounts.tour_employees WHERE employee_id = $1 FOR UPDATE`, [voucher.employee_id]
      );
      if (!emp) throw new Error('Employee not found.');

      const adjustment = Number(voucher.voucher_amount) - numChecked;
      const updatedBalance = Number(emp.balance) + adjustment;

      await client.query(
        `UPDATE accounts.tour_vouchers SET checked_amount = $1, status = 'Checked', checked_date = now() WHERE voucher_id = $2`,
        [numChecked, voucherId]
      );
      await client.query(`UPDATE accounts.tour_employees SET balance = $1 WHERE employee_id = $2`, [updatedBalance, voucher.employee_id]);
      return { newBalance: updatedBalance, employeeId: voucher.employee_id };
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'TourVouchers', 'UPDATE', voucherId,
      `Checked voucher ${voucherId} at ${numChecked}. New balance: ${newBalance}.`);
    res.json({ success: true, newBalance });
    syncLiveRow('tour_employees', employeeId);
    syncLiveRow('tour_vouchers', voucherId);
  } catch (err) {
    console.error('checkTourVoucher error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
