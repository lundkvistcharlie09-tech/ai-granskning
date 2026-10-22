const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// POST /track/event – Receives tracking events from client's website
// This is called by the JS snippet installed on the client's site
router.post('/event', async (req, res) => {
  // Always respond fast so the website isn't slowed down
  res.status(204).send();

  try {
    const {
      auditId,
      sessionId,
      type,        // pageview | pageleave | click | form_submit | scroll
      url,
      referrer,
      title,
      timeOnPage,
      element,
      text,
      href,
      formId,
      depth,
      ts
    } = req.body;

    if (!auditId || !type) return;

    // Verify audit exists and is active
    const { data: audit } = await supabase
      .from('audits')
      .select('id, status')
      .eq('id', auditId)
      .eq('status', 'active')
      .single();

    if (!audit) return;

    // Store the event
    await supabase.from('pageview_events').insert({
      audit_id: auditId,
      session_id: sessionId,
      event_type: type,
      url: url ? url.substr(0, 500) : null,
      referrer: referrer ? referrer.substr(0, 500) : null,
      page_title: title ? title.substr(0, 200) : null,
      time_on_page: timeOnPage || null,
      click_element: element || null,
      click_text: text || null,
      click_href: href ? href.substr(0, 500) : null,
      form_id: formId || null,
      scroll_depth: depth || null,
      ip_hash: hashIp(req.ip),
      user_agent: (req.headers['user-agent'] || '').substr(0, 200),
      created_at: ts ? new Date(ts).toISOString() : new Date().toISOString()
    });

  } catch (err) {
    console.error('Tracking error:', err.message);
    // Never crash on tracking errors
  }
});

// GET /track/snippet/:auditId – Returns the tracking snippet (for setup)
router.get('/snippet/:auditId', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { generateTrackingSnippet } = require('../lib/tracker');
  const apiUrl = process.env.API_URL || 'https://api.ai-granskning.se';
  const snippet = generateTrackingSnippet(req.params.auditId, apiUrl);

  res.json({ snippet });
});

// Simple IP hashing for privacy
function hashIp(ip) {
  if (!ip) return null;
  let hash = 0;
  const str = ip + (process.env.IP_SALT || 'salt123');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

module.exports = router;
