// importFromSheets.js (v2)
// Isang beses na import: Google Sheets "Data" tab (CSV) -> Supabase Postgres
//
// Paggamit (sa C:\Projects\crosscut-salon-backend):
//   node importFromSheets.js --offline   -> basa lang ng CSV, walang koneksyon sa database
//   node importFromSheets.js             -> DRY-RUN na may koneksyon (walang isinusulat)
//   node importFromSheets.js --commit    -> aktuwal na import
//
// Kailangan: import\data.csv (export ng "Data" tab), .env na may PG_HOST, PG_PORT,
// PG_DATABASE, PG_USER, PG_PASSWORD, at `npm install csv-parse`.
//
// Test customers na hindi isasama: gumawa ng import\exclude.json
//   { "names": ["jlesp"], "ids": ["cust_xxx"] }
//
// Ligtas: ON CONFLICT (id) DO NOTHING, kaya hindi nito ino-overwrite ang mga
// row na nandoon na. Hindi rin ini-import ang PIN ng staff.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Client } = require('pg');

const CSV_PATH = path.join(__dirname, 'import', 'data.csv');
const EXCLUDE_PATH = path.join(__dirname, 'import', 'exclude.json');
const BATCH_SIZE = 25;
const MAX_RETRIES = 3;

const COMMIT = process.argv.includes('--commit');
const OFFLINE = process.argv.includes('--offline');

