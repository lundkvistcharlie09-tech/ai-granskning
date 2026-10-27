const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { auditAuth } = require('./audits');
const { calculateFunnel, findDropoffStep, estimateManualTime, calculateHealthScore } = require('../lib/tracker');

// GET /api/dashboard – Returns all data for the live dashboard
// Requires x-audit-token header
router.get('/', auditAuth, async (req, res) => {
  const auditId = req.audit.id;

  try {
    const [pageviews, emails, bookings] = await Promise.all([
      getPageviewData(auditId),
      getEmailData(auditId),
      getBookingData(auditId)
    ]);

    const funnel = calculateFunnel(pageviews.events);
    const manualTime = estimateManualTime(emails, bookings);

    const metrics = {
      noShowRate: bookings.noShowRate,
      avgEmailResponseHours: emails.avgResponseHours,
      conversionRate: pageviews.conversionRate,
      unansweredEmailPct: emails.unansweredPct,
      manualHoursPerWeek: manualTime.total
    };

    const healthScore = calculateHealthScore(metrics);

    // Day number
    const now = new Date();
    const start = new Date(req.audit.start_date);
    const dayNumber = Math.min(7, Math.max(1, Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1));

    res.json({
      audit: {
        id: req.audit.id,
        companyName: req.audit.company_name,
        industry: req.audit.industry || '',
        dayNumber,
        daysLeft: Math.max(0, 7 - dayNumber + 1),
        startDate: req.audit.start_date,
        endDate: req.audit.end_date,
        aiModules: req.audit.ai_modules || [],
        aiSummary: req.audit.ai_summary || '',
        setupComplete: req.audit.setup_complete || false
      },
      kpis: {
        visitors: pageviews.uniqueVisitors,
        conversionRate: pageviews.conversionRate,
        noShowRate: bookings.noShowRate,
        unansweredEmails: emails.unansweredCount
      },
      funnel,
      dropoffStep: findDropoffStep(funnel),
      bookingsPerDay: bookings.perDay,
      emailCategories: emails.categories,
      manualTime,
      healthScore,
      insights: await getInsights(auditId),
      reportReady: dayNumber >= 7 && req.audit.report_url != null
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

async function getPageviewData(auditId) {
  const { data: events } = await supabase
    .from('pageview_events')
    .select('session_id, url, event_type, created_at')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: true });

  const allEvents = events || [];
  const pageviews = allEvents.filter(e => e.event_type === 'pageview');
  const uniqueSessions = new Set(pageviews.map(e => e.session_id)).size;

  // Count sessions that reached a booking confirmation
  const convertedSessions = new Set(
    allEvents
      .filter(e => e.url && (e.url.includes('bekraftelse') || e.url.includes('confirmation') || e.url.includes('tack')))
      .map(e => e.session_id)
  ).size;

  const conversionRate = uniqueSessions > 0
    ? Math.round((convertedSessions / uniqueSessions) * 1000) / 10
    : 0;

  return {
    events: allEvents,
    uniqueVisitors: uniqueSessions,
    totalPageviews: pageviews.length,
    conversionRate
  };
}

async function getEmailData(auditId) {
  const { data: emails } = await supabase
    .from('email_events')
    .select('*')
    .eq('audit_id', auditId);

  const allEmails = emails || [];
  const total = allEmails.length;
  const unansweredCount = allEmails.filter(e => !e.responded && e.requires_response).length;
  const unansweredPct = total > 0 ? Math.round((unansweredCount / total) * 100) : 0;

  // Average response time for responded emails
  const responded = allEmails.filter(e => e.responded && e.response_time_minutes);
  const avgResponseMinutes = responded.length > 0
    ? responded.reduce((sum, e) => sum + e.response_time_minutes, 0) / responded.length
    : 0;

  // Category breakdown
  const categoryMap = {};
  allEmails.forEach(e => {
    const cat = e.category || 'övrigt';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  });
  const categories = Object.entries(categoryMap).map(([name, count]) => ({ name, count }));

  return {
    total,
    unansweredCount,
    unansweredPct,
    avgResponseHours: Math.round(avgResponseMinutes / 60 * 10) / 10,
    avgResponseMinutes,
    categories,
    topCategory: categories.sort((a, b) => b.count - a.count)[0]?.name || 'okänd'
  };
}

async function getBookingData(auditId) {
  const { data: bookings } = await supabase
    .from('booking_events')
    .select('*')
    .eq('audit_id', auditId);

  const allBookings = bookings || [];
  const total = allBookings.length;
  const noShows = allBookings.filter(b => b.status === 'no_show').length;
  const noShowRate = total > 0 ? Math.round((noShows / total) * 1000) / 10 : 0;

  // Bookings per day (last 7 days)
  const now = new Date();
  const perDay = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dayStr = day.toISOString().split('T')[0];
    const count = allBookings.filter(b => b.booking_date && b.booking_date.startsWith(dayStr)).length;
    perDay.push({
      date: dayStr,
      day: ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'][day.getDay()],
      count,
      isFuture: day > now
    });
  }

  return {
    total,
    noShows,
    noShowRate,
    perDay
  };
}

async function getInsights(auditId) {
  const { data } = await supabase
    .from('audit_insights')
    .select('*')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: false })
    .limit(4);

  return data || [];
}

module.exports = router;
