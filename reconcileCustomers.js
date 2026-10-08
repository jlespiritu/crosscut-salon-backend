// reconcileCustomers.js — makes the Supabase `customers` table match the customer list in Google Sheets
// (which is what the POS saves). Put it in the backend folder (next to reconcileSales.js) and run:
//     node reconcileCustomers.js              <- report only, changes nothing
//     node reconcileCustomers.js --commit     <- apply the changes
// Rules:
//  * Google Sheets (the POS) is the truth. Customers that are NOT in it (deleted / test / never paid) are removed
//    from Supabase — but only if they have no sales. A customer that still has sales is kept and listed for you.
//  * Customers missing in Supabase are added; ones whose name/phone/email/facebook/notes differ are updated.
//  * If Google Sheets can't be read, or returns an empty list, NOTHING is changed.
require('dotenv').config();
const { Pool } = require('pg');

const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbyOe56BcN79yW38aoN1PjZ4K4wSEHRZEIT1bjcam9zq6HV0PUlLezsCi4GgQATShmCDCQ/exec';
const FIELDS = ['name', 'phone', 'email', 'facebook', 'notes'];
const s = v => (v == null ? '' : String(v));

async function fetchSheetCustomers(url) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=crosscut-customers', { redirect: 'follow' });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { throw new Error('Google Sheets did not answer with JSON. It said: ' + text.slice(0, 200)); }
  // Same reading rule as the POS: only a real "error" field means failure; the list is in "value".
  if (body && body.error) throw new Error('Google Sheets said: ' + body.error);
  if (!body || body.value == null || body.value === '') {
    throw new Error('Google Sheets answered but had no customer list in it. Raw answer: ' + text.slice(0, 200));
  }
  const arr = typeof body.value === 'string' ? JSON.parse(body.value) : body.value;
  if (!Array.isArray(arr)) throw new Error('Customer list in Google Sheets is not a list.');
  return arr.filter(c => c && c.id && !c.pending && String(c.name || '').trim());
}

async function reconcile({ pool, sheetCustomers, commit, force }) {
  if (!sheetCustomers.length) throw new Error('Google Sheets returned 0 customers - stopping so nothing is deleted by mistake.');
  const db = (await pool.query('SELECT id, name, phone, email, facebook, notes FROM customers')).rows;
  const sheetById = new Map(sheetCustomers.map(c => [c.id, c]));
  const dbById = new Map(db.map(r => [r.id, r]));

  const toAdd = sheetCustomers.filter(c => !dbById.has(c.id));
  const toUpdate = sheetCustomers.filter(c => {
    const r = dbById.get(c.id);
    return r && FIELDS.some(f => s(r[f]) !== s(c[f]));
  });
  const extras = db.filter(r => !sheetById.has(r.id));
  const salesCount = new Map((await pool.query('SELECT customer_id, COUNT(*)::int AS n FROM sales WHERE customer_id IS NOT NULL GROUP BY customer_id')).rows.map(r => [r.customer_id, r.n]));
  const toDelete = extras.filter(r => !salesCount.get(r.id));
  const keptWithSales = extras.filter(r => salesCount.get(r.id));

  if (db.length && toDelete.length > Math.max(10, db.length * 0.5) && !force) {
    throw new Error(`Would delete ${toDelete.length} of ${db.length} customers - that looks wrong. Check the Sheets list first (or use --force).`);
  }

  const out = { sheet: sheetCustomers.length, db: db.length, add: toAdd, update: toUpdate, del: toDelete, keep: keptWithSales };
  if (commit) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of toAdd.concat(toUpdate)) {
        await client.query(
          `INSERT INTO customers (id, name, phone, email, facebook, notes) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, email=EXCLUDED.email, facebook=EXCLUDED.facebook, notes=EXCLUDED.notes`,
          [c.id, s(c.name), s(c.phone), s(c.email), s(c.facebook), s(c.notes)]);
      }
      for (const r of toDelete) await client.query('DELETE FROM customers WHERE id=$1', [r.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    out.dbAfter = (await pool.query('SELECT COUNT(*)::int AS n FROM customers')).rows[0].n;
  }
  return out;
}

function report(o, commit) {
  const line = (r) => `   - ${s(r.name)}  (${s(r.phone) || 'no phone'})  ${r.id}`;
  console.log(`\nGoogle Sheets customers : ${o.sheet}\nSupabase customers      : ${o.db}\n`);
  console.log(`${commit ? 'ADDED' : 'Would ADD'}    : ${o.add.length}`);       o.add.forEach(c => console.log(line(c)));
  console.log(`${commit ? 'UPDATED' : 'Would UPDATE'} : ${o.update.length}`);  o.update.forEach(c => console.log(line(c)));
  console.log(`${commit ? 'DELETED' : 'Would DELETE'} : ${o.del.length}  (not in the POS list, no sales)`); o.del.forEach(c => console.log(line(c)));
  if (o.keep.length) {
    console.log(`\nKEPT although not in the POS list (they have sales, so deleting would orphan those sales): ${o.keep.length}`);
    o.keep.forEach(c => console.log(line(c)));
  }
  if (commit) console.log(`\nSupabase now has ${o.dbAfter} customers (Google Sheets: ${o.sheet}${o.keep.length ? ', plus ' + o.keep.length + ' kept above' : ''}).`);
  else console.log('\nNothing was changed. If this looks right, run again with:  node reconcileCustomers.js --commit');
}

async function main() {
  const commit = process.argv.includes('--commit');
  const force = process.argv.includes('--force');
  const pool = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 6543), database: process.env.PG_DATABASE,
    user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false },
  });
  try {
    console.log('Reading the customer list from Google Sheets...');
    const sheetCustomers = await fetchSheetCustomers(GAS_URL);
    const o = await reconcile({ pool, sheetCustomers, commit, force });
    report(o, commit);
  } catch (e) {
    console.error('\nSTOPPED: ' + e.message + '\nNothing was changed.');
    process.exitCode = 1;
  } finally { await pool.end(); }
}

module.exports = { reconcile, fetchSheetCustomers };
if (require.main === module) main();
