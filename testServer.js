// testServer.js
// Sinusubukan ang totoong index.js (CORS, API key, health, bookings).
// Walang sinusulat sa database: walang POST ng benta, walang booking na ginagawa.

require('dotenv').config();
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

    let r = await fetch(`${base}/health`);
    check('/health bukas, walang key (200)', r.status === 200, r.status);

    r = await fetch(`${base}/pos/staff`);
    check('/pos walang key -> 401', r.status === 401, r.status);

    r = await fetch(`${base}/pos/staff`, { headers: { 'x-api-key': 'mali' } });
    check('/pos maling key -> 401', r.status === 401, r.status);

    r = await fetch(`${base}/pos/staff`, { headers: { 'x-api-key': key }, ...slow });
    check('/pos/staff tamang key -> 200 (binabasa ang Postgres)', r.status === 200, r.status);

    r = await fetch(`${base}/bookings`);
    check('GET /bookings walang key -> 401', r.status === 401, r.status);

    r = await fetch(`${base}/bookings/abc`, { method: 'DELETE' });
    check('DELETE /bookings walang key -> 401', r.status === 401, r.status);

    r = await fetch(`${base}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('POST /bookings ay public (kulang na fields -> 400)', r.status === 400, r.status);

    r = await fetch(`${base}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{sira',
    });
    check('Sirang JSON -> 400 (hindi 500)', r.status === 400, r.status);

    r = await fetch(`${base}/services`);
    check('/services public (200)', r.status === 200, r.status);

    r = await fetch(`${base}/staff`);
    check('/staff public (200)', r.status === 200, r.status);

    for (const origin of [NETLIFY, VERCEL]) {
      r = await fetch(`${base}/pos/sales`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'x-api-key,content-type',
        },
      });
      const allow = r.headers.get('access-control-allow-origin');
      const hdrs = (r.headers.get('access-control-allow-headers') || '').toLowerCase();
      check(
        `Preflight mula ${origin.replace('https://', '')} pinapayagan, kasama ang x-api-key`,
        r.status < 300 && allow === origin && hdrs.includes('x-api-key'),
        `status ${r.status}, allow-origin ${allow}`
      );
    }

    r = await fetch(`${base}/pos/sales`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    check('Preflight mula localhost:5173 pinapayagan', r.headers.get('access-control-allow-origin') === 'http://localhost:5173');

    r = await fetch(`${base}/pos/sales`, {
      method: 'OPTIONS',
      headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' },
    });
    check('Preflight mula sa hindi kilalang site HINDI pinapayagan', r.headers.get('access-control-allow-origin') === null);
  } catch (err) {
    console.error('May error sa test:', err.message);
    results.push(false);
  }

  server.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed === 0 ? '\nLAHAT PASS' : `\n${failed} ang pumalya`);
  process.exit(failed === 0 ? 0 : 1);
});