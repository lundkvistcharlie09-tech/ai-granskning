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
