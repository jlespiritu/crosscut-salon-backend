require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const requireApiKey = require('./middleware/apiKey');

const app = express();

// ---------- CORS: mga website lang na pinapayagan ----------
// Dagdag na domain? I-set ang CORS_ORIGINS sa host, hiwalay ng kuwit.
const DEFAULT_ORIGINS = [
  'https://exquisite-moonbeam-76eac3.netlify.app', // POS (Netlify)
  'https://crosscutsalonv2.vercel.app',            // Website (Vercel)
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

// Totoong services at staff data mula sa /data folder
const services = require('./data/services');
const staff = require('./data/staff');
const Booking = require('./models/Booking');

// ---------- Health check (bukas, walang key) ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// ---------- POS routes (Postgres) - PROTEKTADO ng API key ----------
const posRoutes = require('./routes/pos');
app.use('/pos', requireApiKey, posRoutes);

// GET home route
app.get('/', (req, res) => {
  res.send('Welcome to CrossCut Salon API');
});

// ---------- Public: para sa website ----------
// GET all services
app.get('/services', (req, res) => {
  res.json(services);
});

// GET single service by id
app.get('/services/:id', (req, res) => {
  const service = services.find((s) => s.id === parseInt(req.params.id));
  if (!service) {
    return res.status(404).json({ message: 'Service not found' });
  }
  res.json(service);
});

// GET all staff
app.get('/staff', (req, res) => {
  res.json(staff);
});

// GET single staff by id
app.get('/staff/:id', (req, res) => {
  const member = staff.find((s) => s.id === parseInt(req.params.id));
  if (!member) {
    return res.status(404).json({ message: 'Staff not found' });
  }
  res.json(member);
});

// ---------- Bookings ----------
// POST ay PUBLIC dahil ito ang booking form ng website.
// GET, PUT, DELETE ay PROTEKTADO: kapag public ang server, ang GET /bookings
// ay magpapakita ng pangalan at phone ng customers, at ang DELETE ay
// makakabura ng booking ng kahit sino.

// GET all bookings
app.get('/bookings', requireApiKey, async (req, res) => {
  try {
    const bookings = await Booking.find();
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching bookings' });
  }
});

// POST route - gumawa ng bagong booking
app.post('/bookings', async (req, res) => {
  try {
    const { name, phone, service, date, time } = req.body;

    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const newBooking = new Booking({ name, phone, service, date, time });
    await newBooking.save();

    res.status(201).json(newBooking);
  } catch (err) {
    res.status(500).json({ message: 'Error creating booking' });
  }
});

// PUT route - i-update ang existing booking
app.put('/bookings/:id', requireApiKey, async (req, res) => {
  try {
    const { name, phone, service, date, time } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (service) updateData.service = service;
    if (date) updateData.date = date;
    if (time) updateData.time = time;

    const booking = await Booking.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ message: 'Error updating booking' });
  }
});

// DELETE route - tanggalin ang isang booking
app.delete('/bookings/:id', requireApiKey, async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    res.json({ message: 'Booking deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting booking' });
  }
});

// ---------- Error handler (JSON, hindi HTML na may stack trace) ----------
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Server error' });
});

// ---------- Pag-connect sa databases at pag-start ----------
// Tumatakbo lang kapag "node index.js" ang ginamit (hindi kapag
// ni-require ng testServer.js), para hindi mag-connect ang test sa DB.
function connectDatabases() {
  // MongoDB (website bookings)
  if (process.env.MONGO_URI) {
    mongoose
      .connect(process.env.MONGO_URI)
      .then(() => console.log('Connected to MongoDB!'))
      .catch((err) => console.error('MongoDB connection error:', err));
  } else {
    console.warn('MONGO_URI ay hindi naka-set: hindi gagana ang /bookings.');
  }

  // Postgres (POS)
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

  connectDatabases();

  if (!process.env.API_KEY) {
    console.warn('BABALA: walang API_KEY. Lahat ng /pos request ay tatanggihan (500).');
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;