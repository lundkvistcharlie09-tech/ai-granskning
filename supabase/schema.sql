-- AI-Granskning Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- AUDITS - one row per client audit week
-- ============================================
create table audits (
  id uuid default uuid_generate_v4() primary key,
  company_name text not null,
  company_email text not null,
  industry text default 'Okänd',
  website_url text,
  access_token text unique not null, -- used to authenticate dashboard access
  status text default 'active' check (status in ('active', 'completed', 'cancelled')),
  start_date timestamptz not null default now(),
  end_date timestamptz not null,
  report_id uuid,
  created_at timestamptz default now()
);

-- ============================================
-- PAGEVIEW_EVENTS - tracking events from client's website
-- ============================================
create table pageview_events (
  id uuid default uuid_generate_v4() primary key,
  audit_id uuid references audits(id) on delete cascade not null,
  session_id text not null,              -- random ID per browser session
  event_type text not null,              -- pageview | pageleave | click | form_submit | scroll
  url text,
  referrer text,
  page_title text,
  time_on_page integer,                  -- seconds spent on page (on pageleave)
  click_element text,                    -- button | a
  click_text text,                       -- text of clicked element
  click_href text,                       -- href if link
  form_id text,                          -- form identifier on submit
  scroll_depth integer,                  -- 0-100 percent
  ip_hash text,                          -- hashed for privacy
  user_agent text,
  created_at timestamptz default now()
);

-- Index for fast dashboard queries
create index pageview_events_audit_id on pageview_events(audit_id);
create index pageview_events_session on pageview_events(audit_id, session_id);
create index pageview_events_type on pageview_events(audit_id, event_type);

-- ============================================
-- EMAIL_EVENTS - emails from client's inbox
-- ============================================
create table email_events (
  id uuid default uuid_generate_v4() primary key,
  audit_id uuid references audits(id) on delete cascade not null,
  email_id text not null,                -- original email ID (Gmail/Outlook)
  subject text,
  snippet text,
  from_address text,
  thread_id text,
  category text default 'övrigt',        -- bokning | fråga | klagomål | påminnelse | övrigt
  sentiment text default 'neutral',      -- positive | neutral | negative
  estimated_time_minutes integer default 8,  -- AI-estimated time to handle
  requires_response boolean default true,
  responded boolean default false,
  response_time_minutes integer,         -- null if not responded
  email_date timestamptz not null default now(),
  created_at timestamptz default now(),
  unique(audit_id, email_id)
);

create index email_events_audit_id on email_events(audit_id);
create index email_events_category on email_events(audit_id, category);

-- ============================================
-- BOOKING_EVENTS - booking data (manually imported or via API)
-- ============================================
create table booking_events (
  id uuid default uuid_generate_v4() primary key,
  audit_id uuid references audits(id) on delete cascade not null,
  booking_date date,
  booking_time time,
  status text default 'completed' check (status in ('completed', 'no_show', 'cancelled', 'pending')),
  service text,
  duration_minutes integer,
  created_at timestamptz default now()
);

create index booking_events_audit_id on booking_events(audit_id);
create index booking_events_date on booking_events(audit_id, booking_date);

-- ============================================
-- AUDIT_INSIGHTS - AI-generated insights
-- ============================================
create table audit_insights (
  id uuid default uuid_generate_v4() primary key,
  audit_id uuid references audits(id) on delete cascade not null,
  title text not null,
  description text not null,
  impact text default 'medium' check (impact in ('high', 'medium', 'low')),
  category text default 'tid',           -- tid | pengar | kunder
  created_at timestamptz default now()
);

create index audit_insights_audit_id on audit_insights(audit_id);

-- ============================================
-- AUDIT_REPORTS - final day-7 reports
-- ============================================
create table audit_reports (
  id uuid default uuid_generate_v4() primary key,
  audit_id uuid references audits(id) on delete cascade not null,
  summary text,
  key_findings text[],
  problems text[],
  recommendations text[],
  next_steps text,
  cta text,
  health_score integer,
  total_visitors integer,
  conversion_rate numeric(5,2),
  no_show_rate numeric(5,2),
  manual_hours_per_week numeric(5,1),
  created_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS
alter table audits enable row level security;
alter table pageview_events enable row level security;
alter table email_events enable row level security;
alter table booking_events enable row level security;
alter table audit_insights enable row level security;
alter table audit_reports enable row level security;

-- Service role bypasses RLS (used by our backend with SERVICE_ROLE_KEY)
-- No public access – all data goes through our API

-- ============================================
-- CLEANUP FUNCTION - runs on Supabase cron to auto-complete old audits
-- ============================================
create or replace function auto_complete_old_audits()
returns void as $$
begin
  update audits
  set status = 'completed'
  where status = 'active'
    and end_date < now() - interval '1 day';
end;
$$ language plpgsql;
