const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/reservation', (req, res) => {
  const { name, email, phone, room, checkin, checkout, guests, specialRequests } = req.body;
  if (!name || !email || !room || !checkin || !checkout) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  const confirmationNumber = 'VM-' + Date.now().toString(36).toUpperCase();
  res.json({
    success: true,
    message: 'Reservation request received successfully.',
    confirmation: confirmationNumber,
    details: { name, email, room, checkin, checkout, guests }
  });
});

app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  res.json({ success: true, message: 'Your message has been received. We will respond within 24 hours.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Villa Maris Tiburon server running on port ${PORT}`);
});
