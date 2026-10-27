const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { generateTrackingSnippet } = require('../lib/tracker');

// Auth middleware – check admin password
function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.adminPassword;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Audit token auth – check that request belongs to a valid audit
async function auditAuth(req, res, next) {
  const token = req.headers['x-audit-token'];
  if (!token) return res.status(401).json({ error: 'Missing audit token' });

  const { data, error } = await supabase
    .from('audits')
    .select('id, company_name, industry, status, start_date, end_date, report_url, ai_modules, ai_summary, setup_complete')
    .eq('access_token', token)
    .single();

  if (error || !data) return res.status(401).json({ error: 'Invalid audit token' });

  req.audit = data;
  next();
}

// POST /api/audits – Create new audit (admin only)
router.post('/', adminAuth, async (req, res) => {
  const { companyName, companyEmail, industry, websiteUrl } = req.body;

  if (!companyName || !companyEmail) {
    return res.status(400).json({ error: 'companyName and companyEmail required' });
  }

  const accessToken = Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days

  const { data, error } = await supabase.from('audits').insert({
    company_name: companyName,
    company_email: companyEmail,
    industry: industry || 'Okänd',
    website_url: websiteUrl || null,
    access_token: accessToken,
    status: 'active',
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString()
  }).select().single();

  if (error) {
    console.error('Error creating audit:', error);
    return res.status(500).json({ error: 'Failed to create audit' });
  }

  const apiBaseUrl = process.env.API_URL || `https://api.ai-granskning.se`;
  const snippet = generateTrackingSnippet(data.id, apiBaseUrl);
  const dashboardUrl = `${process.env.FRONTEND_URL || 'https://ai-granskning.se'}/dashboard/${accessToken}`;

  res.json({
    success: true,
    audit: {
      id: data.id,
      companyName: data.company_name,
      accessToken: data.access_token,
      startDate: data.start_date,
      endDate: data.end_date,
      dashboardUrl
    },
    trackingSnippet: snippet,
    instructions: 'Installera tracking-snippeten i <head> på kundens hemsida. Skicka dashboard-länken till kunden.'
  });
});

// GET /api/audits/me – Get current audit info
router.get('/me', auditAuth, async (req, res) => {
  const audit = req.audit;
  const now = new Date();
  const start = new Date(audit.start_date);
  const dayNumber = Math.min(7, Math.max(1, Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1));

  res.json({
    id: audit.id,
    companyName: audit.company_name,
    status: audit.status,
    startDate: audit.start_date,
    endDate: audit.end_date,
    dayNumber,
    daysLeft: Math.max(0, 7 - dayNumber + 1)
  });
});

// GET /api/audits/:id – Get audit by id (admin only)
router.get('/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('audits')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Audit not found' });
  res.json(data);
});

// GET /api/audits – List all audits (admin only)
router.get('/', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('audits')
    .select('id, company_name, industry, status, start_date, end_date, created_at, access_token, ai_modules, ai_integrations, ai_summary, setup_complete')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
module.exports.auditAuth = auditAuth;
