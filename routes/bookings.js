const express = require('express');
const pgPool = require('../db/pg');

const router = express.Router();

const OPEN_HOUR = Number(process.env.OPEN_HOUR || 8);
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 18);
const MAX_DAYS_AHEAD = Number(process.env.MAX_DAYS_AHEAD || 60);
const MAX_PER_SLOT = Number(process.env.BOOKING_MAX_PER_SLOT || 2);
const TIMEZONE = process.env.TIMEZONE || 'Asia/Manila';

const pad2 = (n) => String(n).padStart(2, '0');
const SLOTS = [];
for (let h = OPEN_HOUR; h < CLOSE_HOUR; h += 1) SLOTS.push(`${pad2(h)}:00`);

function manilaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function isRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// GET /bookings/slots?date=YYYY-MM-DD
router.get('/slots', async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!isRealDate(date)) return res.status(400).json({ ok: false, error: 'INVALID_DATE' });

    const { rows } = await pgPool.query(
      `select time, count(*)::int as n
         from bookings
        where date = $1 and status <> 'cancelled'
        group by time`,
      [date]
    );
    const counts = {};
    rows.forEach((r) => { counts[r.time] = r.n; });
    res.json({ ok: true, counts, max: MAX_PER_SLOT });
  } catch (err) {
    next(err);
  }
});

// POST /bookings
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const email = String(b.email || '').trim();
    const service = String(b.service || '').trim();
    const staff = String(b.staff || '').trim();
    const notes = String(b.notes || '').trim().slice(0, 500);
    const date = String(b.date || '');
    const time = String(b.time || '');

    // Bot traps: pagpapanggap na successful para walang clue ang bot
    if (b.website || Number(b.elapsed) < 3000) {
      return res.json({ ok: true, id: 'OK' });
    }

    const digits = phone.replace(/\D/g, '');
    const now = manilaNow();

    if (name.length < 2) return res.status(400).json({ ok: false, error: 'INVALID_NAME' });
    if (digits.length < 7 || digits.length > 15) return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'INVALID_EMAIL' });
    if (!service) return res.status(400).json({ ok: false, error: 'INVALID_SERVICE' });
    if (!isRealDate(date)) return res.status(400).json({ ok: false, error: 'INVALID_DATE' });
    if (date < now.date) return res.status(400).json({ ok: false, error: 'PAST_DATE' });
    if (date > addDays(now.date, MAX_DAYS_AHEAD)) return res.status(400).json({ ok: false, error: 'TOO_FAR' });
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ ok: false, error: 'INVALID_TIME' });
    if (!SLOTS.includes(time)) return res.status(400).json({ ok: false, error: 'CLOSED_TIME' });
    if (date === now.date && time <= now.time) return res.status(400).json({ ok: false, error: 'PAST_TIME' });

    // Isang query: mag-i-insert lang kung hindi pa puno ang slot
    const { rows } = await pgPool.query(
      `insert into bookings (name, phone, email, service, staff, date, time, notes)
       select $1, $2, $3, $4, $5, $6, $7, $8
        where (select count(*) from bookings
                where date = $6 and time = $7 and status <> 'cancelled') < $9
       returning id`,
      [name, phone, email || null, service, staff || null, date, time, notes || null, MAX_PER_SLOT]
    );

    if (rows.length === 0) return res.status(409).json({ ok: false, error: 'SLOT_FULL' });

    res.status(201).json({ ok: true, id: String(rows[0].id).slice(0, 8).toUpperCase() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;