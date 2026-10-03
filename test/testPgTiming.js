require('dotenv').config();
const { Client } = require('pg');

async function once(i) {
  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
  const start = Date.now();
  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log(`Try ${i}: connected in ${Date.now() - start} ms`);
  } catch (err) {
    console.log(`Try ${i}: FAILED after ${Date.now() - start} ms - ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  for (let i = 1; i <= 6; i++) {
    await once(i);
    await new Promise((r) => setTimeout(r, 3000));
  }
})();