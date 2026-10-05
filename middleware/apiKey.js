// middleware/apiKey.js
// Humihingi ng header na "x-api-key" sa bawat request.
// Fail-closed: kapag walang API_KEY sa env, HINDI papasukin ang kahit sino.

const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireApiKey(req, res, next) {
  // Ang browser preflight (OPTIONS) ay hindi nagpapadala ng custom header.
  // Hinahawakan na ito ng CORS, kaya palusutin dito.
  if (req.method === 'OPTIONS') return next();

  const expected = process.env.API_KEY;
  if (!expected) {
    console.error('API_KEY ay hindi naka-set sa environment. Tinanggihan ang request.');
    return res.status(500).json({ error: 'Server is not configured' });
  }

  const provided = req.get('x-api-key');
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = requireApiKey;