// routes/pos.js
const express = require('express');
const router = express.Router();
const pool = require('../db/pg');

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

// ---- Listahan ng posibleng DUPLICATE na customers (read-only, walang binabago) ----
// Dapat nasa ibabaw ng '/customers/:id' para hindi mapagkamalang id ang "duplicates".
const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';   // 0917.. / 917.. / +63917.. = pareho
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

// UPSERT customer: isinusulat lang ang mga field na NAKASAMA sa request body
// (kahit blangko = binubura). Ang field na wala sa body ay hindi ginagalaw.
router.post('/customers', async (req, res) => {
  try {
    const body = req.body || {};
    const { id } = body;

    if (!id) {
      return res.status(400).json({ message: 'id is required' });
    }

    const fields = ['name', 'phone', 'email', 'facebook', 'notes'];
    const has = {};
    const val = {};
    fields.forEach((f) => {
      has[f] = Object.prototype.hasOwnProperty.call(body, f);
      const v = has[f] && body[f] != null ? String(body[f]).trim() : '';
      val[f] = v === '' ? null : v;
    });

    const result = await pool.query(
      `INSERT INTO customers (id, name, phone, email, facebook, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name     = CASE WHEN $7  THEN EXCLUDED.name     ELSE customers.name     END,
         phone    = CASE WHEN $8  THEN EXCLUDED.phone    ELSE customers.phone    END,
         email    = CASE WHEN $9  THEN EXCLUDED.email    ELSE customers.email    END,
         facebook = CASE WHEN $10 THEN EXCLUDED.facebook ELSE customers.facebook END,
         notes    = CASE WHEN $11 THEN EXCLUDED.notes    ELSE customers.notes    END
       RETURNING *`,
      [
        id, val.name, val.phone, val.email, val.facebook, val.notes,
        has.name, has.phone, has.email, has.facebook, has.notes,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error saving customer', error: err.message });
  }
});

// MERGE: pagsamahin ang mga duplicate na customer sa ISANG record.
// Body: { "keepId": "cust_...", "mergeIds": ["cust_...", "cust_..."] }
// Lahat ng benta ng mergeIds ay ililipat sa keepId, ang blangkong field ng keepId
// (phone, email, facebook, notes) ay pupunuan mula sa mga kopya, tapos buburahin ang mga kopya.
// Isang transaction ito: kung may pumalya, walang mababago.
router.post('/customers/merge', async (req, res) => {
  const { keepId, mergeIds } = req.body || {};
  if (!keepId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return res.status(400).json({ message: 'keepId and a non-empty mergeIds array are required' });
  }
  const ids = [...new Set(mergeIds.map(String))].filter((x) => x !== String(keepId));
  if (ids.length === 0) {
    return res.status(400).json({ message: 'mergeIds must contain ids other than keepId' });
  }

  const ph = ids.map((_, i) => '$' + (i + 1)).join(',');   // $1,$2,... para sa IN (...)
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
    // Kung mas maaga ang pagkakagawa ng kopya, iyon ang gawing created_at
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

// DELETE customer. Tatanggihan (409) kung may benta pa siya, para hindi mawala ang records.
// Gamitin ang /customers/merge kung duplicate ang gustong alisin.
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

// Kasama na ang customer_name at customer_phone mula sa customers table (LEFT JOIN).
// Sadyang hindi isinama dito ang email/facebook/notes.
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

// POST new sale — matches the POS's real sale shape (id, dateIso, staffId,
// staffName, customerId, serviceIds[], productLines[], totals, commission, etc.)
router.post('/sales', async (req, res) => {
  try {
    const {
      id, dateIso, staffId, staffName, customerId,
      serviceIds, productLines, discountPercent,
      manualTotal, subtotal, total, commissionAmount, paymentMethod,
    } = req.body;

    if (!id || !dateIso || !total) {
      return res.status(400).json({ message: 'id, dateIso, and total are required' });
    }

    // Siguraduhing may row sa customers para sa customerId (hindi nito
    // ino-overwrite ang existing na data)
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
       RETURNING *`,
      [
        id, dateIso, staffId, staffName, customerId,
        serviceIds, productLines ? JSON.stringify(productLines) : null,
        discountPercent, manualTotal, subtotal, total, commissionAmount, paymentMethod,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error creating sale', error: err.message });
  }
});

// DELETE sale (kapag na-void ng owner sa POS). Hindi ginagalaw ang customer.
router.delete('/sales/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting sale', error: err.message });
  }
});

module.exports = router;
