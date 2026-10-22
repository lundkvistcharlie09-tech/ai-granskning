const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { auditAuth } = require('./audits');
const { categorizeEmails } = require('../lib/openai');

// POST /api/email/import – Import emails from client's inbox (manual or webhook)
// Client pastes raw email data or we receive it via forwarding rule / Zapier
router.post('/import', auditAuth, async (req, res) => {
  const { emails } = req.body; // Array of { id, subject, snippet, from, date, threadId }

  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'emails array required' });
  }

  try {
    // AI-categorize emails in batch
    const categorized = await categorizeEmails(emails);
    const categoryMap = {};
    categorized.forEach(c => { categoryMap[c.id] = c; });

    // Store in DB
    const rows = emails.map(e => {
      const cat = categoryMap[e.id] || {};
      return {
        audit_id: req.audit.id,
        email_id: e.id,
        subject: e.subject ? e.subject.substr(0, 300) : null,
        snippet: e.snippet ? e.snippet.substr(0, 500) : null,
        from_address: e.from ? e.from.substr(0, 200) : null,
        thread_id: e.threadId || null,
        category: cat.category || 'övrigt',
        sentiment: cat.sentiment || 'neutral',
        estimated_time_minutes: cat.estimated_time_minutes || 8,
        requires_response: !['påminnelse'].includes(cat.category),
        responded: e.responded || false,
        response_time_minutes: e.responseTimeMinutes || null,
        email_date: e.date ? new Date(e.date).toISOString() : new Date().toISOString()
      };
    });

    const { error } = await supabase.from('email_events').upsert(rows, {
      onConflict: 'audit_id,email_id',
      ignoreDuplicates: false
    });

    if (error) {
      console.error('Email import error:', error);
      return res.status(500).json({ error: 'Failed to store emails' });
    }

    res.json({ success: true, imported: rows.length });

  } catch (err) {
    console.error('Email import error:', err);
    res.status(500).json({ error: 'Failed to import emails' });
  }
});

// GET /api/email/categories – Get email category stats
router.get('/categories', auditAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('email_events')
    .select('category, sentiment, estimated_time_minutes, responded, response_time_minutes')
    .eq('audit_id', req.audit.id);

  if (error) return res.status(500).json({ error: error.message });

  const all = data || [];
  const categories = {};
  all.forEach(e => {
    if (!categories[e.category]) categories[e.category] = { count: 0, totalTime: 0 };
    categories[e.category].count++;
    categories[e.category].totalTime += e.estimated_time_minutes || 8;
  });

  res.json({
    total: all.length,
    categories: Object.entries(categories).map(([name, stats]) => ({
      name,
      count: stats.count,
      totalMinutes: stats.totalTime
    })),
    avgResponseTime: (() => {
      const responded = all.filter(e => e.response_time_minutes);
      return responded.length > 0
        ? Math.round(responded.reduce((s, e) => s + e.response_time_minutes, 0) / responded.length)
        : null;
    })()
  });
});

// POST /api/email/setup-instructions – Returns instructions for setting up email forwarding
router.post('/setup-instructions', auditAuth, async (req, res) => {
  const webhookUrl = `${process.env.API_URL || 'https://api.ai-granskning.se'}/api/email/webhook/${req.audit.id}`;

  res.json({
    webhookUrl,
    gmailInstructions: `1. Öppna Gmail Inställningar → Vidarebefordran
2. Lägg till vidarebefordraningsadress: audit+${req.audit.id}@ai-granskning.se
3. Bekräfta vidarebefordran
4. Skapa filter: Vidarebefordra alla mejl till denna adress`,
    outlookInstructions: `1. Öppna Outlook Inställningar → Regler
2. Skapa ny regel: Vidarebefordra alla inkommande mejl till: ${webhookUrl}
3. Aktivera regeln`,
    zapierInstructions: `Använd Zapier: Gmail/Outlook → Webhook → POST ${webhookUrl}`
  });
});

module.exports = router;
