-- After the inspection: the estimate, the customer's answer, and the roof job.
--   Estimate: an owner writes it in the app. The customer sees it on their
--   private link and answers there: go ahead, ask a question, or no thanks.
--   Follow-ups stop the moment they answer, ask, or text us.
--   Job: once they say yes, an owner puts it on a crew's day. Weather can move
--   a whole day at once, and every customer that day hears about it.

create table wb.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  jobs_per_day smallint not null default 1 check (jobs_per_day between 1 and 5),
  active boolean not null default true,
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);

-- A starting point the owners rename in the app.
insert into wb.crews (name, sort) values ('Crew 1', 1), ('Crew 2', 2), ('Crew 3', 3);

create table wb.estimates (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references wb.bookings (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'withdrawn')),
  amount_cents integer check (amount_cents between 100 and 1000000000),
  summary text check (length(summary) <= 4000),
  file_path text check (file_path ~ '^estimates/[0-9a-f-]{36}\.pdf$'),
  file_name text check (length(file_name) <= 200),
  sent_at timestamptz,
  send_count smallint not null default 0,
  viewed_at timestamptz,
  decided_at timestamptz,
  customer_note text check (length(customer_note) <= 1000),
  -- A question from the link, or a text from the customer's number.
  replied_at timestamptz,
  followups_sent smallint not null default 0 check (followups_sent between 0 and 10),
  last_followup_at timestamptz,
  followups_stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or sent_at is not null),
  check (status = 'draft' or amount_cents is not null or file_path is not null),
  check (status not in ('accepted', 'declined') or decided_at is not null)
);
create index estimates_open on wb.estimates (sent_at) where status = 'sent';

create table wb.jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references wb.bookings (id) on delete cascade,
  status text not null default 'to_schedule' check (status in ('to_schedule', 'scheduled', 'done', 'cancelled')),
  crew_id uuid references wb.crews (id) on delete set null,
  day date,
  notes text check (length(notes) <= 2000),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'scheduled' or (crew_id is not null and day is not null)),
  check (status <> 'done' or done_at is not null)
);
create index jobs_by_day on wb.jobs (day) where status = 'scheduled';

create trigger estimates_touch before update on wb.estimates
  for each row execute function wb.touch_updated_at();
create trigger jobs_touch before update on wb.jobs
  for each row execute function wb.touch_updated_at();

-- What the customer may see: the visit, then the estimate once sent, then the job.
create or replace function wb.booking_summary(b wb.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'ref', b.ref,
    'status', b.status,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'address', b.address,
    'first_name', split_part(trim(b.name), ' ', 1),
    'sms_consent', b.sms_consent,
    'can_change', b.status = 'booked' and s.starts_at > now(),
    'estimate', (
      select jsonb_build_object(
        'status', e.status,
        'amount_cents', e.amount_cents,
        'summary', e.summary,
        'has_file', e.file_path is not null,
        'sent_at', e.sent_at,
        'decided_at', e.decided_at,
        'asked_at', e.replied_at
      )
      from wb.estimates e
      where e.booking_id = b.id and e.status in ('sent', 'accepted', 'declined')
    ),
    'job', (
      select jsonb_build_object('status', j.status, 'day', j.day, 'done_at', j.done_at)
      from wb.jobs j
      where j.booking_id = b.id and j.status in ('to_schedule', 'scheduled', 'done')
    )
  )
  from wb.slots s where s.id = b.slot_id
$$;

