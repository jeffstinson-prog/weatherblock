-- Booking: availability, bookings, capacity enforced by the database.
--
-- Schemas
--   wb      private tables. The public never reads them directly.
--   wb_api  the only functions the public (role anon) may call.
-- Owners (role authenticated) read and write wb.* through row level security.

create schema if not exists wb;
create schema if not exists wb_api;

-- ---------------------------------------------------------------------------
-- Owners and settings
-- ---------------------------------------------------------------------------

create table wb.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  email text not null,
  mobile text check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  alert_sms boolean not null default true,
  alert_email boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table wb.settings (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'America/New_York',
  inspectors smallint not null default 1 check (inspectors between 0 and 20),
  horizon_days smallint not null default 21 check (horizon_days between 1 and 90),
  min_notice_hours smallint not null default 12 check (min_notice_hours between 0 and 168),
  calendar_id text,
  slots_refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into wb.settings (id) values (1);

-- Two-hour windows by weekday (0 = Sunday). Capacity null means "number of inspectors".
create table wb.weekly_windows (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  capacity smallint check (capacity between 0 and 20),
  check (end_time > start_time),
  unique (weekday, start_time)
);

-- Starting point the owners can change in the app: Monday to Saturday, 8 am to 4 pm.
insert into wb.weekly_windows (weekday, start_time, end_time)
select d, t, t + interval '2 hours'
from generate_series(1, 6) as d,
     unnest(array['08:00', '10:00', '12:00', '14:00']::time[]) as t;

create table wb.days_off (
  day date primary key,
  note text check (length(note) <= 200)
);

-- Busy times copied from the Google Calendar (times only, never titles).
create table wb.calendar_busy (
  event_id text primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------------
-- Slots: one row per bookable window. The row is what gets locked.
-- ---------------------------------------------------------------------------

create table wb.slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity smallint not null check (capacity >= 0),
  capacity_override smallint check (capacity_override between 0 and 20),
  check (ends_at > starts_at),
  unique (starts_at, ends_at)
);

-- ---------------------------------------------------------------------------
-- Referrers, bookings, photos, history
-- ---------------------------------------------------------------------------

create table wb.referrers (
  code text primary key check (code ~ '^[A-Z0-9]{2,20}$'),
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('agent', 'property_manager', 'other')),
  company text check (length(company) <= 120),
  phone text check (length(phone) <= 30),
  email text check (length(email) <= 254),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table wb.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique check (ref ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  status text not null default 'booked' check (status in ('booked', 'done', 'cancelled', 'no_show')),
  slot_id uuid not null references wb.slots (id),

  -- the home
  address text not null check (length(address) between 5 and 300),
  place_id text check (length(place_id) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  county text check (length(county) <= 80),
  city text check (length(city) <= 80),
  zip text check (zip ~ '^[0-9]{5}$'),
  relationship text not null check (relationship in ('owner', 'renter', 'property_manager', 'agent', 'buyer', 'family', 'other')),

  -- the roof
  roof_material text not null check (roof_material in ('shingle', 'metal', 'tile', 'flat', 'other', 'unknown')),
  roof_age text not null check (roof_age in ('0-5', '5-10', '10-15', '15-20', '20+', 'unknown')),
  reason text not null check (reason in ('leak', 'storm', 'damage', 'replace', 'sale', 'insurance', 'checkup', 'other')),
  notes text check (length(notes) <= 2000),

  -- the visit
  someone_home text not null check (someone_home in ('yes', 'no', 'not_sure')),
  gate_code text check (length(gate_code) <= 100),
  pets text check (length(pets) <= 300),

  -- the person
  name text not null check (length(name) between 1 and 120),
  mobile text not null check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  email text not null check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  sms_consent boolean not null default false,
  sms_consent_text text,
  sms_consent_at timestamptz,
  check (not sms_consent or (sms_consent_text is not null and sms_consent_at is not null)),

  -- where they came from
  lead_source text not null default 'direct' check (length(lead_source) <= 40),
  heard_about text check (length(heard_about) <= 60),
  referral_code text check (referral_code ~ '^[A-Z0-9]{2,20}$'),
  utm jsonb not null default '{}'::jsonb,
  via_assistant boolean not null default false,

  -- access: the secret link holds a token; only its hash is stored
  manage_token_hash bytea not null unique,
  idempotency_key uuid not null unique,

  -- owner side
  owner_notes text check (length(owner_notes) <= 5000),
  on_my_way_at timestamptz,
  calendar_event_id text,
  calendar_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 500)
);
create index bookings_active_slot on wb.bookings (slot_id) where status <> 'cancelled';
create index bookings_mobile on wb.bookings (mobile);

create table wb.booking_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references wb.bookings (id) on delete cascade,
  draft_key uuid not null,
  path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer not null check (bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index booking_photos_draft on wb.booking_photos (draft_key);
create index booking_photos_booking on wb.booking_photos (booking_id);

create table wb.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references wb.bookings (id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb
);
create index booking_events_booking on wb.booking_events (booking_id, at);

-- Simple request counter for rate limits (hashed keys only).
create table wb.rate_events (
  bucket text not null,
  key_hash text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup on wb.rate_events (bucket, key_hash, at);

-- ---------------------------------------------------------------------------
-- Capacity: a window can never be overbooked.
-- Every insert or move of an active booking locks the slot row first, then
-- counts. A second booking for the same slot waits for the lock, then sees
-- the first one, so two people can't both take the last spot.
-- ---------------------------------------------------------------------------

create function wb.enforce_capacity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cap integer;
  used integer;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.slot_id = old.slot_id and old.status <> 'cancelled' then
    return new;
  end if;

  select coalesce(s.capacity_override, s.capacity) into cap
  from wb.slots s where s.id = new.slot_id
  for update;
  if not found then
    raise exception 'slot_not_found' using errcode = 'WB404';
  end if;

  select count(*) into used
  from wb.bookings b
  where b.slot_id = new.slot_id and b.status <> 'cancelled' and b.id <> new.id;

  if used >= cap then
    raise exception 'slot_full' using errcode = 'WB409';
  end if;
  return new;
end $$;

create trigger bookings_capacity
before insert or update of slot_id, status on wb.bookings
for each row execute function wb.enforce_capacity();

create function wb.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger bookings_touch before update on wb.bookings
for each row execute function wb.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Building slots from weekly windows, days off, inspectors and calendar busy times
-- ---------------------------------------------------------------------------

create function wb.refresh_slots() returns void
language plpgsql security definer set search_path = '' as $$
declare
  st wb.settings;
  today date;
begin
  select * into st from wb.settings where id = 1;
  today := (now() at time zone st.timezone)::date;

  with days as (
    select today + i as day from generate_series(0, st.horizon_days + 1) as i
  ),
  desired as (
    select (d.day + w.start_time) at time zone st.timezone as starts_at,
           (d.day + w.end_time) at time zone st.timezone as ends_at,
           coalesce(w.capacity, st.inspectors) as base
    from days d
    join wb.weekly_windows w on w.weekday = extract(dow from d.day)::int
    where not exists (select 1 from wb.days_off o where o.day = d.day)
  ),
  sized as (
    -- Each busy event on the calendar takes one inspector out of the windows it overlaps.
    select x.starts_at, x.ends_at,
           greatest(0, x.base - (
             select count(*) from wb.calendar_busy c
             where c.starts_at < x.ends_at and c.ends_at > x.starts_at
           ))::smallint as capacity
    from desired x
  ),
  upserted as (
    insert into wb.slots (starts_at, ends_at, capacity)
    select starts_at, ends_at, capacity from sized
    on conflict (starts_at, ends_at) do update set capacity = excluded.capacity
      where wb.slots.capacity is distinct from excluded.capacity
    returning 1
  )
  -- Windows no longer offered (removed, or a day off) close. Existing bookings stay.
  update wb.slots s set capacity = 0
  where s.starts_at >= now()
    and s.capacity <> 0
    and not exists (select 1 from sized z where z.starts_at = s.starts_at and z.ends_at = s.ends_at);

  update wb.settings set slots_refreshed_at = now() where id = 1;
end $$;

create function wb.after_availability_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform wb.refresh_slots();
  return null;
end $$;

create trigger weekly_windows_changed after insert or update or delete on wb.weekly_windows
for each statement execute function wb.after_availability_change();
create trigger days_off_changed after insert or update or delete on wb.days_off
for each statement execute function wb.after_availability_change();
create trigger calendar_busy_changed after insert or update or delete on wb.calendar_busy
for each statement execute function wb.after_availability_change();
create trigger settings_changed after update of timezone, inspectors, horizon_days on wb.settings
for each statement execute function wb.after_availability_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Booking references: 6 characters, no I, L, O or U so they read cleanly over the phone.
create function wb.new_ref() returns text
language sql volatile as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;

create function wb.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from wb.owners o where o.user_id = auth.uid() and o.active)
$$;

-- What the customer may see about their own booking.
create function wb.booking_summary(b wb.bookings) returns jsonb
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
    'can_change', b.status = 'booked' and s.starts_at > now()
  )
  from wb.slots s where s.id = b.slot_id
$$;

create function wb.check_bookable(p_slot wb.slots) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  st wb.settings;
begin
  select * into st from wb.settings where id = 1;
  if p_slot.starts_at < now() + make_interval(hours => st.min_notice_hours)
     or p_slot.starts_at > now() + make_interval(days => st.horizon_days + 1) then
    raise exception 'slot_not_offered' using errcode = 'WB410';
  end if;
end $$;

-- Gate and lockbox codes are deleted a week after the visit.
create function wb.purge_gate_codes() returns integer
language sql security definer set search_path = '' as $$
  with cleared as (
    update wb.bookings b set gate_code = null
    from wb.slots s
    where s.id = b.slot_id and b.gate_code is not null and s.ends_at < now() - interval '7 days'
    returning 1
  )
  select count(*)::integer from cleared
$$;

-- ---------------------------------------------------------------------------
-- Public API (role anon). Each function does one narrow thing.
-- ---------------------------------------------------------------------------

create function wb_api.available_slots()
returns table (slot_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  st wb.settings;
begin
  select * into st from wb.settings where id = 1;
  if st.slots_refreshed_at is null or st.slots_refreshed_at < now() - interval '10 minutes' then
    perform wb.refresh_slots();
  end if;
  return query
    select s.id, s.starts_at, s.ends_at
    from wb.slots s
    where s.starts_at >= now() + make_interval(hours => st.min_notice_hours)
      and s.starts_at <= now() + make_interval(days => st.horizon_days + 1)
      and coalesce(s.capacity_override, s.capacity) > (
        select count(*) from wb.bookings b where b.slot_id = s.id and b.status <> 'cancelled'
      )
    order by s.starts_at;
end $$;

create function wb_api.create_booking(p jsonb, p_token_hash bytea, p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s wb.slots;
  b wb.bookings;
  tries integer := 0;
  v_constraint text;
  v_consent boolean := coalesce((p ->> 'sms_consent')::boolean, false);
  v_code text := nullif(upper(trim(p ->> 'referral_code')), '');
  v_source text := coalesce(nullif(p ->> 'lead_source', ''), 'direct');
begin
  -- The same request again (a double tap or a retry) returns the booking already made.
  select * into b from wb.bookings where idempotency_key = p_key;
  if found then
    if b.manage_token_hash <> p_token_hash then
      raise exception 'idempotency_mismatch' using errcode = 'WB400';
    end if;
    return wb.booking_summary(b) || jsonb_build_object('existing', true);
  end if;

  select * into s from wb.slots where id = (p ->> 'slot_id')::uuid;
  if not found then
    raise exception 'slot_not_found' using errcode = 'WB404';
  end if;
  perform wb.check_bookable(s);

  -- One number can't hold more than 3 upcoming inspections (stops calendar spam).
  if (select count(*) from wb.bookings bk join wb.slots sl on sl.id = bk.slot_id
      where bk.mobile = p ->> 'mobile' and bk.status = 'booked' and sl.starts_at > now()) >= 3 then
    raise exception 'too_many_bookings' using errcode = 'WB429';
  end if;

  if v_code is not null and exists (select 1 from wb.referrers r where r.code = v_code and r.active) then
    v_source := 'referral';
  end if;

  loop
    begin
      insert into wb.bookings (
        ref, slot_id, address, place_id, lat, lng, county, city, zip, relationship,
        roof_material, roof_age, reason, notes, someone_home, gate_code, pets,
        name, mobile, email, sms_consent, sms_consent_text, sms_consent_at,
        lead_source, heard_about, referral_code, utm, via_assistant,
        manage_token_hash, idempotency_key
      ) values (
        wb.new_ref(), s.id, p ->> 'address', nullif(p ->> 'place_id', ''),
        (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
        nullif(p ->> 'county', ''), nullif(p ->> 'city', ''), nullif(p ->> 'zip', ''), p ->> 'relationship',
        p ->> 'roof_material', p ->> 'roof_age', p ->> 'reason', nullif(p ->> 'notes', ''),
        p ->> 'someone_home', nullif(p ->> 'gate_code', ''), nullif(p ->> 'pets', ''),
        trim(p ->> 'name'), p ->> 'mobile', lower(trim(p ->> 'email')),
        v_consent, case when v_consent then p ->> 'sms_consent_text' end, case when v_consent then now() end,
        v_source, nullif(p ->> 'heard_about', ''), v_code, coalesce(p -> 'utm', '{}'::jsonb),
        coalesce((p ->> 'via_assistant')::boolean, false),
        p_token_hash, p_key
      )
      returning * into b;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'bookings_ref_key' and tries < 5 then
        tries := tries + 1;  -- reference collision: draw another
      elsif v_constraint = 'bookings_idempotency_key_key' then
        -- The same request finished in parallel: return it.
        select * into b from wb.bookings where idempotency_key = p_key;
        return wb.booking_summary(b) || jsonb_build_object('existing', true);
      else
        raise;
      end if;
    end;
  end loop;

  insert into wb.booking_events (booking_id, actor, kind, detail)
  values (b.id, 'customer', 'created', jsonb_build_object('slot_id', s.id, 'starts_at', s.starts_at));

  update wb.booking_photos set booking_id = b.id
  where draft_key = p_key and booking_id is null;

  return wb.booking_summary(b) || jsonb_build_object('existing', false);
end $$;

create function wb_api.manage_get(p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
  s wb.slots;
begin
  select * into b from wb.bookings where manage_token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  select * into s from wb.slots where id = b.slot_id;
  -- Links stop working 30 days after the visit.
  if s.ends_at < now() - interval '30 days' then
    return null;
  end if;
  return wb.booking_summary(b);
end $$;

create function wb_api.manage_reschedule(p_token_hash bytea, p_slot_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
  old_slot wb.slots;
  new_slot wb.slots;
begin
  select * into b from wb.bookings where manage_token_hash = p_token_hash for update;
  if not found then
    raise exception 'not_found' using errcode = 'WB404';
  end if;
  select * into old_slot from wb.slots where id = b.slot_id;
  if b.status <> 'booked' or old_slot.starts_at <= now() then
    raise exception 'cannot_change' using errcode = 'WB423';
  end if;
  if p_slot_id = b.slot_id then
    return wb.booking_summary(b);
  end if;
  select * into new_slot from wb.slots where id = p_slot_id;
  if not found then
    raise exception 'slot_not_found' using errcode = 'WB404';
  end if;
  perform wb.check_bookable(new_slot);

  update wb.bookings set slot_id = p_slot_id, on_my_way_at = null
  where id = b.id
  returning * into b;

  insert into wb.booking_events (booking_id, actor, kind, detail)
  values (b.id, 'customer', 'rescheduled', jsonb_build_object('from', old_slot.starts_at, 'to', new_slot.starts_at));

  return wb.booking_summary(b);
end $$;

create function wb_api.manage_cancel(p_token_hash bytea, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b wb.bookings;
  s wb.slots;
begin
  select * into b from wb.bookings where manage_token_hash = p_token_hash for update;
  if not found then
    raise exception 'not_found' using errcode = 'WB404';
  end if;
  select * into s from wb.slots where id = b.slot_id;
  if b.status <> 'booked' or s.starts_at <= now() then
    raise exception 'cannot_change' using errcode = 'WB423';
  end if;

  update wb.bookings
  set status = 'cancelled', cancelled_at = now(), cancel_reason = left(nullif(trim(p_reason), ''), 500)
  where id = b.id
  returning * into b;

  insert into wb.booking_events (booking_id, actor, kind, detail)
  values (b.id, 'customer', 'cancelled', jsonb_build_object('reason', b.cancel_reason));

  return wb.booking_summary(b);
end $$;

create function wb_api.register_photo(p_draft_key uuid, p_path text, p_content_type text, p_bytes integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  photo_id uuid;
begin
  -- Paths are random ("uploads/<uuid>.jpg") so nothing about the booking shows in storage logs.
  if p_path !~ '^uploads/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'bad_path' using errcode = 'WB400';
  end if;
  if (select count(*) from wb.booking_photos where draft_key = p_draft_key) >= 6 then
    raise exception 'too_many_photos' using errcode = 'WB429';
  end if;
  insert into wb.booking_photos (draft_key, path, content_type, bytes)
  values (p_draft_key, p_path, p_content_type, p_bytes)
  returning id into photo_id;
  return photo_id;
end $$;

-- Taking a photo back out before booking.
create function wb_api.remove_draft_photo(p_draft_key uuid, p_photo_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from wb.booking_photos
  where id = p_photo_id and draft_key = p_draft_key and booking_id is null
$$;

create function wb_api.rate_ok(p_bucket text, p_key text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if random() < 0.02 then
    delete from wb.rate_events where at < now() - interval '1 day';
  end if;
  select count(*) into n from wb.rate_events
  where bucket = p_bucket and key_hash = p_key and at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into wb.rate_events (bucket, key_hash) values (p_bucket, p_key);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------

alter table wb.owners enable row level security;
alter table wb.settings enable row level security;
alter table wb.weekly_windows enable row level security;
alter table wb.days_off enable row level security;
alter table wb.calendar_busy enable row level security;
alter table wb.slots enable row level security;
alter table wb.referrers enable row level security;
alter table wb.bookings enable row level security;
alter table wb.booking_photos enable row level security;
alter table wb.booking_events enable row level security;
alter table wb.rate_events enable row level security;

create policy owners_only on wb.owners for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.settings for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.weekly_windows for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.days_off for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.calendar_busy for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.slots for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.referrers for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.bookings for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.booking_photos for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
create policy owners_only on wb.booking_events for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
-- rate_events: no policy, so only the functions above touch it.

-- Functions are executable by everyone by default in Postgres. Take that away.
revoke all on all functions in schema wb from public;
revoke all on all functions in schema wb_api from public;
alter default privileges in schema wb revoke execute on functions from public;
alter default privileges in schema wb_api revoke execute on functions from public;

grant usage on schema wb to authenticated, service_role;
grant select, insert, update, delete on all tables in schema wb to authenticated, service_role;
grant usage, select on all sequences in schema wb to authenticated, service_role;
grant execute on function wb.is_owner() to authenticated;
-- Background jobs (reminders, calendar sync, clean-up) run as service_role.
grant execute on function wb.refresh_slots(), wb.purge_gate_codes() to service_role;

grant usage on schema wb_api to anon, authenticated, service_role;
grant execute on all functions in schema wb_api to anon, authenticated, service_role;

-- Build the first slots now.
select wb.refresh_slots();
