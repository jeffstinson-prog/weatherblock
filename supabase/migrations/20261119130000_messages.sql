-- Texts and email: every message we send or receive, and text opt-outs.

create table wb.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references wb.bookings (id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  direction text not null default 'out' check (direction in ('out', 'in')),
  audience text not null default 'customer' check (audience in ('customer', 'owner')),
  kind text not null check (length(kind) <= 40),
  to_addr text not null,
  from_addr text,
  subject text,
  body text not null,
  html text,
  provider text not null check (provider in ('twilio', 'resend', 'log')),
  provider_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'logged', 'received')),
  error text,
  attempts smallint not null default 0,
  -- One reminder per booking per window: a repeat send hits this and stops.
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index messages_booking on wb.messages (booking_id, created_at);
create index messages_queued on wb.messages (status) where status in ('queued', 'failed');

-- Numbers that replied STOP. We never text them again unless they reply START.
create table wb.sms_optouts (
  mobile text primary key check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  opted_out_at timestamptz not null default now()
);

alter table wb.messages enable row level security;
alter table wb.sms_optouts enable row level security;
create policy owners_only on wb.messages for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.sms_optouts for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
grant select, insert, update, delete on wb.messages, wb.sms_optouts to authenticated, service_role;

-- Clean-up the scheduled job runs: gate codes after a week, old rate counters.
-- (Photos never attached to a booking are removed by the job, storage first.)
create function wb.cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gate integer;
  rates integer;
begin
  gate := wb.purge_gate_codes();
  delete from wb.rate_events where at < now() - interval '1 day';
  get diagnostics rates = row_count;
  return jsonb_build_object('gate_codes', gate, 'rate_events', rates);
end $$;
revoke all on function wb.cleanup() from public;
grant execute on function wb.cleanup() to service_role;