-- The private link works for 60 days after the last thing that happened:
-- the visit, the estimate, the answer, or the roof job.
create or replace function wb_api.manage_get(p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
  s wb.slots;
  e wb.estimates;
  j wb.jobs;
  last_activity timestamptz;
begin
  select * into b from wb.bookings where manage_token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  select * into s from wb.slots where id = b.slot_id;
  select * into e from wb.estimates where booking_id = b.id;
  select * into j from wb.jobs where booking_id = b.id;
  last_activity := greatest(s.ends_at, e.sent_at, e.decided_at, e.replied_at, (j.day + 1)::timestamptz, j.done_at);
  if last_activity < now() - interval '60 days' then
    return null;
  end if;
  -- The first time the customer opens a sent estimate, the owners see "viewed".
  if e.status = 'sent' and e.viewed_at is null then
    update wb.estimates set viewed_at = now() where id = e.id;
  end if;
  return wb.booking_summary(b);
end $$;

-- The customer's answer from their private link.
create function wb_api.estimate_answer(p_token_hash bytea, p_answer text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
  e wb.estimates;
  v_note text := left(nullif(trim(p_note), ''), 1000);
begin
  if p_answer is null or p_answer not in ('accept', 'decline', 'question') then
    raise exception 'bad_answer' using errcode = 'WB400';
  end if;
  select * into b from wb.bookings where manage_token_hash = p_token_hash;
  if not found then
    raise exception 'not_found' using errcode = 'WB404';
  end if;
  select * into e from wb.estimates where booking_id = b.id for update;
  if not found or e.status not in ('sent', 'accepted', 'declined') then
    raise exception 'not_found' using errcode = 'WB404';
  end if;

  if p_answer = 'question' then
    if v_note is null then
      raise exception 'empty_question' using errcode = 'WB400';
    end if;
    update wb.estimates set replied_at = now(), customer_note = v_note where id = e.id;
    insert into wb.booking_events (booking_id, actor, kind, detail)
    values (b.id, 'customer', 'estimate_question', jsonb_build_object('note', v_note));
    return wb.booking_summary(b);
  end if;

  if e.status <> 'sent' then
    -- A second tap, or an old tab: the same answer again changes nothing.
    if (p_answer = 'accept' and e.status = 'accepted') or (p_answer = 'decline' and e.status = 'declined') then
      return wb.booking_summary(b);
    end if;
    raise exception 'already_answered' using errcode = 'WB423';
  end if;

  update wb.estimates
  set status = case p_answer when 'accept' then 'accepted' else 'declined' end,
      decided_at = now(),
      customer_note = coalesce(v_note, customer_note)
  where id = e.id
  returning * into e;

  if p_answer = 'accept' then
    insert into wb.jobs (booking_id) values (b.id)
    on conflict (booking_id) do update set status = 'to_schedule', crew_id = null, day = null
    where wb.jobs.status = 'cancelled';
  end if;

  insert into wb.booking_events (booking_id, actor, kind, detail)
  values (b.id, 'customer', 'estimate_' || e.status, jsonb_build_object('note', v_note));

  return wb.booking_summary(b);
end $$;

-- The customer's estimate file (a PDF), if there is one: its storage path, for a short-lived link.
create function wb_api.estimate_file(p_token_hash bytea) returns text
language sql stable security definer set search_path = '' as $$
  select e.file_path
  from wb.bookings b join wb.estimates e on e.booking_id = b.id
  where b.manage_token_hash = p_token_hash and e.status in ('sent', 'accepted', 'declined')
$$;

alter table wb.crews enable row level security;
alter table wb.estimates enable row level security;
alter table wb.jobs enable row level security;
create policy owners_only on wb.crews for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.estimates for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.jobs for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
grant select, insert, update, delete on wb.crews, wb.estimates, wb.jobs to authenticated, service_role;

revoke all on function wb_api.estimate_file(bytea) from public;
grant execute on function wb_api.estimate_file(bytea) to anon, authenticated, service_role;
revoke all on function wb_api.estimate_answer(bytea, text, text) from public;
grant execute on function wb_api.estimate_answer(bytea, text, text) to anon, authenticated, service_role;
revoke all on function wb_api.manage_get(bytea) from public;
grant execute on function wb_api.manage_get(bytea) to anon, authenticated, service_role;

-- Estimate PDFs, private like the photos. Skipped on plain Postgres (tests).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('estimate-files', 'estimate-files', false, 10485760, array['application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;
