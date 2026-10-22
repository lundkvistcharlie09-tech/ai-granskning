const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/admin/stats – Overview of all active audits
router.get('/stats', adminAuth, async (req, res) => {
  const { data: audits } = await supabase
    .from('audits')
    .select('id, company_name, status, start_date, end_date, created_at');

  const allAudits = audits || [];
  const active = allAudits.filter(a => a.status === 'active');
  const completed = allAudits.filter(a => a.status === 'completed');

  res.json({
    total: allAudits.length,
    active: active.length,
    completed: completed.length,
    audits: allAudits.map(a => {
      const now = new Date();
      const start = new Date(a.start_date);
      const day = Math.min(7, Math.max(1, Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1));
      return { ...a, dayNumber: day };
    })
  });
});

// POST /api/admin/booking-import/:auditId – Manually import booking data
// For when client doesn't have a booking system API, they can paste CSV/JSON
router.post('/booking-import/:auditId', adminAuth, async (req, res) => {
  const { bookings } = req.body; // Array of { date, time, status, service }

  if (!bookings || !Array.isArray(bookings)) {
    return res.status(400).json({ error: 'bookings array required' });
  }

  const rows = bookings.map(b => ({
    audit_id: req.params.auditId,
    booking_date: b.date,
    booking_time: b.time || null,
    status: b.status || 'completed', // completed | no_show | cancelled
    service: b.service || null,
    duration_minutes: b.duration || null
  }));

  const { error } = await supabase.from('booking_events').insert(rows);

  if (error) {
    console.error('Booking import error:', error);
    return res.status(500).json({ error: 'Failed to import bookings' });
  }

  res.json({ success: true, imported: rows.length });
});

// POST /api/admin/trigger-report/:auditId – Force generate report
router.post('/trigger-report/:auditId', adminAuth, async (req, res) => {
  const { data: audit } = await supabase
    .from('audits')
    .select('*')
    .eq('id', req.params.auditId)
    .single();

  if (!audit) return res.status(404).json({ error: 'Audit not found' });

  // Call the report route with admin override
  req.audit = audit;
  req.headers['x-admin-password'] = process.env.ADMIN_PASSWORD;

  // Trigger report generation via internal call
  const reportRouter = require('./report');
  res.json({ message: 'Use POST /api/report/generate with x-audit-token and x-admin-password headers' });
});

module.exports = router;
