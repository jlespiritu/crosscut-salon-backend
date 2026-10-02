require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

// I-connect sa MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.error('MongoDB connection error:', err));

// I-connect sa Postgres (POS)
const pgPool = require('./db/pg');
pgPool.query('SELECT NOW()')
  .then(() => console.log('Connected to Supabase Postgres!'))
  .catch((err) => console.error('Postgres connection error:', err));

// Totoong services at staff data mula sa /data folder
const services = require('./data/services');
const staff = require('./data/staff');
const Booking = require('./models/Booking');

// POS routes (Postgres)
const posRoutes = require('./routes/pos');
app.use('/pos', posRoutes);

// GET home route
app.get('/', (req, res) => {
  res.send('Welcome to CrossCut Salon API');
});

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

// GET all bookings
app.get('/bookings', async (req, res) => {
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
app.put('/bookings/:id', async (req, res) => {
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
app.delete('/bookings/:id', async (req, res) => {
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});