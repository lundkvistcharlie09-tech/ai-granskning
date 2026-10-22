require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-audit-token', 'x-admin-password']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200
});
app.use('/api/', limiter);

// Tracking endpoint gets higher limit (lots of pageviews)
const trackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 500
});
app.use('/track/', trackingLimiter);

// Routes
app.use('/api/audits', require('./routes/audits'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/email', require('./routes/email'));
app.use('/api/report', require('./routes/report'));
app.use('/api/admin', require('./routes/admin'));
app.use('/track', require('./routes/tracking'));

// Serve dashboard HTML
app.use(express.static('public'));

// Dashboard route – serves dashboard.html for /dashboard/:token
app.get('/dashboard/:token', (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

// Report route – serves report.html for /dashboard/:token/report
app.get('/dashboard/:token/report', (req, res) => {
  res.sendFile(__dirname + '/public/report.html');
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ai-granskning', version: '1.0.0' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AI-granskning server running on port ${PORT}`);
});

module.exports = app;
