/**
 * reconcileSales.js — tiyakin na ang BAWAT benta sa Google Sheets ay nasa Supabase din.
 *
 *   node reconcileSales.js            -> REPORT lang: ipapakita kung aling benta ang kulang. WALANG isinusulat.
 *   node reconcileSales.js --commit   -> idadagdag ang mga kulang na benta (at ang customer nila kung wala pa)
 *
 * Gamitin kahit kailan (hal. gabi-gabi o lingguhan): i-export muna ang "Data" tab ng Sheets
 * bilang import\data.csv, saka patakbuhin. Ligtas ulitin: hindi nito dinodoble ang benta
 * at hindi ginagalaw ang mga nandoon na.
 *
 * Mahalaga:
 *  - Mga BENTA lang (at ang customer nila kung kulang) ang hinahawakan nito. Hindi nito ibabalik
 *    ang mga customer na pinagsama o binura mo na (mergeDuplicates.js).
 *  - Kung ang customer ng kulang na benta ay wala na sa Supabase dahil pinagsama, ililipat ang
 *    benta sa tamang customer (email muna, saka pangalan; hindi ginagamit ang phone).
 *    Kung hindi matukoy, gagawa ng bagong customer record para hindi mawala ang benta.
 *  - Hindi ito nagbubura ng kahit ano. Ang mga benta na nasa Supabase lang ay iuulat lang.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Client } = require('pg');

const CSV_PATH = path.join(__dirname, 'import', 'data.csv');
const EXCLUDE_PATH = path.join(__dirname, 'import', 'exclude.json');

const low = (s) => String(s || '').trim().toLowerCase();
const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const phone10 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const normEmail = (v) => { const e = low(v); return e.includes('@') ? e : ''; };
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };
const num = (v) => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toISO = (v) => { if (v === null || v === undefined || v === '') return null; const d = typeof v === 'number' ? new Date(v) : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const normPhoneStore = (p) => { if (!p) return null; const d = String(p).replace(/[^\d]/g, ''); return d.length === 10 && d.startsWith('9') ? '0' + d : String(p).trim(); };
const firstArray = (o, ...keys) => { for (const k of keys) if (o && Array.isArray(o[k])) return o[k]; return []; };

const mapSale = (s) => ({
  id: String(s.id),
  date_iso: toISO(pick(s, 'dateISO', 'date')),
  staff_id: pick(s, 'staffId'),
  staff_name: pick(s, 'staffName'),
  customer_id: pick(s, 'customerId'),
  service_ids: Array.isArray(s.serviceIds) ? s.serviceIds.map(String) : [],
  product_lines: JSON.stringify(firstArray(s, 'productLines', 'products', 'productItems')),
  discount_percent: num(pick(s, 'discountPercent')) ?? 0,
  manual_total: s.manualOverride === true ? num(s.total) : num(pick(s, 'manualTotal', 'manualOverride')),
  subtotal: num(pick(s, 'subtotal')),
  total: num(pick(s, 'total')),
  commission_amount: num(pick(s, 'commissionAmount', 'commission')),
  payment_method: pick(s, 'paymentMethod', 'method'),
});
const mapCustomer = (c) => ({
  id: String(c.id), name: pick(c, 'name'), phone: normPhoneStore(pick(c, 'phone')),
  email: pick(c, 'email'), facebook: pick(c, 'facebook'), notes: pick(c, 'notes'),
  created_at: toISO(pick(c, 'createdAt')) || new Date().toISOString(),
});

function loadDataTab(csvPath = CSV_PATH) {
  if (!fs.existsSync(csvPath)) { console.error(`Hindi makita ang ${csvPath}\nI-export ang "Data" tab bilang CSV at ilagay sa import\\data.csv`); process.exit(1); }
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  const out = {};
  for (const r of rows) {
    const key = String(r.key || '').trim();
    if (!key.startsWith('crosscut-')) continue;
    try { out[key] = JSON.parse(r.value); } catch (e) { console.log(`⚠️  ${key}: hindi ma-parse ang JSON (${e.message}). Baka putol ang cell (limit ng Sheets: 50,000 characters).`); }
  }
  return out;
}
function loadExclusions() {
  if (!fs.existsSync(EXCLUDE_PATH)) return { names: [], ids: [] };
  const j = JSON.parse(fs.readFileSync(EXCLUDE_PATH, 'utf8').replace(/^﻿/, ''));
  return { names: Array.isArray(j.names) ? j.names : [], ids: Array.isArray(j.ids) ? j.ids : [] };
}

// Hanapin sa Supabase ang customer na katumbas ng customer mula sa Sheets.
// EMAIL muna; kung walang email, PANGALAN. Ang phone ay HINDI ginagamit.
function findMatch(sc, sbCustomers) {
  const e = normEmail(sc.email), n = normName(sc.name);
  if (e) { const m = sbCustomers.find((c) => normEmail(c.email) === e); if (m) return { c: m, how: 'email' }; }
  if (n) {
    let same = sbCustomers.filter((c) => normName(c.name) === n);
    // Kung may email ang customer at magkaiba ang email ng lahat ng kapangalan, hindi sila iisa
    if (e) same = same.filter((c) => !normEmail(c.email));
    if (same.length) return { c: same.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0], how: 'pangalan' };
  }
  return null;
}

async function reconcile(client, data, excl, commit) {
  const sheetSales = Array.isArray(data['crosscut-sales']) ? data['crosscut-sales'] : [];
  const sheetCustomers = Array.isArray(data['crosscut-customers']) ? data['crosscut-customers'] : [];
  const scById = new Map(sheetCustomers.map((c) => [String(c.id), c]));
  const exNames = new Set(excl.names.map(low)), exIds = new Set(excl.ids.map(String));
  const excluded = (cid) => { const c = scById.get(String(cid)); return exIds.has(String(cid)) || (c && exNames.has(low(c.name))); };

  const sbSales = (await client.query('SELECT id, total FROM sales')).rows;
  const sbSaleIds = new Set(sbSales.map((r) => r.id));
  let sbCustomers = (await client.query('SELECT id, name, phone, email, created_at FROM customers')).rows;
  const sbCustIds = new Set(sbCustomers.map((c) => c.id));

  const sheetIds = new Set(sheetSales.map((s) => String(s.id)));
  const onlyInSupabase = sbSales.filter((r) => !sheetIds.has(r.id)).length;

  const missing = [], skipped = [];
  for (const s of sheetSales) {
    if (sbSaleIds.has(String(s.id))) continue;
    if (s.customerId && excluded(s.customerId)) { skipped.push({ s, why: 'test customer (exclude.json)' }); continue; }
    const m = mapSale(s);
    if (m.total === null) { skipped.push({ s, why: 'walang total' }); continue; }
    if (!m.date_iso) m.date_iso = new Date().toISOString();
    missing.push(m);
  }

  // Customer ng bawat kulang na benta
  const newCustomers = new Map();     // id -> mapped customer to insert
  const remapped = [];
  const cache = new Map();            // lumang customer_id -> id na gagamitin
  for (const m of missing) {
    const cid = m.customer_id ? String(m.customer_id) : null;
    if (!cid) continue;
    if (cache.has(cid)) { m.customer_id = cache.get(cid); continue; }
    if (sbCustIds.has(cid)) { cache.set(cid, cid); continue; }
    const sc = scById.get(cid);
    if (!sc) { cache.set(cid, cid); newCustomers.set(cid, { id: cid, name: m.customer_name || null, phone: null, email: null, facebook: null, notes: null, created_at: new Date().toISOString() }); continue; }
    const hit = findMatch(sc, sbCustomers);
    if (hit) { cache.set(cid, hit.c.id); remapped.push({ name: sc.name, how: hit.how }); m.customer_id = hit.c.id; }
    else { const mc = mapCustomer(sc); newCustomers.set(cid, mc); sbCustomers = sbCustomers.concat([{ ...mc }]); cache.set(cid, cid); }
  }

  const sum = (a) => a.reduce((n, r) => n + (Number(r.total) || 0), 0);
  const report = {
    sheetSales: sheetSales.length, supabaseSales: sbSales.length,
    missing, skipped, onlyInSupabase, newCustomers: [...newCustomers.values()], remapped,
    missingTotal: sum(missing),
  };

  if (commit && missing.length) {
    await client.query('BEGIN');
    try {
      for (const c of newCustomers.values()) {
        await client.query(
          'INSERT INTO customers (id, name, phone, email, facebook, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
          [c.id, c.name, c.phone, c.email, c.facebook, c.notes, c.created_at]);
      }
      for (const m of missing) {
        await client.query(
          `INSERT INTO sales (id,date_iso,staff_id,staff_name,customer_id,service_ids,product_lines,discount_percent,manual_total,subtotal,total,commission_amount,payment_method)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
          [m.id, m.date_iso, m.staff_id, m.staff_name, m.customer_id, m.service_ids, m.product_lines, m.discount_percent, m.manual_total, m.subtotal, m.total, m.commission_amount, m.payment_method]);
      }
      await client.query('COMMIT');
      report.committed = true;
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} report.committed = false; report.error = e.message; }
  }
  return report;
}

function print(r, commit) {
  const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  console.log(`\nBenta sa Google Sheets : ${r.sheetSales}`);
  console.log(`Benta sa Supabase      : ${r.supabaseSales}`);
  console.log(`KULANG sa Supabase     : ${r.missing.length}  (kabuuang ${peso(r.missingTotal)})`);
  r.missing.slice(0, 40).forEach((m) => console.log(`   ${String(m.date_iso).slice(0, 10)}  ${m.staff_name || '-'}  ${peso(m.total)}  ${m.payment_method || ''}`));
  if (r.missing.length > 40) console.log(`   ... at ${r.missing.length - 40} pa`);
  if (r.skipped.length) console.log(`Nilaktawan: ${r.skipped.length} (${[...new Set(r.skipped.map((x) => x.why))].join(', ')})`);
  console.log(`Customer na idadagdag: ${r.newCustomers.length} | benta na ililipat sa dating customer: ${r.remapped.length}`);
  r.remapped.slice(0, 20).forEach((x) => console.log(`   "${x.name}" -> nahanap sa Supabase (${x.how})`));
  console.log(`Nasa Supabase lang (wala sa Sheets, hindi ginagalaw): ${r.onlyInSupabase}`);
  if (commit) console.log(r.committed ? '\n✅ NAIDAGDAG na ang mga kulang na benta.' : r.error ? `\n❌ PUMALYA: ${r.error} (walang nabago)` : '\nWalang kulang. Walang idinagdag.');
  else console.log(r.missing.length ? '\nREPORT lang ito. Walang isinulat. Para idagdag ang kulang: node reconcileSales.js --commit' : '\n✅ Kumpleto: lahat ng benta sa Sheets ay nasa Supabase.');
}

async function main() {
  const commit = process.argv.includes('--commit');
  const data = loadDataTab();
  const client = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 6543), database: process.env.PG_DATABASE,
    user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60000, keepAlive: true,
  });
  client.on('error', (e) => console.log('   (pg client error:', e.message + ')'));
  await client.connect();
  try { print(await reconcile(client, data, loadExclusions(), commit), commit); } finally { await client.end(); }
}

module.exports = { reconcile, findMatch };
if (require.main === module) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
