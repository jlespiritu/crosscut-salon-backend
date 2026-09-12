const express = require('express');
const services = require('./services');
const staff = require('./staff');

const app = express();
const PORT = 3000;

// MIDDLEWARE - 
app.use(express.json());

// In-memory storage 
const bookings = [];

app.get('/', (req, res) => {
  res.send('Hello from CrossCut Salon Backend!');
});

app.get('/services', (req, res) => {
  res.json(services);
});

app.get('/services/:id', (req, res) => {
  const serviceId = parseInt(req.params.id);
  const service = services.find((s) => s.id === serviceId);

  if (!service) {
    return res.status(404).json({ message: 'Service not found' });
  }

  res.json(service);
});

app.get('/staff', (req, res) => {
  res.json(staff);
});

app.get('/staff/:id', (req, res) => {
  const staffId = parseInt(req.params.id);
  const member = staff.find((s) => s.id === staffId);

  if (!member) {
    return res.status(404).json({ message: 'Staff member not found' });
  }

  res.json(member);
});

// POST route - 
app.post('/bookings', (req, res) => {
  const { name, phone, service, date, time } = req.body;

  if (!name || !phone || !service || !date || !time) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const newBooking = {
    id: bookings.length + 1,
    name,
    phone,
    service,
    date,
    time,
  };

  bookings.push(newBooking);

  res.status(201).json(newBooking);
});

// GET route - 
app.get('/bookings', (req, res) => {
  res.json(bookings);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});