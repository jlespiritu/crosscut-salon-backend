// testServer.js
// Sinusubukan ang totoong index.js (API key, CORS, health, wala nang MongoDB).
// Walang sinusulat sa database: walang POST ng benta.

require('dotenv').config();
const path = require('path');
const app = require('./index');

const NETLIFY = 'https://exquisite-moonbeam-76eac3.netlify.app';
const VERCEL = 'https://crosscutsalonv2.vercel.app';
const EVIL = 'https://masamang-site.example';

const results = [];
function check(name, pass, extra) {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !extra ? '' : '  -> ' + extra}`);
}

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const key = process.env.API_KEY;
  const slow = { signal: AbortSignal.timeout(60000) }; // mabagal ang internet: hanggang 60 s

  try {
    if (!key) {
      console.log('WALANG API_KEY sa .env. Idagdag muna, saka ulitin.');
      process.exit(1);
    }

    const mongoLoaded = Object.keys(require.cache).some((k) =>
      k.includes(path.join('node_modules', 'mongoose'))
    );
    check('Hindi na nilo-load ang mongoose', !mongoLoaded);

    let r = await fetch(`${base}/health`);
    check('/health bukas, walang key (200)', r.status === 200, r.status);

    r = await fetch(`${base}/pos/staff`);
    check('/pos walang key -> 401', r.status === 401, r.status);

    r = await fetch(`${base}/pos/staff`, { headers: { 'x-api-key': 'mali' } });
    check('/pos maling key -> 401', r.status === 401, r.status);

    r = await fetch(`${base}/pos/staff`, { headers: { 'x-api-key': key }, ...slow });
    check('/pos/staff tamang key -> 200 (binabasa ang Postgres)', r.status === 200, r.status);

    for (const p of ['/bookings', '/services', '/staff', '/']) {
      r = await fetch(`${base}${p}`);
      check(`${p} wala na (404)`, r.status === 404, r.status);
    }

    r = await fetch(`${base}/pos/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: '{sira',
    });
    check('Sirang JSON -> 400 (hindi 500)', r.status === 400, r.status);

    r = await fetch(`${base}/pos/sales`, {
      method: 'OPTIONS',
      headers: {
        Origin: NETLIFY,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-api-key,content-type',
      },
    });
    const allow = r.headers.get('access-control-allow-origin');
    const hdrs = (r.headers.get('access-control-allow-headers') || '').toLowerCase();
    check(
      'Preflight mula sa POS (Netlify) pinapayagan, kasama ang x-api-key',
      r.status < 300 && allow === NETLIFY && hdrs.includes('x-api-key'),
      `status ${r.status}, allow-origin ${allow}`
    );

    r = await fetch(`${base}/pos/sales`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    check('Preflight mula localhost pinapayagan', r.headers.get('access-control-allow-origin') === 'http://localhost:5173');

    for (const [name, origin] of [['ng website (Vercel)', VERCEL], ['ng hindi kilalang site', EVIL]]) {
      r = await fetch(`${base}/pos/sales`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
      check(`Preflight ${name} HINDI pinapayagan`, r.headers.get('access-control-allow-origin') === null);
    }
  } catch (err) {
    console.error('May error sa test:', err.message);
    results.push(false);
  }

  server.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed === 0 ? `\nLAHAT PASS (${results.length})` : `\n${failed} ang pumalya`);
  process.exit(failed === 0 ? 0 : 1);
});
