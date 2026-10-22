const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { auditAuth } = require('./audits');
const { generateInsights, generateFinalReport } = require('../lib/openai');
const { estimateManualTime, calculateHealthScore } = require('../lib/tracker');

// POST /api/report/generate-insights – Regenerate AI insights mid-week
router.post('/generate-insights', auditAuth, async (req, res) => {
  const auditId = req.audit.id;

  try {
    const auditData = await collectAuditData(auditId);
    const insights = await generateInsights(auditData);

    if (!insights.length) {
      return res.status(500).json({ error: 'Failed to generate insights' });
    }

    // Store insights
    await supabase.from('audit_insights').delete().eq('audit_id', auditId);
    await supabase.from('audit_insights').insert(
      insights.map(i => ({
        audit_id: auditId,
        title: i.title,
        description: i.description,
        impact: i.impact || 'medium',
        category: i.category || 'tid'
      }))
    );

    res.json({ success: true, insights });

  } catch (err) {
    console.error('Insights error:', err);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// POST /api/report/generate – Generate final day-7 report
router.post('/generate', auditAuth, async (req, res) => {
  const now = new Date();
  const start = new Date(req.audit.start_date);
  const dayNumber = Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;

  // Allow force generation with admin override
  const forceGenerate = req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD;

  if (dayNumber < 7 && !forceGenerate) {
    return res.status(400).json({
      error: 'Report can only be generated on day 7 or later',
      dayNumber,
      daysLeft: 7 - dayNumber
    });
  }

  try {
    const auditData = await collectAuditData(req.audit.id);
    const { data: insights } = await supabase
      .from('audit_insights')
      .select('*')
      .eq('audit_id', req.audit.id);

    const report = await generateFinalReport(auditData, insights || []);

    if (!report) {
      return res.status(500).json({ error: 'Failed to generate report' });
    }

    // Save report to DB
    const { data: savedReport } = await supabase.from('audit_reports').insert({
      audit_id: req.audit.id,
      summary: report.summary,
      key_findings: report.keyFindings,
      problems: report.problems,
      recommendations: report.recommendations,
      next_steps: report.nextSteps,
      cta: report.cta,
      health_score: auditData.healthScore,
      total_visitors: auditData.totalVisitors,
      conversion_rate: auditData.conversionRate,
      no_show_rate: auditData.noShowRate,
      manual_hours_per_week: auditData.manualHoursPerWeek
    }).select().single();

    // Update audit status
    await supabase.from('audits').update({
      status: 'completed',
      report_id: savedReport.id
    }).eq('id', req.audit.id);

    res.json({ success: true, report });

  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/report – Get the final report
router.get('/', auditAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('audit_reports')
    .select('*')
    .eq('audit_id', req.audit.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'No report generated yet' });
  }

  res.json(data);
});

// Helper: collect all audit data for AI analysis
async function collectAuditData(auditId) {
  const { data: audit } = await supabase.from('audits').select('*').eq('id', auditId).single();

  const [{ data: pageviews }, { data: emails }, { data: bookings }] = await Promise.all([
    supabase.from('pageview_events').select('session_id, url, event_type').eq('audit_id', auditId),
    supabase.from('email_events').select('*').eq('audit_id', auditId),
    supabase.from('booking_events').select('*').eq('audit_id', auditId)
  ]);

  const allPageviews = pageviews || [];
  const allEmails = emails || [];
  const allBookings = bookings || [];

  const uniqueVisitors = new Set(allPageviews.filter(e => e.event_type === 'pageview').map(e => e.session_id)).size;
  const conversions = new Set(allPageviews.filter(e => e.url && (e.url.includes('bekraftelse') || e.url.includes('confirmation'))).map(e => e.session_id)).size;
  const conversionRate = uniqueVisitors > 0 ? Math.round((conversions / uniqueVisitors) * 1000) / 10 : 0;

  const noShows = allBookings.filter(b => b.status === 'no_show').length;
  const noShowRate = allBookings.length > 0 ? Math.round((noShows / allBookings.length) * 1000) / 10 : 0;

  const responded = allEmails.filter(e => e.response_time_minutes);
  const avgResponseTime = responded.length > 0
    ? Math.round(responded.reduce((s, e) => s + e.response_time_minutes, 0) / responded.length / 60 * 10) / 10
    : 0;

  const unansweredEmails = allEmails.filter(e => !e.responded && e.requires_response).length;
  const unansweredPct = allEmails.length > 0 ? Math.round((unansweredEmails / allEmails.length) * 100) : 0;

  const manualTime = estimateManualTime(
    { total: allEmails.length, avgResponseMinutes: responded.length > 0 ? responded.reduce((s, e) => s + e.response_time_minutes, 0) / responded.length : 8 },
    { total: allBookings.length, noShows }
  );

  const categoryMap = {};
  allEmails.forEach(e => { categoryMap[e.category || 'övrigt'] = (categoryMap[e.category || 'övrigt'] || 0) + 1; });
  const topEmailCategory = Object.entries(categoryMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'okänd';

  const healthScore = calculateHealthScore({
    noShowRate,
    avgEmailResponseHours: avgResponseTime,
    conversionRate,
    unansweredEmailPct: unansweredPct,
    manualHoursPerWeek: manualTime.total
  });

  // Most popular booking days
  const dayCount = {};
  allBookings.forEach(b => {
    if (b.booking_date) {
      const day = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'][new Date(b.booking_date).getDay()];
      dayCount[day] = (dayCount[day] || 0) + 1;
    }
  });
  const popularDays = Object.entries(dayCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(d => d[0]);

  return {
    companyName: audit?.company_name,
    industry: audit?.industry,
    totalVisitors: uniqueVisitors,
    conversionRate,
    noShowRate,
    totalEmails: allEmails.length,
    avgResponseTime,
    unansweredEmails,
    manualHoursPerWeek: manualTime.total,
    healthScore,
    popularDays,
    topEmailCategory
  };
}

module.exports = router;
