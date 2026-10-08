// checkSales.js — compares the sales saved in Google Sheets (what the POS saves) with the Supabase `sales` table.
// Put it in the backend folder (next to reconcileCustomers.js) and run:
//     node checkSales.js                  <- report only, changes nothing
//     node checkSales.js --delete-extra   <- also delete Supabase sales that are NOT in Google Sheets (cleared/test sales)
// Sales that are in Google Sheets but missing in Supabase are NOT added here: in the POS use
// Settings > Backup sync (Supabase) > "Re-send recent sales..." (safe, the backend skips ones it already has).
require('dotenv').config();
const { Pool } = require('pg');

const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbyOe56BcN79yW38aoN1PjZ4K4wSEHRZEIT1bjcam9zq6HV0PUlLezsCi4GgQATShmCDCQ/exec';
const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const money = n => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fetchSheetSales(url) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=crosscut-sales', { redirect: 'follow' });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { throw new Error('Google Sheets did not answer with JSON. It said: ' + text.slice(0, 200)); }
  if (body && body.error) throw new Error('Google Sheets said: ' + body.error);
  if (!body || body.value == null || body.value === '') throw new Error('Google Sheets has no sales list. Raw answer: ' + text.slice(0, 200));
  const arr = typeof body.value === 'string' ? JSON.parse(body.value) : body.value;
  if (!Array.isArray(arr)) throw new Error('Sales list in Google Sheets is not a list.');
  return arr.filter(s => s && s.id);
}

async function check({ pool, sheetSales, deleteExtra, force }) {
  const db = (await pool.query(
    `SELECT s.id, s.date_iso, s.total, s.customer_id, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id`)).rows;
  const sheetIds = new Set(sheetSales.map(s => s.id));
  const dbIds = new Set(db.map(r => r.id));
  const missing = sheetSales.filter(s => !dbIds.has(s.id));
  const extra = db.filter(r => !sheetIds.has(r.id));
  if (deleteExtra) {
    if (!sheetSales.length) throw new Error('Google Sheets has 0 sales - refusing to delete anything.');
    if (extra.length > Math.max(10, db.length * 0.5) && !force) throw new Error(`Would delete ${extra.length} of ${db.length} sales - looks wrong. Check first (or use --force).`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of extra) await client.query('DELETE FROM sales WHERE id=$1', [r.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  return { sheetSales, db, missing, extra, deleted: !!deleteExtra };
}

function report(o) {
  const day = d => String(d || '').slice(0, 10);
  const sum = a => a.reduce((x, s) => x + num(s.total), 0);
  const latest = a => a.map(s => String(s.dateISO || s.date_iso || '')).sort().slice(-1)[0] || '-';
  console.log(`\nGoogle Sheets sales : ${o.sheetSales.length}   total ${money(sum(o.sheetSales))}   latest ${latest(o.sheetSales)}`);
  console.log(`Supabase sales      : ${o.db.length}   total ${money(sum(o.db))}   latest ${latest(o.db)}`);
  console.log(`\nIn Google Sheets but MISSING in Supabase: ${o.missing.length}`);
  o.missing.forEach(s => console.log(`   - ${day(s.dateISO)}  ${s.customerName || '?'}  ${money(num(s.total))}  ${s.id}`));
  console.log(`In Supabase but NOT in Google Sheets (cleared/test): ${o.extra.length}${o.deleted ? '   <- DELETED now' : ''}`);
  o.extra.forEach(r => console.log(`   - ${day(r.date_iso)}  ${r.customer_name || r.customer_id || '?'}  ${money(num(r.total))}  ${r.id}`));
  if (!o.deleted && o.extra.length) console.log('\nTo delete those extra Supabase sales: node checkSales.js --delete-extra');
  if (o.missing.length) console.log('To add the missing ones: POS > Settings > Backup sync (Supabase) > Re-send recent sales...');
  if (!o.missing.length && !o.extra.length) console.log('\nSales match in both places.');
}

async function main() {
  const pool = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 6543), database: process.env.PG_DATABASE,
    user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false },
  });
  try {
    console.log('Reading the sales list from Google Sheets...');
    const sheetSales = await fetchSheetSales(GAS_URL);
    report(await check({ pool, sheetSales, deleteExtra: process.argv.includes('--delete-extra'), force: process.argv.includes('--force') }));
  } catch (e) { console.error('\nSTOPPED: ' + e.message + '\nNothing was changed.'); process.exitCode = 1; }
  finally { await pool.end(); }
}
module.exports = { check, fetchSheetSales };
if (require.main === module) main();
