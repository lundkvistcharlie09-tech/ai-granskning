/**
 * Generates the tracking snippet to be installed on client's website.
 * Returns a small JS script that posts pageview/event data back to our API.
 */
function generateTrackingSnippet(auditId, apiBaseUrl) {
  return `<!-- AI-Granskning Tracking - ${auditId} -->
<script>
(function() {
  var AUDIT_ID = '${auditId}';
  var API_URL = '${apiBaseUrl}/track';
  var sessionId = Math.random().toString(36).substr(2, 9);
  var pageStart = Date.now();

  function send(type, data) {
    var payload = Object.assign({ auditId: AUDIT_ID, sessionId: sessionId, type: type, url: location.href, referrer: document.referrer, ts: Date.now() }, data);
    navigator.sendBeacon ? navigator.sendBeacon(API_URL + '/event', JSON.stringify(payload)) : fetch(API_URL + '/event', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, keepalive: true });
  }

  // Pageview
  send('pageview', { title: document.title });

  // Time on page when leaving
  window.addEventListener('beforeunload', function() {
    send('pageleave', { timeOnPage: Math.round((Date.now() - pageStart) / 1000) });
  });

  // Click tracking on links and buttons
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button, [data-track]');
    if (!el) return;
    send('click', { element: el.tagName, text: el.innerText.trim().substr(0, 50), href: el.href || null });
  });

  // Form submissions
  document.addEventListener('submit', function(e) {
    var form = e.target;
    send('form_submit', { formId: form.id || form.name || 'unknown' });
  });

  // Scroll depth
  var maxScroll = 0;
  window.addEventListener('scroll', function() {
    var depth = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
    if (depth > maxScroll) { maxScroll = depth; if (maxScroll % 25 === 0) send('scroll', { depth: maxScroll }); }
  });
})();
</script>
<!-- End AI-Granskning Tracking -->`;
}

/**
 * Calculate funnel conversion from pageview data
 */
function calculateFunnel(pageviews) {
  const steps = ['/', '/tjanster', '/boka', '/bekraftelse'];
  const stepLabels = ['Hemsida', 'Tjänster', 'Bokningsformulär', 'Bekräftelse'];

  const counts = steps.map(path => {
    return pageviews.filter(p => p.url && p.url.includes(path)).length;
  });

  const base = counts[0] || 1;
  return steps.map((step, i) => ({
    step: stepLabels[i],
    path: step,
    count: counts[i],
    percentage: Math.round((counts[i] / base) * 100),
    dropoff: i > 0 ? counts[i - 1] - counts[i] : 0
  }));
}

/**
 * Find the biggest dropoff step in the funnel
 */
function findDropoffStep(funnel) {
  let maxDropoff = 0;
  let dropoffStep = null;
  for (let i = 1; i < funnel.length; i++) {
    if (funnel[i].dropoff > maxDropoff) {
      maxDropoff = funnel[i].dropoff;
      dropoffStep = funnel[i].step;
    }
  }
  return dropoffStep;
}

/**
 * Calculate estimated manual time per week based on email/booking data
 */
function estimateManualTime(emailData, bookingData) {
  const timeItems = [];

  // Email handling
  const avgEmailTime = emailData.avgResponseMinutes || 8;
  const totalEmails = emailData.total || 0;
  const emailHours = Math.round((totalEmails * avgEmailTime) / 60 * 10) / 10;
  if (emailHours > 0) {
    timeItems.push({ label: 'Mejlhantering', hours: emailHours });
  }

  // Booking confirmations (manual)
  const manualBookings = bookingData.total || 0;
  const bookingHours = Math.round((manualBookings * 5) / 60 * 10) / 10; // 5 min per booking
  if (bookingHours > 0) {
    timeItems.push({ label: 'Bokningsbekräftelser', hours: bookingHours });
  }

  // No-show follow-up
  const noShows = bookingData.noShows || 0;
  const noShowHours = Math.round((noShows * 10) / 60 * 10) / 10; // 10 min per no-show
  if (noShowHours > 0) {
    timeItems.push({ label: 'No-show hantering', hours: noShowHours });
  }

  // Manual reminders (estimated)
  const reminderHours = Math.round((manualBookings * 0.5 * 3) / 60 * 10) / 10; // ~3 min per reminder, 50% get reminders
  if (reminderHours > 0) {
    timeItems.push({ label: 'Påminnelser', hours: reminderHours });
  }

  const total = timeItems.reduce((sum, item) => sum + item.hours, 0);
  return { items: timeItems, total: Math.round(total * 10) / 10 };
}

/**
 * Calculate AI health score (0-100)
 */
function calculateHealthScore(metrics) {
  let score = 100;

  // Deduct for high no-show rate
  if (metrics.noShowRate > 20) score -= 20;
  else if (metrics.noShowRate > 10) score -= 10;

  // Deduct for slow email response
  if (metrics.avgEmailResponseHours > 24) score -= 20;
  else if (metrics.avgEmailResponseHours > 8) score -= 10;

  // Deduct for low conversion
  if (metrics.conversionRate < 2) score -= 20;
  else if (metrics.conversionRate < 5) score -= 10;

  // Deduct for many unanswered emails
  if (metrics.unansweredEmailPct > 20) score -= 15;
  else if (metrics.unansweredEmailPct > 10) score -= 8;

  // Deduct for high manual time
  if (metrics.manualHoursPerWeek > 15) score -= 15;
  else if (metrics.manualHoursPerWeek > 8) score -= 8;

  return Math.max(0, Math.min(100, score));
}

module.exports = { generateTrackingSnippet, calculateFunnel, findDropoffStep, estimateManualTime, calculateHealthScore };
