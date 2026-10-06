require('dotenv').config();
const express = require('express');
const cors = require('cors');
const requireApiKey = require('./middleware/apiKey');

const app = express();

// ---------- CORS: mga website lang na pinapayagan ----------
// Ang POS (Netlify) lang ang gumagamit ng backend na ito.
// Dagdag na domain? I-set ang CORS_ORIGINS, hiwalay ng kuwit.
const DEFAULT_ORIGINS = [
  'https://exquisite-moonbeam-76eac3.netlify.app', // POS (Netlify)
];
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [...DEFAULT_ORIGINS, ...extraOrigins];
const localhostPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      // Walang Origin = hindi browser (curl, Postman, server-to-server): pinapayagan
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || localhostPattern.test(origin)) {
        return callback(null, true);
      }
      // Hindi pinapayagan: walang CORS header, kaya haharangin ng browser
      return callback(null, false);
    },
  })
);
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------- Health check (bukas, walang key) ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// ---------- POS routes (Postgres/Supabase): PROTEKTADO ng API key ----------
const posRoutes = require('./routes/pos');
app.use('/pos', requireApiKey, posRoutes);

// ---------- Error handler (JSON, hindi HTML na may stack trace) ----------
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Server error' });
});

// ---------- Pag-connect sa Postgres at pag-start ----------
// Tumatakbo lang kapag "node index.js" ang ginamit (hindi kapag
// ni-require ng testServer.js), para hindi mag-connect ang test sa DB.
function connectDatabase() {
  const pgPool = require('./db/pg');
  pgPool
    .query('SELECT NOW()')
    .then(() => console.log('Connected to Supabase Postgres!'))
    .catch((err) => console.error('Postgres connection error:', err));
}

if (require.main === module) {
  // Para hindi mag-crash ang buong server dahil sa isang nakalimutang error
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });

  connectDatabase();

  if (!process.env.API_KEY) {
    console.warn('BABALA: walang API_KEY. Lahat ng /pos request ay tatanggihan (500).');
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
