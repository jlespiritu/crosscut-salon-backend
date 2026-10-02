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

// UPSERT customer: gagawa kung wala pa, mag-uupdate kung meron na.
// Hindi nito binubura ang dating name/phone kapag walang bagong value na ipinadala.
router.post('/customers', async (req, res) => {
  try {
    const { id, name, phone } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'id is required' });
    }

    const result = await pool.query(
      `INSERT INTO customers (id, name, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         name  = COALESCE(EXCLUDED.name,  customers.name),
         phone = COALESCE(EXCLUDED.phone, customers.phone)
       RETURNING *`,
      [id, name || null, phone || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error saving customer', error: err.message });
  }
});

/* ---------------- SALES ---------------- */

// Kasama na ang customer_name mula sa customers table (LEFT JOIN)
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
    // ino-overwrite ang existing na name/phone)
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

module.exports = router;