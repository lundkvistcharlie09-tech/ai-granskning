const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Categorize a batch of emails using GPT-4o-mini (cheap + fast)
 * Returns array of { id, category, sentiment, estimated_time_minutes }
 */
async function categorizeEmails(emails) {
  const prompt = `Du är ett AI-system som analyserar mejl för ett företag.
Kategorisera varje mejl och uppskatta hur lång tid det tar att svara (i minuter).

Kategorier:
- bokning (ny bokning, ändring, avbokning)
- fråga (allmän fråga om tjänster/priser)
- klagomål (missnöjd kund)
- påminnelse (uppföljning, ingen respons)
- övrigt

Svara med JSON array: [{"id": "...", "category": "...", "sentiment": "positive/neutral/negative", "estimated_time_minutes": N}]

Mejl att analysera:
${JSON.stringify(emails.map(e => ({ id: e.id, subject: e.subject, snippet: e.snippet })))}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3
  });

  try {
    const result = JSON.parse(response.choices[0].message.content);
    return result.emails || result;
  } catch (e) {
    console.error('Failed to parse email categorization:', e);
    return [];
  }
}

/**
 * Generate AI insights from aggregated audit data
 */
async function generateInsights(auditData) {
  const prompt = `Du är en AI-konsult som analyserar affärsdata för ett företag.
Baserat på följande data, ge 4 konkreta insikter och rekommendationer på svenska.
Fokusera på vad som kostar tid och pengar, och vad som kan automatiseras.

Data:
- Besökare denna vecka: ${auditData.visitors}
- Konverteringsgrad: ${auditData.conversionRate}%
- No-show rate: ${auditData.noShowRate}%
- Mejl utan svar >24h: ${auditData.unansweredEmails}
- Manuell tid per vecka (uppskattad): ${auditData.manualHoursPerWeek} timmar
- Populäraste bokningsdagar: ${auditData.popularDays?.join(', ')}
- Vanligaste mejlkategori: ${auditData.topEmailCategory}
- Hemsidans dropoff-steg: ${auditData.dropoffStep}

Svara med JSON: {"insights": [{"title": "...", "description": "...", "impact": "high/medium/low", "category": "tid/pengar/kunder"}]}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7
  });

  try {
    const result = JSON.parse(response.choices[0].message.content);
    return result.insights || [];
  } catch (e) {
    console.error('Failed to parse insights:', e);
    return [];
  }
}

/**
 * Generate full 7-day audit report
 */
async function generateFinalReport(auditData, insights) {
  const prompt = `Du är en AI-konsult som skriver slutrapporten för en 7-dagars AI-granskning av ett företag.
Skriv en professionell, koncis rapport på svenska.

Företag: ${auditData.companyName}
Bransch: ${auditData.industry}

Nyckeltal:
- Totala besökare: ${auditData.totalVisitors}
- Konverteringsgrad: ${auditData.conversionRate}%
- No-show rate: ${auditData.noShowRate}%
- Totala mejl hanterade: ${auditData.totalEmails}
- Genomsnittlig svarstid: ${auditData.avgResponseTime} timmar
- Uppskattad manuell tid/vecka: ${auditData.manualHoursPerWeek} timmar
- AI-hälsopoäng: ${auditData.healthScore}/100

Insikter:
${insights.map(i => `- ${i.title}: ${i.description}`).join('\n')}

Skriv rapporten med sektioner: Sammanfattning, Nyckeltal, Problem identifierade, Rekommendationer, Nästa steg.
Avsluta med en säljande call-to-action om att implementera AI-automatisering.

Svara med JSON: {"report": {"summary": "...", "keyFindings": ["..."], "problems": ["..."], "recommendations": ["..."], "nextSteps": "...", "cta": "..."}}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.6,
    max_tokens: 2000
  });

  try {
    const result = JSON.parse(response.choices[0].message.content);
    return result.report || result;
  } catch (e) {
    console.error('Failed to parse report:', e);
    return null;
  }
}

module.exports = { categorizeEmails, generateInsights, generateFinalReport };
