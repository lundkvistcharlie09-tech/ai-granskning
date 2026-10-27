const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
// openai client created inline

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.adminPassword;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/notes/:auditId – Hämta noter för en audit
router.get('/:auditId', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('audit_notes')
    .select('*')
    .eq('audit_id', req.params.auditId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/notes/:auditId – Spara en ny notering + generera AI-analys
router.post('/:auditId', adminAuth, async (req, res) => {
  const { note_text } = req.body;
  if (!note_text?.trim()) return res.status(400).json({ error: 'note_text krävs' });

  // Hämta audit-info för kontext
  const { data: audit, error: auditErr } = await supabase
    .from('audits')
    .select('company_name, industry')
    .eq('id', req.params.auditId)
    .single();

  if (auditErr || !audit) return res.status(404).json({ error: 'Audit hittades inte' });

  // Hämta befintliga noter för kontext
  const { data: existingNotes } = await supabase
    .from('audit_notes')
    .select('note_text, ai_analysis')
    .eq('audit_id', req.params.auditId)
    .order('created_at', { ascending: false })
    .limit(5);

  // Generera AI-analys
  let ai_analysis = null;
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const contextNotes = (existingNotes || []).map(n => `- ${n.note_text}`).join('\n');

    const prompt = `Du är en AI-konsult som hjälper till att förbereda en säljpitch för AI-automatisering.

Företag: ${audit.company_name}
Bransch: ${audit.industry}

${contextNotes ? `Tidigare noter från samtal:\n${contextNotes}\n\n` : ''}Ny observation från säljsamtal: "${note_text}"

Baserat på denna observation, identifiera:
1. Exakt vilket problem/tidsstjäl detta representerar
2. 3-5 relaterade problem i samma bransch som troligtvis också existerar (som företaget kanske inte nämnt men sannolikt har)
3. Konkret AI-lösning för varje problem
4. Uppskattad tidsbesparing per vecka (i timmar) om möjligt

Fokusera på praktiska, konkreta automationsmöjligheter. Tänk som en konsult som känner branschen väl.

Svara med JSON:
{
  "core_problem": "Kärnproblemet i en mening",
  "related_problems": [
    {
      "problem": "Problemet",
      "likelihood": "hög/medel/låg",
      "ai_solution": "Konkret AI-lösning",
      "time_saved_hours_weekly": N
    }
  ],
  "pitch_angle": "Kortfattad säljvinkel baserad på detta (1-2 meningar)"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    ai_analysis = JSON.parse(response.choices[0].message.content);
  } catch (e) {
    console.error('AI analysis failed:', e);
  }

  // Spara i databasen
  const { data: saved, error: saveErr } = await supabase
    .from('audit_notes')
    .insert({
      audit_id: req.params.auditId,
      note_text: note_text.trim(),
      ai_analysis,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (saveErr) {
    console.error('Save note error:', saveErr);
    return res.status(500).json({ error: saveErr.message });
  }

  res.json(saved);
});

// POST /api/notes/:auditId/setup – AI-analys av mötes-anteckningar → moduler + integrationsguide
router.post('/:auditId/setup', adminAuth, async (req, res) => {
  const { notes } = req.body;
  if (!notes?.trim()) return res.status(400).json({ error: 'notes krävs' });

  const { data: audit, error: auditErr } = await supabase
    .from('audits')
    .select('company_name, industry')
    .eq('id', req.params.auditId)
    .single();

  if (auditErr || !audit) return res.status(404).json({ error: 'Audit hittades inte' });

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `Du är en senior AI-konsult som ska analysera ett kundsamtal och bygga upp en skräddarsydd dashboard-profil.

Företag: ${audit.company_name}
Bransch: ${audit.industry || 'Okänd'}

Anteckningar från kundsamtalet:
"""
${notes}
"""

Baserat på dessa anteckningar, bestäm:
1. Vilka dashboard-moduler som är relevanta för detta företag
2. Vilka integrationer som behövs och exakt hur Charlie ska koppla dem
3. En kort sammanfattning av kundens situation

TILLGÄNGLIGA MODULER (välj de som är relevanta):
- email: Mejlanalys (antal, kategorier, volym per dag)
- bookings: Bokningsstatistik (bokningar/dag, populära tider, no-shows)
- funnel: Konverteringsfunnel (webbbesök → bokning → genomfört)
- manual_time: Manuella tidsstjälar (vad tar mest tid manuellt)
- noshow: No-show tracker (utebliven närvaro, kostnad)
- invoicing: Faktureringsanalys (fakturor per månad, betalningstid)
- social: Sociala medier (räckvidd, engagemang)
- inventory: Lagerhantering (lagerstatus, svinn, påfyllning)
- visitors: Webbplatsbesökare (sidor, trafikkällor, konvertering)

TILLGÄNGLIGA INTEGRATIONER:
- Gmail / Outlook (mejl)
- Bokadirekt (bokningssystem)
- Fresha (bokningssystem för skönhet)
- Calendly (mötesbokning)
- Google Calendar
- WooCommerce / Shopify (e-handel)
- Fortnox / Visma (fakturering)
- Google Analytics
- Instagram API / Meta Business
- Slack (kommunikation)

Svara med JSON:
{
  "summary": "1-2 meningar som beskriver kundens situation och huvudproblem",
  "modules": ["module_id1", "module_id2"],
  "integrations": [
    {
      "name": "Integrationsnamn",
      "icon": "emoji",
      "priority": "hög/medel/låg",
      "why": "Varför detta behövs för just detta företag (1-2 meningar)",
      "steps": [
        "Steg 1: Konkret instruktion",
        "Steg 2: Konkret instruktion",
        "Steg 3: Konkret instruktion"
      ],
      "note": "Eventuell viktig notering (t.ex. kräver API-nyckel från leverantören)"
    }
  ]
}

Välj BARA de moduler och integrationer som verkligen är relevanta baserat på vad kunden berättade. En frisörsalong behöver bokningar + mejl + no-shows men inte lager. En e-handelsbutik behöver lager + besökare + konvertering men kanske inte bokningar.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Spara på audit-raden
    const { data: updated, error: updateErr } = await supabase
      .from('audits')
      .update({
        ai_modules: result.modules || [],
        ai_integrations: result.integrations || [],
        ai_summary: result.summary || '',
        setup_notes: notes,
        setup_complete: true
      })
      .eq('id', req.params.auditId)
      .select()
      .single();

    if (updateErr) {
      console.error('Update audit error:', updateErr);
      return res.status(500).json({ error: updateErr.message });
    }

    res.json(updated);
  } catch (e) {
    console.error('Setup analysis failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/notes/:auditId/:noteId – Ta bort en notering
router.delete('/:auditId/:noteId', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('audit_notes')
    .delete()
    .eq('id', req.params.noteId)
    .eq('audit_id', req.params.auditId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
