// routes/pos.js
const express = require('express');
const router = express.Router();
const pool = require('../db/pg');
const fs = require('fs');
const path = require('path');

// Google Apps Script Web App URL (I-set sa Render Environment Variables o ilagay dito)
const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbyogtSruQtvKXOGO6JoFL048uzef_d2g2AfD9qG0IGIGMk9vcgJLsXaFSD_I7AoxhiYkA/exec';

const FAILED_LOG = path.join(__dirname, '..', 'failed-sales.log');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function logFailedSale(reason, body) {
  try {
    fs.appendFileSync(FAILED_LOG, JSON.stringify({ at: new Date().toISOString(), reason, body }) + '\n');
  } catch (_) { /* huwag hayaang pumalya ang request dahil sa log */ }
  console.error('SALE NOT SAVED:', reason, '| id:', body && body.id);
}

// Helper para magpadala ng Key-Value Blob sa iyong Google Apps Script (Storage sheet & organizeData_())
async function syncToGoogleSheets(key, valueObj) {
  if (!GAS_URL || GAS_URL.includes('YOUR_GOOGLE_APPS_SCRIPT')) return;
  try {
    const valueStr = typeof valueObj === 'string' ? valueObj : JSON.stringify(valueObj);
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, value: valueStr })
    });
  } catch (err) {
    console.error(`Google Sheets Sync Error [key: ${key}]:`, err.message);
  }
}

/* ---------------- STAFF ---------------- */

router.get('/staff', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM staff ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching staff', error: err.message });
  }
});

router.get('/staff/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Staff not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching staff', error: err.message });
  }
});

/* ---------------- SERVICES ---------------- */

router.get('/services', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM services ORDER BY category, name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching services', error: err.message });
  }
});

router.get('/services/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching service', error: err.message });
  }
});

/* ---------------- PRODUCTS ---------------- */

router.get('/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching products', error: err.message });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching product', error: err.message });
  }
});

/* ---------------- CUSTOMERS ---------------- */

router.get('/customers', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers ORDER BY name NULLS LAST');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching customers', error: err.message });
  }
});

const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