// ---------- Maliliit na helper ----------
const low = (s) => String(s || '').trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (o, ...keys) => {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return null;
};
const num = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toISO = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const firstArray = (o, ...keys) => {
  for (const k of keys) if (o && Array.isArray(o[k])) return o[k];
  return [];
};
const normPhone = (p) => {
  if (!p) return null;
  const digits = String(p).replace(/[^\d]/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return '0' + digits;
  return String(p).trim();
};
const keyCounts = (arr) => {
  const m = {};
  for (const o of arr) for (const k of Object.keys(o || {})) m[k] = (m[k] || 0) + 1;
  return m;
};

// ---------- 1. Basahin ang CSV at exclude.json ----------
function loadDataTab() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Hindi makita ang ${CSV_PATH}`);
    console.error('I-export ang "Data" tab bilang CSV at ilagay sa import\\data.csv');
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
  const out = {};
  for (const r of rows) {
    const key = String(r.key || '').trim();
    if (!key.startsWith('crosscut-')) continue;
    try {
      out[key] = JSON.parse(r.value);
    } catch (e) {
      console.log(`⚠️  ${key}: hindi ma-parse ang JSON (${e.message}).`);
      console.log('    Baka putol ang cell (limit ng Google Sheets: 50,000 characters).');
    }
  }
  return out;
}

function loadExclusions() {
  if (!fs.existsSync(EXCLUDE_PATH)) {
    console.log('Walang import\\exclude.json: WALANG ie-exclude na customer.');
    return { names: [], ids: [] };
  }
  try {
    const j = JSON.parse(fs.readFileSync(EXCLUDE_PATH, 'utf8').replace(/^\uFEFF/, ''));
    const names = Array.isArray(j.names) ? j.names : [];
    const ids = Array.isArray(j.ids) ? j.ids : [];
    console.log(`exclude.json: ${names.length} pangalan, ${ids.length} ID`);
    return { names, ids };
  } catch (e) {
    console.error('Hindi mabasa ang import\\exclude.json:', e.message);
    process.exit(1);
  }
}

// ---------- 2. Mappers (Sheets JSON -> Postgres columns) ----------
const mapStaff = (s) => ({
  id: String(s.id),
  name: pick(s, 'name'),
  role: pick(s, 'role'),
  pin: null, // sadyang hindi ini-import; Phase 6 na ang bahala rito
  commission_rate: num(pick(s, 'commissionRate', 'commission', 'rate', 'commissionPct')),
  commission_override: num(pick(s, 'commissionOverride')),
  active: s.active !== false,
  pay_type: pick(s, 'payType', 'pay_type'),
});

const mapService = (s) => ({
  id: String(s.id),
  name: pick(s, 'name'),
  price: num(pick(s, 'price')),
  duration: num(pick(s, 'duration')),
  category: pick(s, 'category'),
  commission_override: num(pick(s, 'commissionOverride')),
});

const mapProduct = (p) => ({
  id: String(p.id),
  name: pick(p, 'name'),
  cost: num(pick(p, 'cost')),
  price: num(pick(p, 'price')),
  stock: num(pick(p, 'stock')),
  low_stock_at: num(pick(p, 'lowStockAt')),
  staff_commission: num(pick(p, 'staffCommission')),
});

const mapCustomer = (c) => ({
  id: String(c.id),
  name: pick(c, 'name'),
  phone: normPhone(pick(c, 'phone')),
  email: pick(c, 'email'),
  facebook: pick(c, 'facebook'),
  notes: pick(c, 'notes'),
  created_at: toISO(pick(c, 'createdAt')) || new Date().toISOString(),
});

const mapSale = (s) => ({
  id: String(s.id),
  date_iso: toISO(pick(s, 'dateISO', 'date')),
  staff_id: pick(s, 'staffId'),
  staff_name: pick(s, 'staffName'),
  customer_id: pick(s, 'customerId'),
  service_ids: Array.isArray(s.serviceIds) ? s.serviceIds.map(String) : [],
  product_lines: JSON.stringify(firstArray(s, 'productLines', 'products', 'productItems')),
  discount_percent: num(pick(s, 'discountPercent')) ?? 0,
  // manualOverride === true: manual na inilagay ang total (ang `total` ang huling presyo)
  manual_total: s.manualOverride === true ? num(s.total) : num(pick(s, 'manualTotal', 'manualOverride')),
  subtotal: num(pick(s, 'subtotal')),
  total: num(pick(s, 'total')),
  commission_amount: num(pick(s, 'commissionAmount', 'commission')),
  payment_method: pick(s, 'paymentMethod', 'method'),
});

// Mga field sa Sheets na may katumbas na column. Ang iba ay iuulat bilang "hindi maisasama".
const TABLES = {
  staff: {
    key: 'crosscut-staff', map: mapStaff, types: {},
    mapped: ['id', 'name', 'role', 'pin', 'commissionRate', 'commission', 'rate', 'commissionPct', 'commissionOverride', 'active', 'payType', 'pay_type'],
  },
  services: {
    key: 'crosscut-services', map: mapService, types: {},
    mapped: ['id', 'name', 'price', 'duration', 'category', 'commissionOverride'],
  },
  products: {
    key: 'crosscut-products', map: mapProduct, types: {},
    mapped: ['id', 'name', 'cost', 'price', 'stock', 'lowStockAt', 'staffCommission'],
  },
  customers: {
    key: 'crosscut-customers', map: mapCustomer, types: { created_at: 'timestamptz' },
    mapped: ['id', 'name', 'phone', 'email', 'facebook', 'notes', 'createdAt'],
  },
  sales: {
    key: 'crosscut-sales', map: mapSale,
    types: { service_ids: 'text[]', product_lines: 'jsonb', date_iso: 'timestamptz' },
    mapped: ['id', 'dateISO', 'date', 'staffId', 'staffName', 'customerId', 'customerName', 'serviceIds', 'productLines', 'products', 'productItems', 'discountPercent', 'manualTotal', 'manualOverride', 'subtotal', 'total', 'commissionAmount', 'commission', 'paymentMethod', 'method'],
  },
};

// ---------- 3. Database ----------
async function connect() {
  const c = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 6543),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60000,
    keepAlive: true,
  });
  c.on('error', (e) => console.log('   (pg client error:', e.message + ')'));
  await c.connect();
  return c;
}

async function insertBatch(client, table, cols, types, rows) {
  const values = [];
  const placeholders = rows.map((row, i) => {
    const ph = cols.map((c, j) => {
      values.push(row[c]);
      const cast = types[c] ? '::' + types[c] : '';
      return `$${i * cols.length + j + 1}${cast}`;
    });
    return '(' + ph.join(',') + ')';
  });
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT (id) DO NOTHING`;
  const res = await client.query(sql, values);
  return res.rowCount;
}

