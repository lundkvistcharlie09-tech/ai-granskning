# AI-Granskning Backend

7-day AI audit platform. Installs tracking on a client's website + email for one week, generates a live dashboard + final report.

## Setup

```bash
npm install
cp .env.example .env
# Fill in .env
npm run dev
```

## Supabase

Run `supabase/schema.sql` in your Supabase SQL editor to create all tables.

## API Endpoints

### Admin (requires `x-admin-password` header)
- `POST /api/audits` – Create new audit, get tracking snippet
- `GET /api/audits` – List all audits
- `GET /api/admin/stats` – Overview stats
- `POST /api/admin/booking-import/:auditId` – Import booking data

### Client Dashboard (requires `x-audit-token` header)
- `GET /api/audits/me` – Get audit info
- `GET /api/dashboard` – All dashboard data
- `GET /api/email/categories` – Email breakdown
- `POST /api/report/generate-insights` – Refresh AI insights
- `POST /api/report/generate` – Generate final report (day 7+)
- `GET /api/report` – Get final report

### Tracking (no auth – called by snippet on client's site)
- `POST /track/event` – Receive tracking events

## Flow

1. **Create audit** → `POST /api/audits` → get `accessToken` + `trackingSnippet`
2. **Install snippet** on client's website `<head>`
3. **Import emails** weekly via `POST /api/email/import`
4. **Import bookings** via `POST /api/admin/booking-import/:id`
5. **Live dashboard** at `/dashboard/:accessToken` (frontend)
6. **Day 7** → `POST /api/report/generate` → send report to client

## Deploy to Vercel

```bash
vercel --prod
```
