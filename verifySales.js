/**
 * verifySales.js — PATUNAYAN na pareho ang mga benta sa Google Sheets at sa Supabase.
 *
 *   node verifySales.js
 *
 * Mga hakbang bago patakbuhin: i-export ang "Data" tab ng Sheets bilang import\data.csv
 * (kailangang BAGO ang export para kasama ang pinakabagong benta).
 *
 * WALA itong isinusulat kahit saan. Binabasa lang ang CSV at ang Supabase.
 * Kino-compare ang BAWAT benta (ayon sa id): petsa, total, subtotal, discount, commission,
 * staff, payment method at mga service. Ipinapakita rin ang kabuuan kada buwan, kada staff
 * at kada payment method sa dalawang panig, at kung tama ang customer ng bawat benta.
 * Ang email at phone ay HINDI mahalaga rito.
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
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };
const num = (v) => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toMs = (v) => { if (v === null || v === undefined || v === '') return null; const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.getTime(); };
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const same = (a, b, tol = 0.005) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= tol);

function loadDataTab() {
  if (!fs.existsSync(CSV_PATH)) { console.error(`Hindi makita ang ${CSV_PATH}`); process.exit(1); }
  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  const out = {};
  for (const r of rows) {
    const key = String(r.key || '').trim();
    if (!key.startsWith('crosscut-')) continue;
    try { out[key] = JSON.parse(r.value); } catch (e) { console.log(`⚠️  ${key}: hindi ma-parse (${e.message})`); }
  }
  return out;
}
function loadExclusions() {
  if (!fs.existsSync(EXCLUDE_PATH)) return { names: [], ids: [] };
  const j = JSON.parse(fs.readFileSync(EXCLUDE_PATH, 'utf8').replace(/^﻿/, ''));
  return { names: j.names || [], ids: j.ids || [] };
}

const normSheet = (s, custName) => ({
  id: String(s.id),
  ms: toMs(pick(s, 'dateISO', 'date')),
  total: num(s.total),
  subtotal: num(s.subtotal),
  discount: num(pick(s, 'discountPercent')) ?? 0,
  commission: num(pick(s, 'commissionAmount', 'commission')),
  staffId: pick(s, 'staffId'),
  method: low(pick(s, 'paymentMethod', 'method')),
  services: (Array.isArray(s.serviceIds) ? s.serviceIds.map(String) : []).sort().join(','),
  customer: normName(custName),
  month: String(pick(s, 'dateISO', 'date') || '').slice(0, 7),
  staffName: pick(s, 'staffName') || '(wala)',
});
const normDb = (r) => ({
  id: String(r.id),
  ms: toMs(r.date_iso),
  total: num(r.total),
  subtotal: num(r.subtotal),
  discount: num(r.discount_percent) ?? 0,
  commission: num(r.commission_amount),
  staffId: r.staff_id,
  method: low(r.payment_method),
  services: (r.service_ids || []).map(String).sort().join(','),
  customer: normName(r.customer_name),
  month: r.date_iso ? new Date(r.date_iso).toISOString().slice(0, 7) : '',
  staffName: r.staff_name || '(wala)',
});

function compare(data, excl, dbRows) {
  const sheetSales = Array.isArray(data['crosscut-sales']) ? data['crosscut-sales'] : [];
  const custs = new Map((Array.isArray(data['crosscut-customers']) ? data['crosscut-customers'] : []).map((c) => [String(c.id), c]));
  const exN = new Set(excl.names.map(low)), exI = new Set(excl.ids.map(String));
  const testSkipped = [];
  const sheet = [];
  for (const s of sheetSales) {
    const c = custs.get(String(s.customerId));
    const name = s.customerName || (c && c.name) || '';
    if (exI.has(String(s.customerId)) || exN.has(low(name))) { testSkipped.push(s); continue; }
    sheet.push(normSheet(s, name));
  }
  const db = dbRows.map(normDb);
  const sM = new Map(sheet.map((x) => [x.id, x])), dM = new Map(db.map((x) => [x.id, x]));
  const missing = sheet.filter((x) => !dM.has(x.id));
  const extra = db.filter((x) => !sM.has(x.id));
  const diffs = [];
  for (const a of sheet) {
    const b = dM.get(a.id); if (!b) continue;
    const bad = [];
    if (a.ms !== b.ms) bad.push(`petsa ${a.ms ? new Date(a.ms).toISOString() : '-'} ≠ ${b.ms ? new Date(b.ms).toISOString() : '-'}`);
    if (!same(a.total, b.total)) bad.push(`total ${a.total} ≠ ${b.total}`);
    if (!same(a.subtotal, b.subtotal)) bad.push(`subtotal ${a.subtotal} ≠ ${b.subtotal}`);
    if (!same(a.discount, b.discount)) bad.push(`discount ${a.discount} ≠ ${b.discount}`);
    if (!same(a.commission, b.commission, 0.01)) bad.push(`commission ${a.commission} ≠ ${b.commission}`);
    if (a.staffId !== b.staffId) bad.push(`staff ${a.staffId} ≠ ${b.staffId}`);
    if (a.method !== b.method) bad.push(`method ${a.method} ≠ ${b.method}`);
    if (a.services !== b.services) bad.push(`services ${a.services} ≠ ${b.services}`);
    if (bad.length) diffs.push({ id: a.id, total: a.total, bad });
  }
  const custDiff = sheet.filter((a) => dM.has(a.id) && a.customer && dM.get(a.id).customer !== a.customer)
    .map((a) => ({ id: a.id, sheet: a.customer, db: dM.get(a.id).customer || '(walang customer)' }));
  const sum = (arr) => arr.reduce((n, x) => n + (x.total || 0), 0);
  const group = (arr, k) => arr.reduce((m, x) => { m[x[k]] = (m[x[k]] || 0) + (x.total || 0); return m; }, {});
  return { sheet, db, missing, extra, diffs, custDiff, testSkipped,
    sheetTotal: sum(sheet), dbTotal: sum(db),
    byMonth: [group(sheet, 'month'), group(db, 'month')],
    byStaff: [group(sheet, 'staffName'), group(db, 'staffName')],
    byMethod: [group(sheet, 'method'), group(db, 'method')] };
}

function table(title, [a, b]) {
  console.log(`\n${title}`);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  keys.forEach((k) => {
    const ok = Math.abs((a[k] || 0) - (b[k] || 0)) < 0.005;
    console.log(`  ${ok ? '✅' : '❌'} ${String(k || '(wala)').padEnd(14)} Sheets ${peso(a[k]).padStart(14)}   Supabase ${peso(b[k]).padStart(14)}`);
  });
}

function print(r) {
  console.log(`\nBenta sa Google Sheets (bukod ang test) : ${r.sheet.length}   kabuuan ${peso(r.sheetTotal)}`);
  console.log(`Benta sa Supabase                        : ${r.db.length}   kabuuan ${peso(r.dbTotal)}`);
  console.log(`Test na benta sa Sheets na hindi binilang: ${r.testSkipped.length}`);
  table('KADA BUWAN', r.byMonth); table('KADA STAFF', r.byStaff); table('KADA PAYMENT METHOD', r.byMethod);
  console.log(`\nKulang sa Supabase           : ${r.missing.length}`);
  r.missing.slice(0, 30).forEach((x) => console.log(`   ${new Date(x.ms).toISOString().slice(0, 10)} ${x.staffName} ${peso(x.total)}`));
  console.log(`Sobra sa Supabase (wala sa Sheets): ${r.extra.length}`);
  r.extra.slice(0, 30).forEach((x) => console.log(`   ${x.month} ${x.staffName} ${peso(x.total)}`));
  console.log(`Magkaiba ang laman             : ${r.diffs.length}`);
  r.diffs.slice(0, 30).forEach((d) => console.log(`   ${d.id}: ${d.bad.join('; ')}`));
  console.log(`Magkaiba ang pangalan ng customer: ${r.custDiff.length}  (info lang)`);
  r.custDiff.slice(0, 15).forEach((d) => console.log(`   "${d.sheet}" sa Sheets, "${d.db}" sa Supabase`));
  const perfect = !r.missing.length && !r.extra.length && !r.diffs.length && Math.abs(r.sheetTotal - r.dbTotal) < 0.005;
  console.log(perfect
    ? `\n✅ PAREHONG-PAREHO: ${r.sheet.length} benta, ${peso(r.sheetTotal)}. Bawat benta ay tugma sa Supabase.`
    : '\n❌ MAY PAGKAKAIBA. Tingnan ang listahan sa itaas at ipadala sa akin. Walang binago ang script na ito.');
}

async function main() {
  const data = loadDataTab();
  const client = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 6543), database: process.env.PG_DATABASE,
    user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60000, keepAlive: true,
  });
  client.on('error', (e) => console.log('   (pg client error:', e.message + ')'));
  await client.connect();
  try {
    const { rows } = await client.query('SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id');
    print(compare(data, loadExclusions(), rows));
  } finally { await client.end(); }
}

module.exports = { compare };
if (require.main === module) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