// ---------- 4. Main ----------
(async () => {
  console.log(COMMIT ? '=== COMMIT MODE ===' : OFFLINE ? '=== OFFLINE CHECK ===' : '=== DRY-RUN (walang isinusulat) ===');
  const data = loadDataTab();
  const excl = loadExclusions();

  // Ihanda ang bawat dataset
  const prepared = {};
  for (const [table, def] of Object.entries(TABLES)) {
    const raw = Array.isArray(data[def.key]) ? data[def.key] : [];
    if (!Array.isArray(data[def.key])) console.log(`⚠️  Walang laman o hindi array: ${def.key}`);
    const withId = raw.filter((r) => r && r.id);
    if (raw.length !== withId.length) console.log(`⚠️  ${table}: ${raw.length - withId.length} item na walang id (lalaktawan)`);
    prepared[table] = { raw: withId, rows: withId.map(def.map) };
  }

  // Test customers: i-exclude (pati ang mga benta nila)
  const exName = new Set(excl.names.map(low));
  const exIds = new Set(excl.ids);
  for (const c of prepared.customers.raw) {
    if (exName.has(low(c.name))) exIds.add(String(c.id));
  }
  const custBefore = prepared.customers.rows.length;
  prepared.customers.raw = prepared.customers.raw.filter((c) => !exIds.has(String(c.id)));
  prepared.customers.rows = prepared.customers.rows.filter((c) => !exIds.has(c.id));
  const salesBefore = prepared.sales.rows.length;
  const keepSale = (rawSale) => {
    if (rawSale.customerId && exIds.has(String(rawSale.customerId))) return false;
    if (exName.has(low(rawSale.customerName))) return false;
    return true;
  };
  const keptRaw = prepared.sales.raw.filter(keepSale);
  const keptIds = new Set(keptRaw.map((s) => String(s.id)));
  prepared.sales.raw = keptRaw;
  prepared.sales.rows = prepared.sales.rows.filter((s) => keptIds.has(s.id));

  // Ulat: lahat ng field na nakita (may bilang kung hindi lahat ng item ang may ganoon)
  console.log('\n--- Mga field na nakita sa Sheets (bilang sa panaklong kung hindi lahat) ---');
  for (const [table, def] of Object.entries(TABLES)) {
    const raw = prepared[table].raw;
    const kc = keyCounts(raw);
    const text = Object.entries(kc).map(([k, n]) => (n === raw.length ? k : `${k}(${n})`)).join(', ');
    console.log(`${table}: ${text || '(walang laman)'}`);
    const lost = Object.entries(kc).filter(([k]) => !def.mapped.includes(k)).map(([k, n]) => (n === raw.length ? k : `${k}(${n})`));
    if (lost.length) console.log(`   hindi maisasama (walang column): ${lost.join(', ')}`);
  }

  console.log('\n--- Bilang ---');
  for (const table of Object.keys(TABLES)) console.log(`${table}: ${prepared[table].rows.length}`);
  console.log(`Na-exclude (test): ${custBefore - prepared.customers.rows.length} customer, ${salesBefore - prepared.sales.rows.length} benta`);

  // Mga babala at istatistika sa benta
  const rs = prepared.sales.raw;
  const custIds = new Set(prepared.customers.rows.map((c) => c.id));
  const staffIdSet = new Set(prepared.staff.rows.map((s) => s.id));
  const orphanCust = prepared.sales.rows.filter((s) => s.customer_id && !custIds.has(s.customer_id)).length;
  if (orphanCust) console.log(`⚠️  ${orphanCust} benta na ang customer_id ay wala sa customers list (papasok pa rin, walang FK).`);
  const orphanStaff = prepared.sales.rows.filter((s) => s.staff_id && !staffIdSet.has(s.staff_id)).length;
  if (orphanStaff) console.log(`⚠️  ${orphanStaff} benta na ang staff_id ay wala sa staff list.`);
  const noTotal = prepared.sales.rows.filter((s) => s.total === null).length;
  if (noTotal) console.log(`⚠️  ${noTotal} benta na walang total.`);
  const noDate = prepared.sales.rows.filter((s) => s.date_iso === null).length;
  if (noDate) console.log(`⚠️  ${noDate} benta na walang wastong petsa.`);
  const dates = prepared.sales.rows.map((s) => s.date_iso).filter(Boolean).sort();
  if (dates.length) console.log(`Saklaw ng petsa ng benta: ${dates[0]}  hanggang  ${dates[dates.length - 1]}`);

  const multiStaff = rs.filter((s) => Array.isArray(s.staffIds) && s.staffIds.length > 1).length;
  const manualTrue = rs.filter((s) => s.manualOverride === true).length;
  const manualNum = rs.filter((s) => num(s.manualOverride) !== null).length;
  const manualOdd = rs.filter((s) => s.manualOverride !== undefined && s.manualOverride !== null && s.manualOverride !== '' && s.manualOverride !== true && s.manualOverride !== false && num(s.manualOverride) === null).length;
  const withProducts = rs.filter((s) => firstArray(s, 'productLines', 'products', 'productItems').length > 0).length;
  console.log('\n--- Mga benta: detalye na dapat tingnan ---');
  console.log(`may product lines: ${withProducts}`);
  console.log(`manualOverride = true (manual na inilagay ang total, ilalagay sa manual_total): ${manualTrue}`);
  console.log(`manualOverride na numero: ${manualNum}${manualOdd ? `  | ⚠️ ${manualOdd} na kakaiba ang laman (hindi true/false/numero)` : ''}`);
  console.log(`hinati sa mahigit 1 staff (staffIds): ${multiStaff}  <- ang hati ng commission ay hindi maisasama sa ngayon`);

  console.log('\n--- Staff (para i-check ang commission/pay type) ---');
  for (const s of prepared.staff.rows) {
    console.log(`${s.id} | ${s.name} | ${s.role} | rate=${s.commission_rate} | override=${s.commission_override} | ${s.pay_type} | active=${s.active}`);
  }

  if (OFFLINE) {
    console.log('\n(--offline: hindi kumonekta sa database)');
    return;
  }

  // Koneksyon (mabagal ang internet mo; pwedeng umabot ng ~20 segundo)
  console.log('\nKumokonekta sa Supabase... (maghintay, pwedeng 10-30 segundo)');
  let client = await connect();

  // Mga staff/services/products na nasa Supabase na (malamang test seed): hanapin ang banggaan
  console.log('\n--- Staff, services at products na nasa Supabase na ---');
  for (const table of ['staff', 'services', 'products']) {
    const res = await client.query(`SELECT id, name FROM ${table}`);
    const sheetMap = new Map(prepared[table].rows.map((r) => [r.id, r.name]));
    if (!res.rows.length) console.log(`${table}: walang laman sa Supabase`);
    for (const r of res.rows) {
      if (sheetMap.has(r.id)) {
        if (low(sheetMap.get(r.id)) !== low(r.name)) {
          console.log(`⚠️  ${table}: id ${r.id} ay "${r.name}" sa Supabase pero "${sheetMap.get(r.id)}" sa Sheets (LALAKTAWAN ng import, kailangang ayusin)`);
        }
      } else {
        console.log(`ℹ️  ${table}: "${r.name}" (id ${r.id}) ay nasa Supabase pero wala sa Sheets (malamang test seed)`);
      }
    }
  }

  // Alin ang bago at alin ang nandoon na?
  const toInsert = {};
  console.log('\n--- Kumpara sa laman ng Supabase ngayon ---');
  for (const table of Object.keys(TABLES)) {
    const res = await client.query(`SELECT id FROM ${table}`);
    const existing = new Set(res.rows.map((r) => r.id));
    toInsert[table] = prepared[table].rows.filter((r) => !existing.has(r.id));
    const sheetIds = new Set(prepared[table].rows.map((r) => r.id));
    const extra = [...existing].filter((id) => !sheetIds.has(id)).length;
    console.log(`${table}: nandoon na ${existing.size} | bago ang ${toInsert[table].length} | laktaw ang ${prepared[table].rows.length - toInsert[table].length} | nasa Supabase lang (wala sa Sheets): ${extra}`);
  }

  if (!COMMIT) {
    console.log('\nDRY-RUN tapos na. Walang isinulat. Kung maayos ang lahat, patakbuhin: node importFromSheets.js --commit');
    await client.end();
    return;
  }

  // Aktuwal na import, maliliit na batch na may retry
  const ORDER = ['staff', 'services', 'products', 'customers', 'sales'];
  for (const table of ORDER) {
    const rows = toInsert[table];
    if (!rows.length) { console.log(`\n${table}: walang bago, laktaw`); continue; }
    const cols = Object.keys(rows[0]);
    const types = TABLES[table].types;
    let inserted = 0;
    console.log(`\n${table}: ${rows.length} row, ${Math.ceil(rows.length / BATCH_SIZE)} batch`);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const bn = Math.floor(i / BATCH_SIZE) + 1;
      let ok = false;
      for (let attempt = 1; attempt <= MAX_RETRIES && !ok; attempt++) {
        try {
          inserted += await insertBatch(client, table, cols, types, batch);
          ok = true;
          console.log(`  batch ${bn}: OK (${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length})`);
        } catch (e) {
          console.log(`  batch ${bn}, subok ${attempt}/${MAX_RETRIES}: ${e.message}`);
          try { await client.end(); } catch (_) {}
          if (attempt < MAX_RETRIES) {
            await sleep(3000 * attempt);
            try { client = await connect(); } catch (ce) { console.log(`  hindi maka-reconnect: ${ce.message}`); }
          }
        }
      }
      if (!ok) {
        console.log(`\n❌ Huminto sa ${table}, batch ${bn}. Ligtas patakbuhin ulit ang script (laktaw nito ang mga nandoon na).`);
        process.exit(1);
      }
    }
    console.log(`${table}: ${inserted} ang naipasok`);
  }

  console.log('\n--- Panghuling bilang sa Supabase ---');
  for (const table of ORDER) {
    const r = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    console.log(`${table}: ${r.rows[0].n}`);
  }
  await client.end();
  console.log('\n✅ Tapos na ang import.');
})().catch((e) => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
