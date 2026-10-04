/**
 * mergeDuplicates.js — pagsamahin ang DUPLICATE na customers sa Supabase.
 *
 *   node mergeDuplicates.js            -> DRY-RUN: ipapakita lang ang plano, WALANG binabago
 *   node mergeDuplicates.js --commit   -> isasagawa ang plano (isang transaction bawat grupo)
 *
 * MGA PATAKARAN (PHONE AY HINDI GINAGAMIT AT HINDI GINAGALAW; email ang batayan):
 *  - Parehong EMAIL + magkatugmang pangalan = iisang tao.
 *  - Parehong email pero ibang-iba ang pangalan -> REVIEW (hindi isasama).
 *  - Parehong PANGALAN (hindi pinapansin ang laki/liit ng letra at espasyo): isasama kung
 *    hindi hihigit sa 1 ang magkakaibang email. Kung may 2+ magkaibang email -> REVIEW.
 *  - Ang pananatilihin: may email > pinakamaraming benta > pinakamaaga.
 *  - Lahat ng benta ng mga kopya ay ililipat sa pananatilihin; ang blangkong email/facebook/notes
 *    ay pupunuan mula sa mga kopya. Ang phone ng pananatilihin ay HINDI babaguhin.
 */
require('dotenv').config();
const { Client } = require('pg');

const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
const blank = (v) => v == null || String(v).trim() === '';

async function loadCustomers(client) {
  const { rows } = await client.query(
    `SELECT c.id, c.name, c.phone, c.email, c.facebook, c.notes, c.created_at, count(s.id)::int AS sales
     FROM customers c LEFT JOIN sales s ON s.customer_id = c.id
     GROUP BY c.id, c.name, c.phone, c.email, c.facebook, c.notes, c.created_at
     ORDER BY c.created_at`
  );
  return rows;
}

const normEmail = (v) => String(v || '').toLowerCase().trim();
// Magkatugma ang pangalan kung pareho ang unang salita, o nasa loob ng isa ang kabila
// ("Haidee allorde" ~ "Haidee bianes allorde"). Ginagamit lang kapag EMAIL ang basehan.
const namesCompatible = (a, b) => {
  const x = normName(a), y = normName(b);
  if (!x || !y) return true;
  return x === y || x.split(' ')[0] === y.split(' ')[0] || x.includes(y) || y.includes(x);
};

function buildPlan(rows) {
  // Union-find: magdudugtong ang mga record na iisang tao
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => parent.set(find(a), find(b));
  const review = [];

  // 1) EMAIL ang pinakamalakas na batayan. Pareho ang email + magkatugma ang pangalan = iisang tao,
  //    kahit magkaiba ang phone. Pareho ang email pero ibang-iba ang pangalan -> review.
  const byEmail = new Map();
  rows.forEach((r) => { const e = normEmail(r.email); if (e) { if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push(r); } });
  for (const list of byEmail.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const odd = list.filter((r) => !namesCompatible(first.name, r.name));
    if (odd.length) { review.push({ why: 'parehong email, magkaibang pangalan', list }); continue; }
    list.slice(1).forEach((r) => union(first.id, r.id));
  }

  // 2) Parehong pangalan: isasama kung hindi hihigit sa 1 ang magkakaibang email.
  const byName = new Map();
  rows.forEach((r) => { const k = normName(r.name); if (k) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); } });
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    if (new Set(list.map((r) => find(r.id))).size === 1) continue;   // nasa iisang grupo na
    const emails = new Set(list.map((r) => normEmail(r.email)).filter(Boolean));
    if (emails.size > 1) { review.push({ why: 'parehong pangalan, magkaibang email', list }); continue; }
    list.slice(1).forEach((r) => union(list[0].id, r.id));
  }

  // 3) Buuin ang mga grupo
  const comps = new Map();
  rows.forEach((r) => { const k = find(r.id); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(r); });
  const merges = [];
  for (const list of comps.values()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort((a, b) =>
      (!blank(b.email) - !blank(a.email)) ||
      (b.sales - a.sales) ||
      (new Date(a.created_at) - new Date(b.created_at))
    );
    const keep = ranked[0];
    const dups = ranked.slice(1);
    const fill = {};
    ['email', 'facebook', 'notes'].forEach((f) => {
      if (blank(keep[f])) {
        const d = dups.find((x) => !blank(x[f]));
        if (d) fill[f] = d[f];
      }
    });
    const earliest = list.reduce((m, r) => (new Date(r.created_at) < new Date(m) ? r.created_at : m), keep.created_at);
    merges.push({ keep, dups, fill, earliest, salesMoved: dups.reduce((n, d) => n + d.sales, 0) });
  }

  return { merges, review };
}

