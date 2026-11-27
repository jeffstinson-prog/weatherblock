-- The owner portal and the homeowner portal.
--
-- Owners: a profile per customer (who owns the relationship, tags, lost or
-- not), a running log of notes, tasks with an assignee and a due date, the
-- inspector for each visit, and a lead and phone for each crew.
--
-- Tasks also make themselves: a request to call back, an estimate to write
-- after a visit, a job to schedule after a yes, a question to answer, a job
-- to close out. Each one closes itself when the work is done.
--
-- Homeowners: photos the team chooses to share, and messages sent from the
-- customer's private link.
--
-- A customer is the mobile number they gave us: requests and bookings from
-- the same number are the same customer.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table wb.customer_profiles (
  mobile text primary key check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  assigned_to uuid references wb.owners (user_id) on delete set null,
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  lost boolean not null default false,
  lost_reason text check (length(lost_reason) <= 200),
  updated_at timestamptz not null default now()
);
create trigger customer_profiles_touch before update on wb.customer_profiles
  for each row execute function wb.touch_updated_at();

create table wb.customer_notes (
  id uuid primary key default gen_random_uuid(),
  mobile text not null check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  author uuid references wb.owners (user_id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index customer_notes_by_customer on wb.customer_notes (mobile, created_at);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table wb.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  notes text check (length(notes) <= 2000),
  due_on date,
  assignee uuid references wb.owners (user_id) on delete set null,
  mobile text check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  booking_id uuid references wb.bookings (id) on delete cascade,
  request_id uuid references wb.estimate_requests (id) on delete cascade,
  -- Tasks the system makes: one per event, so a repeat never doubles it.
  auto_key text unique check (length(auto_key) <= 120),
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid references wb.owners (user_id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references wb.owners (user_id) on delete set null,
  check (status = 'open' or done_at is not null)
);
create index tasks_open on wb.tasks (due_on) where status = 'open';
create index tasks_by_customer on wb.tasks (mobile);

-- ---------------------------------------------------------------------------
-- Assignment
-- ---------------------------------------------------------------------------

-- Who does the inspection.
alter table wb.bookings add column assigned_to uuid references wb.owners (user_id) on delete set null;

-- Who runs each crew, and a color to tell them apart on the schedule.
alter table wb.crews
  add column lead_name text check (length(lead_name) <= 80),
  add column lead_mobile text check (lead_mobile ~ '^\+1[2-9][0-9]{9}$'),
  add column color text not null default 'blue' check (color in ('blue', 'green', 'orange', 'purple', 'red', 'teal'));
update wb.crews set color = case sort when 2 then 'green' when 3 then 'orange' else 'blue' end;

-- ---------------------------------------------------------------------------
-- The homeowner portal
-- ---------------------------------------------------------------------------

-- Photos the team takes, and which ones the customer sees.
alter table wb.booking_photos
  add column source text not null default 'customer' check (source in ('customer', 'team')),
  add column shared boolean not null default false,
  add column caption text check (length(caption) <= 200),
  add column uploaded_by uuid references wb.owners (user_id) on delete set null;

-- Messages a customer sends from their private link.
alter table wb.messages drop constraint messages_channel_check;
alter table wb.messages add constraint messages_channel_check check (channel in ('sms', 'email', 'portal'));
alter table wb.messages drop constraint messages_provider_check;
alter table wb.messages add constraint messages_provider_check check (provider in ('twilio', 'resend', 'log', 'portal'));

-- ---------------------------------------------------------------------------
-- Tasks that make and close themselves
-- ---------------------------------------------------------------------------

create function wb.local_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/New_York')::date
$$;

create function wb.auto_task(p_key text, p_title text, p_due date, p_mobile text, p_booking uuid, p_request uuid, p_assignee uuid)
returns void language sql security definer set search_path = '' as $$
  insert into wb.tasks (auto_key, title, due_on, mobile, booking_id, request_id, assignee)
  values (
    p_key, left(p_title, 200), p_due, p_mobile, p_booking, p_request,
    coalesce(p_assignee, (select assigned_to from wb.customer_profiles where mobile = p_mobile))
  )
  on conflict (auto_key) do nothing
$$;

create function wb.close_task(p_key_prefix text) returns void
language sql security definer set search_path = '' as $$
  update wb.tasks set status = 'done', done_at = now()
  where status = 'open' and auto_key like p_key_prefix || '%'
$$;

-- A new estimate request: call them back today.
create function wb.tasks_on_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'new' then
    perform wb.auto_task('call:' || new.id, 'Call ' || new.name || ' back', wb.local_today(), new.mobile, null, new.id, null);
  elsif tg_op = 'UPDATE' and new.status <> 'new' and old.status = 'new' then
    perform wb.close_task('call:' || new.id);
  end if;
  return null;
end $$;
create trigger tasks_on_request after insert or update of status on wb.estimate_requests
  for each row execute function wb.tasks_on_request();

-- A visit marked done: write the estimate. A cancelled visit takes its tasks with it.
create function wb.tasks_on_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    perform wb.auto_task('estimate:' || new.id, 'Write the estimate for ' || new.name, wb.local_today() + 1, new.mobile, new.id, null, new.assigned_to);
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    update wb.tasks set status = 'done', done_at = now() where status = 'open' and booking_id = new.id and auto_key is not null;
  end if;
  return null;
end $$;
create trigger tasks_on_booking after update of status on wb.bookings
  for each row execute function wb.tasks_on_booking();

-- The estimate goes out: that task is done. A question from the customer: answer it.
create function wb.tasks_on_estimate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
begin
  select * into b from wb.bookings where id = new.booking_id;
  if new.status <> 'draft' then
    perform wb.close_task('estimate:' || new.booking_id);
  end if;
  if new.replied_at is not null and new.replied_at is distinct from old.replied_at and coalesce(new.customer_note, '') <> '' then
    perform wb.auto_task(
      'question:' || new.booking_id || ':' || floor(extract(epoch from new.replied_at))::bigint,
      'Answer ' || b.name || '''s question about the estimate', wb.local_today(), b.mobile, b.id, null, b.assigned_to);
  end if;
  return null;
end $$;
create trigger tasks_on_estimate after update on wb.estimates
  for each row execute function wb.tasks_on_estimate();

-- A yes makes a job: schedule it. Scheduled: done. Finished: close it out.
create function wb.tasks_on_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
begin
  select * into b from wb.bookings where id = new.booking_id;
  if tg_op = 'INSERT' and new.status = 'to_schedule' then
    perform wb.auto_task('schedule:' || new.booking_id, 'Schedule ' || b.name || '''s roof job', wb.local_today(), b.mobile, b.id, null, null);
  elsif tg_op = 'UPDATE' then
    if new.status <> 'to_schedule' then
      perform wb.close_task('schedule:' || new.booking_id);
    end if;
    if new.status = 'done' and old.status <> 'done' then
      perform wb.auto_task('closeout:' || new.booking_id, 'Close out ' || b.name || '''s job: final walk-through, photos and payment', wb.local_today() + 1, b.mobile, b.id, null, null);
    end if;
  end if;
  return null;
end $$;
create trigger tasks_on_job after insert or update of status on wb.jobs
  for each row execute function wb.tasks_on_job();

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table wb.customer_profiles enable row level security;
alter table wb.customer_notes enable row level security;
alter table wb.tasks enable row level security;
create policy owners_only on wb.customer_profiles for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.customer_notes for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.tasks for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
grant select, insert, update, delete on wb.customer_profiles, wb.customer_notes, wb.tasks to authenticated, service_role;

revoke all on function wb.auto_task(text, text, date, text, uuid, uuid, uuid) from public;
revoke all on function wb.close_task(text) from public;
grant execute on function wb.local_today() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Day one: tasks for what's already waiting
-- ---------------------------------------------------------------------------

select wb.auto_task('call:' || r.id, 'Call ' || r.name || ' back', wb.local_today(), r.mobile, null, r.id, null)
from wb.estimate_requests r where r.status = 'new';

select wb.auto_task('estimate:' || b.id, 'Write the estimate for ' || b.name, wb.local_today(), b.mobile, b.id, null, null)
from wb.bookings b left join wb.estimates e on e.booking_id = b.id
where b.status = 'done' and (e.id is null or e.status = 'draft');

select wb.auto_task('schedule:' || j.booking_id, 'Schedule ' || b.name || '''s roof job', wb.local_today(), b.mobile, b.id, null, null)
from wb.jobs j join wb.bookings b on b.id = j.booking_id where j.status = 'to_schedule';
