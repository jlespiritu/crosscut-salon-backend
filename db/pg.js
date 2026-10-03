const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },

  // Mabagal bumuo ng bagong connection mula sa PC na ito (7-21s), kaya:
  // - huwag isara agad ang idle connection (10 minuto na)
  // - bigyan ng sapat na oras ang pagbuo ng connection (45s)
  max: 5,
  idleTimeoutMillis: 600000,
  connectionTimeoutMillis: 45000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Kapag may idle connection na namatay, hindi dapat mag-crash ang buong server.
pool.on('error', (err) => {
  console.error('Idle Postgres client error (pool will reconnect):', err.message);
});

// Isang awtomatikong retry LANG kung connection-level ang error.
// Ang ibang error (maling SQL, duplicate key, atbp.) ay hindi ni-re-retry.
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
  '57P01', '57P02', '57P03',
  '08000', '08003', '08006',
]);

const originalQuery = pool.query.bind(pool);
pool.query = async (...args) => {
  try {
    return await originalQuery(...args);
  } catch (err) {
    const dropped =
      RETRYABLE_CODES.has(err.code) ||
      /Connection terminated|ECONNRESET/i.test(err.message || '');
    if (dropped) {
      console.warn('Postgres connection dropped, retrying once:', err.message);
      return originalQuery(...args);
    }
    throw err;
  }
};

// Heartbeat: isang maliit na "SELECT 1" kada 25 segundo para hindi mamatay ang
// connection habang walang ginagawa. Hindi nito pinipigilan ang pag-shutdown ng server.
const HEARTBEAT_MS = 25000;
const heartbeat = setInterval(() => {
  pool.query('SELECT 1').catch((err) => {
    console.warn('Postgres heartbeat failed:', err.message);
  });
}, HEARTBEAT_MS);
heartbeat.unref();

module.exports = pool;