function printPlan(plan) {
  const short = (id) => id.slice(-6);
  console.log(`\n=== PLANO NG PAGSASAMA: ${plan.merges.length} grupo ===`);
  plan.merges.forEach((m, i) => {
    console.log(`${i + 1}. "${m.keep.name}"  KEEP ...${short(m.keep.id)} (benta ${m.keep.sales}, email ${m.keep.email || '-'})`);
    m.dups.forEach((d) => console.log(`     burahin ...${short(d.id)} (benta ${d.sales}, email ${d.email || '-'})`));
    const f = Object.keys(m.fill);
    console.log(`     ililipat na benta: ${m.salesMoved}${f.length ? ' | popunan: ' + f.join(', ') : ''}`);
  });
  console.log(`\n=== KAILANGAN NG REVIEW: ${plan.review.length} ===`);
  plan.review.forEach((g) => console.log(`  [${g.why}] ` + g.list.map((r) => `"${r.name}" ${r.email || '(walang email)'} (benta ${r.sales})`).join('  |  ')));
  const del = plan.merges.reduce((n, m) => n + m.dups.length, 0);
  const mv = plan.merges.reduce((n, m) => n + m.salesMoved, 0);
  console.log(`\nKABUUAN: buburahin ${del} customer na kopya, ililipat ${mv} benta.`);
}

async function apply(client, plan) {
  let done = 0;
  for (const m of plan.merges) {
    const ids = m.dups.map((d) => d.id);
    const ph = ids.map((_, i) => '$' + (i + 1)).join(',');
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE sales SET customer_id = $1 WHERE customer_id IN (${ids.map((_, i) => '$' + (i + 2)).join(',')})`,
        [m.keep.id, ...ids]
      );
      await client.query(
        `UPDATE customers SET email = COALESCE($2, email),
           facebook = COALESCE($3, facebook), notes = COALESCE($4, notes), created_at = $5 WHERE id = $1`,
        [m.keep.id, m.fill.email || null, m.fill.facebook || null, m.fill.notes || null, m.earliest]
      );
      await client.query(`DELETE FROM customers WHERE id IN (${ph})`, ids);
      await client.query('COMMIT');
      done++;
      console.log(`  OK ${done}/${plan.merges.length}  "${m.keep.name}"`);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.log(`  PUMALYA "${m.keep.name}": ${e.message} (walang nabago sa grupong ito)`);
    }
  }
  return done;
}

async function main() {
  const commit = process.argv.includes('--commit');
  const client = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 6543),
    database: process.env.PG_DATABASE, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 60000,
  });
  await client.connect();
  try {
    const plan = buildPlan(await loadCustomers(client));
    printPlan(plan);
    if (!commit) { console.log('\nDRY-RUN lang ito. Walang binago. Para isagawa: node mergeDuplicates.js --commit'); return; }
    console.log('\nSinasagawa na...');
    await apply(client, plan);
    const after = buildPlan(await loadCustomers(client));
    console.log(`\nTapos. Natitirang grupong awtomatikong maisasama: ${after.merges.length} (dapat 0).`);
  } finally { await client.end(); }
}

module.exports = { buildPlan, loadCustomers, apply };
if (require.main === module) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
