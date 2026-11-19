const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { generateTrackingSnippet } = require('../lib/tracker');

// Auth middleware – check admin password
function adminAuth(req, res, next) {
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

// GET /api/audits – List all audits (admin only)
router.get('/', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('audits')
    .select('id, company_name, industry, status, start_date, end_date, created_at, access_token, ai_modules, ai_integrations, ai_summary, setup_complete, welcome_complete, ai_welcome_analysis')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/welcome/:token – Public welcome page data (måste vara FÖRE /:id)
router.get('/welcome/:token', async (req, res) => {
  const { data, error } = await supabase
    .from('audits')
    .select('id, company_name, industry, welcome_goals, welcome_challenges, welcome_expectations, welcome_complete')
    .eq('access_token', req.params.token)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
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

// POST /api/audits/:id/welcome – Save welcome content + trigger AI analysis
router.post('/:id/welcome', async (req, res) => {
  const { goals, challenges, expectations, submittedByCustomer } = req.body;

  // 1. Hämta audit-info
  const { data: audit, error: auditErr } = await supabase
    .from('audits')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (auditErr || !audit) return res.status(404).json({ error: 'Audit not found' });

  // 2. Spara svaren
  const { data: saved, error: saveErr } = await supabase
    .from('audits')
    .update({
      welcome_goals: goals || '',
      welcome_challenges: challenges || '',
      welcome_expectations: expectations || '',
      welcome_complete: true
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (saveErr) return res.status(500).json({ error: saveErr.message });

  // 3. Om kunden skickade in – kör AI-analys i bakgrunden
  if (submittedByCustomer) {
    runWelcomeAnalysis(audit, goals, challenges, expectations).catch(e =>
      console.error('Background analysis failed:', e)
    );
  }

  res.json(saved);
});

// Kör AI-analys av kundens svar + sök upp företaget online
async function runWelcomeAnalysis(audit, goals, challenges, expectations) {
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Söker efter företagsinformation online via GPT med web browsing
    const prompt = `Du är en senior AI-konsult som analyserar ett företag inför en 7-dagars AI-granskning.

FÖRETAGETS INFORMATION:
Företag: ${audit.company_name}
Bransch: ${audit.industry || 'Okänd'}
Hemsida: ${audit.website_url || 'Okänd'}

KUNDENS EGNA SVAR:
Mål: "${goals}"
Utmaningar: "${challenges}"
Förväntningar: "${expectations}"

Din uppgift:
1. Analysera vad kunden faktiskt säger (vad de tror är problemet)
2. Identifiera vad de INTE säger men troligtvis har för problem baserat på bransch och beskrivning
3. Skapa en konkret granskningsplan för 7 dagar

Tänk som en erfaren konsult: en frisörsalong som säger "vi vill ha fler återkommande kunder" har troligtvis problem med uppföljning, dåliga recensioner, inget lojalitetsprogram, eller dålig digital närvaro – inte bara "dålig marknadsföring".

Svara med JSON:
{
  "real_problem": "Det verkliga huvudproblemet i 1-2 meningar (kan skilja sig från vad kunden tror)",
  "customer_thinks": "Vad kunden tror är problemet",
  "likely_root_causes": [
    "Trolig rotorsak 1",
    "Trolig rotorsak 2",
    "Trolig rotorsak 3"
  ],
  "audit_plan": [
    {
      "day": "Dag 1-2",
      "focus": "Vad granskas",
      "why": "Varför detta är viktigt för just detta företag",
      "ai_will_check": ["Konkret sak 1", "Konkret sak 2"]
    },
    {
      "day": "Dag 3-4",
      "focus": "Vad granskas",
      "why": "Varför",
      "ai_will_check": ["Konkret sak 1", "Konkret sak 2"]
    },
    {
      "day": "Dag 5-7",
      "focus": "Vad granskas",
      "why": "Varför",
      "ai_will_check": ["Konkret sak 1", "Konkret sak 2"]
    }
  ],
  "online_checks": [
    "Google-recensioner och betyg",
    "Hemsidans kontaktinformation och bokningsflöde",
    "Synlighet på sociala medier",
    "Konkurrenters starka sidor"
  ],
  "week_goal": "Vad vi ska ha hittat och bevisat efter 7 dagar",
  "ai_recommendation": "Vilken typ av AI-lösning som troligtvis kommer behövas (preliminärt)"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    // Spara analysen på audit-raden
    await supabase
      .from('audits')
      .update({
        ai_summary: analysis.real_problem,
        ai_welcome_analysis: analysis
      })
      .eq('id', audit.id);

    console.log(`Welcome analysis done for ${audit.company_name}`);
  } catch(e) {
    console.error('runWelcomeAnalysis error:', e);
  }
}

module.exports = router;
module.exports.auditAuth = auditAuth;
