// routes/posExtra.js
// New endpoints for tables that had no API routes yet: attendance, expenses,
// pos_bookings, pos_config, audit_log. Written in the same style as pos.js
// so it merges cleanly. Mounted the same way (behind requireApiKey) in index.js.

const express = require('express');
const router = express.Router();
const pool = require('../db/pg');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ==================== ATTENDANCE (daily-rate staff time in/out) ==================== */

router.get('/attendance', async (req, res) => {
  try {
    const { staffId, day, from, to } = req.query;
    const conds = [];
    const params = [];
    if (staffId) { params.push(staffId); conds.push(`staff_id = $${params.length}`); }
    if (day) { params.push(day); conds.push(`day = $${params.length}`); }
    if (from) { params.push(from); conds.push(`day >= $${params.length}`); }
    if (to) { params.push(to); conds.push(`day <= $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(`SELECT * FROM attendance ${where} ORDER BY day DESC, time_in DESC`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching attendance', error: err.message });
  }
});

// UPSERT one attendance record (clock-in creates it, clock-out updates it)
router.post('/attendance', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || 'att_' + Math.random().toString(36).substring(2, 10);
    const staffId = body.staffId || body.staff_id;
    const staffName = body.staffName || body.staff_name || null;
    const day = body.day;
    const timeIn = body.timeIn || body.time_in || null;
    const timeOut = body.timeOut || body.time_out || null;
    const overtimeHours = num(body.overtimeHours ?? body.overtime_hours) ?? 0;

    if (!staffId || !day) {
      return res.status(400).json({ message: 'staffId and day are required' });
    }

    const result = await pool.query(
      `INSERT INTO attendance (id, staff_id, staff_name, day, time_in, time_out, overtime_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         time_in = COALESCE(EXCLUDED.time_in, attendance.time_in),
         time_out = COALESCE(EXCLUDED.time_out, attendance.time_out),
         overtime_hours = EXCLUDED.overtime_hours
       RETURNING *`,
      [id, staffId, staffName, day, timeIn, timeOut, overtimeHours]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error saving attendance', error: err.message });
  }
});

router.delete('/attendance/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Attendance record not found' });
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting attendance', error: err.message });
  }
});

/* ==================== EXPENSES ==================== */

router.get('/expenses', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conds = [];
    const params = [];
    if (from) { params.push(from); conds.push(`date >= $${params.length}`); }
    if (to) { params.push(to); conds.push(`date <= $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(`SELECT * FROM expenses ${where} ORDER BY date DESC`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching expenses', error: err.message });
  }
});

router.post('/expenses', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || 'exp_' + Math.random().toString(36).substring(2, 10);
    const date = body.date;
    const category = body.category || null;
    const amount = num(body.amount) ?? 0;
    const note = body.note || null;

    if (!date) return res.status(400).json({ message: 'date is required' });

    const result = await pool.query(
      `INSERT INTO expenses (id, date, category, amount, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         date = EXCLUDED.date, category = EXCLUDED.category,
         amount = EXCLUDED.amount, note = EXCLUDED.note
       RETURNING *`,
      [id, date, category, amount, note]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error saving expense', error: err.message });
  }
});

router.delete('/expenses/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Expense not found' });
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting expense', error: err.message });
  }
});

/* ==================== POS_BOOKINGS (POS checkout queue — distinct from your website's `bookings` table) ==================== */

router.get('/pos_bookings', async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) { params.push(status); where = 'WHERE status = $1'; }
    const { rows } = await pool.query(`SELECT * FROM pos_bookings ${where} ORDER BY created_at DESC`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching pos_bookings', error: err.message });
  }
});

router.post('/pos_bookings', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || 'bk_' + Math.random().toString(36).substring(2, 10);
    const customerId = body.customerId || body.customer_id || null;
    const customerName = body.customerName || body.customer_name || null;
    const serviceIds = body.serviceIds || body.service_ids || [];
    const serviceNames = body.serviceNames || body.service_names || [];
    const total = num(body.total) ?? 0;
    const status = body.status || 'pending';
    const scheduledFor = body.scheduledFor || body.scheduled_for || null;
    const checkedInAt = body.checkedInAt || body.checked_in_at || null;
    const followDays = num(body.followDays ?? body.follow_days) ?? 30;

    const result = await pool.query(
      `INSERT INTO pos_bookings
        (id, customer_id, customer_name, service_ids, service_names, total, status, scheduled_for, checked_in_at, follow_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         customer_name = EXCLUDED.customer_name,
         service_ids = EXCLUDED.service_ids,
         service_names = EXCLUDED.service_names,
         total = EXCLUDED.total,
         status = EXCLUDED.status,
         scheduled_for = EXCLUDED.scheduled_for,
         checked_in_at = EXCLUDED.checked_in_at,
         follow_days = EXCLUDED.follow_days
       RETURNING *`,
      [id, customerId, customerName, serviceIds.map(String), serviceNames.map(String),
       total, status, scheduledFor, checkedInAt, followDays]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error saving pos_booking', error: err.message });
  }
});

router.delete('/pos_bookings/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM pos_bookings WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Booking not found' });
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting pos_booking', error: err.message });
  }
});

/* ==================== POS_CONFIG (single-row settings blob: salon name, owner pin hash, payroll policy, etc.) ==================== */

router.get('/config', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT data FROM pos_config WHERE id = 'singleton'`);
    res.json(rows[0] ? rows[0].data : {});
  } catch (err) {
    res.status(500).json({ message: 'Error fetching config', error: err.message });
  }
});

// Full replace of the config blob (the POS always sends the complete config object)
router.post('/config', async (req, res) => {
  try {
    const data = req.body || {};
    const result = await pool.query(
      `INSERT INTO pos_config (id, data, updated_at)
       VALUES ('singleton', $1, now() at time zone 'Asia/Manila')
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now() at time zone 'Asia/Manila'
       RETURNING data`,
      [JSON.stringify(data)]
    );
    res.status(201).json(result.rows[0].data);
  } catch (err) {
    res.status(500).json({ message: 'Error saving config', error: err.message });
  }
});

/* ==================== AUDIT LOG (voids, edits — write-mostly, owner reads it) ==================== */

router.get('/audit_log', async (req, res) => {
  try {
    const limit = Math.min(500, num(req.query.limit) || 200);
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT $1', [limit]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching audit_log', error: err.message });
  }
});

router.post('/audit_log', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || 'log_' + Math.random().toString(36).substring(2, 10);
    const actor = body.actor || null;
    const role = body.role || null;
    const action = body.action || null;
    const detail = body.detail || null;

    const result = await pool.query(
      `INSERT INTO audit_log (id, actor, role, action, detail)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [id, actor, role, action, detail]
    );
    res.status(201).json(result.rows[0] || { id, alreadyRecorded: true });
  } catch (err) {
    res.status(500).json({ message: 'Error saving audit_log', error: err.message });
  }
});

module.exports = router;
