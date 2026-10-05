// testApiKey.js
// Sinusubukan ang middleware gamit ang maliit na Express app. Walang database.

const express = require('express');
const cors = require('cors');
const requireApiKey = require('./middleware/apiKey');

const app = express();
app.use(cors());
app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/pos', requireApiKey, (req, res) => res.json({ secret: 'data' }));

const results = [];
function check(name, pass) {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const goodKey = 'test-key-123';
  process.env.API_KEY = goodKey;

  try {
    let r = await fetch(`${base}/health`);
    check('/health bukas kahit walang key (200)', r.status === 200);

    r = await fetch(`${base}/pos/sales`);
    check('/pos walang key -> 401', r.status === 401);

    r = await fetch(`${base}/pos/sales`, { headers: { 'x-api-key': 'mali' } });
    check('/pos maling key -> 401', r.status === 401);

    r = await fetch(`${base}/pos/sales`, { headers: { 'x-api-key': goodKey } });
    check('/pos tamang key -> 200', r.status === 200);

    r = await fetch(`${base}/pos/sales`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://exquisite-moonbeam-76eac3.netlify.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-api-key,content-type',
      },
    });
    check('OPTIONS preflight pumapasok walang key (<300)', r.status < 300);

    delete process.env.API_KEY;
    r = await fetch(`${base}/pos/sales`, { headers: { 'x-api-key': goodKey } });
    check('walang API_KEY sa env -> 500 (fail-closed)', r.status === 500);
  } catch (err) {
    console.error('May error sa test:', err.message);
    results.push(false);
  }

  server.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed === 0 ? '\nLAHAT PASS' : `\n${failed} ang pumalya`);
  process.exit(failed === 0 ? 0 : 1);
});