router.get('/customers/duplicates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.phone, c.email, c.created_at, count(s.id)::int AS sales_count
       FROM customers c
       LEFT JOIN sales s ON s.customer_id = c.id
       GROUP BY c.id, c.name, c.phone, c.email, c.created_at
       ORDER BY c.created_at`
    );
    const group = (keyFn) => {
      const m = new Map();
      rows.forEach((r) => {
        const k = keyFn(r);
        if (!k) return;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      });
      return [...m.values()].filter((g) => g.length > 1);
    };
    res.json({
      byName: group((r) => normName(r.name)),
      byPhone: group((r) => normPhone(r.phone)),
    });
  } catch (err) {
    res.status(500).json({ message: 'Error finding duplicates', error: err.message });
  }
});

router.get('/customers/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching customer', error: err.message });
  }
});

// UPSERT customer (Tinatanggap ang parehong 'name' / 'client_name' at nag-a-auto-generate ng ID kung wala)
router.post('/customers', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || body.customerId || 'cust_' + Math.random().toString(36).substring(2, 10);
    
    // Normalization para sa field names
    const nameInput = body.name || body.client_name || body.customerName;
    const phoneInput = body.phone || body.customerPhone;
    const emailInput = body.email;
    const facebookInput = body.facebook;
    const notesInput = body.notes;

    const name = nameInput ? String(nameInput).trim() : null;
    const phone = phoneInput ? String(phoneInput).trim() : null;
    const email = emailInput ? String(emailInput).trim() : null;
    const facebook = facebookInput ? String(facebookInput).trim() : null;
    const notes = notesInput ? String(notesInput).trim() : null;

    const result = await pool.query(
      `INSERT INTO customers (id, name, phone, email, facebook, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name     = COALESCE(EXCLUDED.name, customers.name),
         phone    = COALESCE(EXCLUDED.phone, customers.phone),
         email    = COALESCE(EXCLUDED.email, customers.email),
         facebook = COALESCE(EXCLUDED.facebook, customers.facebook),
         notes    = COALESCE(EXCLUDED.notes, customers.notes)
       RETURNING *`,
      [id, name, phone, email, facebook, notes]
    );

    // Sync sa Google Sheet under 'crosscut-customers' key
    const allCustomers = await pool.query('SELECT * FROM customers ORDER BY name');
    syncToGoogleSheets('crosscut-customers', allCustomers.rows);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error saving customer', error: err.message });
  }
});

// MERGE customers
router.post('/customers/merge', async (req, res) => {
  const { keepId, mergeIds } = req.body || {};
  if (!keepId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return res.status(400).json({ message: 'keepId and a non-empty mergeIds array are required' });
  }
  const ids = [...new Set(mergeIds.map(String))].filter((x) => x !== String(keepId));
  if (ids.length === 0) {
    return res.status(400).json({ message: 'mergeIds must contain ids other than keepId' });
  }

  const ph = ids.map((_, i) => '$' + (i + 1)).join(',');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const keepRes = await client.query('SELECT * FROM customers WHERE id = $1', [keepId]);
    if (keepRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'keepId not found' });
    }
    const keep = keepRes.rows[0];

    const dupRes = await client.query(
      `SELECT * FROM customers WHERE id IN (${ph}) ORDER BY created_at`,
      ids
    );
    if (dupRes.rows.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'One or more mergeIds were not found' });
    }

    const fill = {};
    ['phone', 'email', 'facebook', 'notes'].forEach((f) => {
      if (!keep[f] || !String(keep[f]).trim()) {
        const donor = dupRes.rows.find((d) => d[f] && String(d[f]).trim());
        if (donor) fill[f] = donor[f];
      }
    });

    let earliest = keep.created_at;
    dupRes.rows.forEach((d) => {
      if (d.created_at && (!earliest || new Date(d.created_at) < new Date(earliest))) earliest = d.created_at;
    });

    const moved = await client.query(
      `UPDATE sales SET customer_id = $1 WHERE customer_id IN (${ids.map((_, i) => '$' + (i + 2)).join(',')})`,
      [keepId, ...ids]
    );
    await client.query(
      `UPDATE customers SET
         phone = COALESCE($2, phone), email = COALESCE($3, email),
         facebook = COALESCE($4, facebook), notes = COALESCE($5, notes),
         created_at = $6
       WHERE id = $1`,
      [keepId, fill.phone || null, fill.email || null, fill.facebook || null, fill.notes || null, earliest]
    );
    const del = await client.query(`DELETE FROM customers WHERE id IN (${ph})`, ids);

    await client.query('COMMIT');

    // Sync updated customers and sales to Google Sheets
    const updatedCustomers = await pool.query('SELECT * FROM customers ORDER BY name');
    syncToGoogleSheets('crosscut-customers', updatedCustomers.rows);

    res.json({
      kept: keepId,
      salesMoved: moved.rowCount,
      customersDeleted: del.rowCount,
      fieldsFilled: Object.keys(fill),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    res.status(500).json({ message: 'Error merging customers', error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/customers/:id', async (req, res) => {
  try {
    const used = await pool.query('SELECT count(*)::int AS n FROM sales WHERE customer_id = $1', [req.params.id]);
    if (used.rows[0].n > 0) {
      return res.status(409).json({ message: 'Customer has sales; merge instead of deleting', sales: used.rows[0].n });
    }
    const result = await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting customer', error: err.message });
  }
});

/* ---------------- SALES ---------------- */

router.get('/sales', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       ORDER BY s.date_iso DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching sales', error: err.message });
  }
});

router.get('/sales/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching sale', error: err.message });
  }
});

// POST new sale (Normalizes payload & triggers Google Sheets sync)
router.post('/sales', async (req, res) => {
  const body = req.body || {};
  try {
    // Normalization para sa parehong camelCase at snake_case payloads
    const id = body.id || 'sale_' + Math.random().toString(36).substring(2, 10);
    const dateIso = body.dateIso || body.date_iso || body.createdAt || new Date().toISOString();
    const staffId = body.staffId || body.staff_id;
    const staffName = body.staffName || body.staff_name;
    const customerId = body.customerId || body.customer_id;
    const serviceIds = body.serviceIds || body.service_ids || [];
    const productLines = body.productLines || body.product_lines || [];
    const discountPercent = body.discountPercent || body.discount_percent;
    const manualTotal = body.manualTotal || body.manual_total;
    const subtotal = body.subtotal;
    const total = body.total || body.total_amount;
    const commissionAmount = body.commissionAmount || body.commission_amount;
    const paymentMethod = body.paymentMethod || body.payment_method;

    const totalNum = num(total);
    if (!id || totalNum === null) {
      logFailedSale('missing id or invalid total', body);
      return res.status(400).json({ message: 'id and a numeric total are required' });
    }
    const when = dateIso && !Number.isNaN(new Date(dateIso).getTime()) ? dateIso : new Date().toISOString();

    const already = await pool.query('SELECT * FROM sales WHERE id = $1', [id]);
    if (already.rows.length > 0) {
      return res.status(200).json({ ...already.rows[0], alreadyRecorded: true });
    }

    if (customerId) {
      await pool.query(
        'INSERT INTO customers (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
        [customerId]
      );
    }

    const result = await pool.query(
      `INSERT INTO sales
        (id, date_iso, staff_id, staff_name, customer_id, service_ids, product_lines,
         discount_percent, manual_total, subtotal, total, commission_amount, payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        id, when, staffId || null, staffName || null, customerId || null,
        Array.isArray(serviceIds) ? serviceIds.map(String) : [],
        JSON.stringify(Array.isArray(productLines) ? productLines : []),
        num(discountPercent), num(manualTotal), num(subtotal), totalNum,
        num(commissionAmount), paymentMethod || null,
      ]
    );

    const savedSale = result.rows[0] || { id, alreadyRecorded: true };

    // Direct background sync sa Google Apps Script Storage Sheet under 'crosscut-sales' key
    const allSales = await pool.query(`
      SELECT s.id, s.date_iso AS "dateISO", s.staff_name AS "staffName",
             c.name AS "customerName", s.total, s.commission_amount AS "commissionAmount",
             s.payment_method AS "paymentMethod"
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      ORDER BY s.date_iso DESC
    `);
    
    syncToGoogleSheets('crosscut-sales', allSales.rows);

    res.status(201).json(savedSale);
  } catch (err) {
    logFailedSale(err.message, body);
    res.status(500).json({ message: 'Error creating sale', error: err.message });
  }
});

// BULK SYNC Endpoint (Ginagamit para i-sync ang lumang localStorage records sa Supabase + Google Sheets)
router.post('/sync-sheets', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key || !value) {
    return res.status(400).json({ message: 'key and value are required' });
  }

  try {
    await syncToGoogleSheets(key, value);
    res.json({ ok: true, message: `Key ${key} synced to Google Sheets` });
  } catch (err) {
    res.status(500).json({ message: 'Error syncing to Google Sheets', error: err.message });
  }
});

router.delete('/sales/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    // Sync updated sales array to Google Sheets so voided sales vanish automatically
    const remainingSales = await pool.query('SELECT * FROM sales ORDER BY date_iso DESC');
    syncToGoogleSheets('crosscut-sales', remainingSales.rows);

    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting sale', error: err.message });
  }
});

module.exports = router;