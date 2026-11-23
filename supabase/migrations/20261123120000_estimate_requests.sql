-- Estimate requests: someone enters their address and how to reach them on
-- /estimate/. The request comes to the owners first, with the roof measured
-- from above, so one of them can call. Booking a visit closes the loop.
--
-- Also: the measured roof travels with the booking, and an estimate can show
-- the roof's size and pitch. What Google gave us (map positions and roof
-- measurements) is deleted after 30 days, as its terms ask; the address and
-- Google's place ID stay, so it can be looked up again.

create table wb.estimate_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique check (ref ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  status text not null default 'new' check (status in ('new', 'called', 'booked', 'closed')),

  -- the home
  address text not null check (length(address) between 5 and 300),
  place_id text check (length(place_id) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  county text check (length(county) <= 80),
  city text check (length(city) <= 80),
  zip text check (zip ~ '^[0-9]{5}$'),
  state text check (length(state) <= 2),

  -- the person
  name text not null check (length(name) between 1 and 120),
  mobile text not null check (mobile ~ '^\+1[2-9][0-9]{9}$'),
  email text check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- the roof as measured from above, and a ballpark. Owners only.
  roof jsonb check (pg_column_size(roof) <= 4000),
  roof_measured_at timestamptz,

  -- where they came from
  lead_source text not null default 'direct' check (length(lead_source) <= 40),
  utm jsonb not null default '{}'::jsonb,

  -- what happened next
  booking_id uuid references wb.bookings (id) on delete set null,
  owner_notes text check (length(owner_notes) <= 5000),
  called_at timestamptz,
  reminded_at timestamptz,
  closed_at timestamptz,
  close_reason text check (length(close_reason) <= 200),

  -- the customer's link to pick a time holds a token; only its hash is stored
  token_hash bytea not null unique,
  idempotency_key uuid not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index estimate_requests_open on wb.estimate_requests (created_at) where status in ('new', 'called');
create index estimate_requests_mobile on wb.estimate_requests (mobile);

-- Messages about a request (the owners' alert, the customer's copy).
alter table wb.messages add column request_id uuid references wb.estimate_requests (id) on delete set null;
create index messages_request on wb.messages (request_id, created_at) where request_id is not null;

-- The measured roof travels with the booking, for the owners.
alter table wb.bookings
  add column roof jsonb check (pg_column_size(roof) <= 4000),
  add column roof_measured_at timestamptz;

-- The roof's size and pitch as the estimate states them. The owner confirms or
-- corrects them when writing the estimate, so they are ours to keep.
alter table wb.estimates
  add column roof_sqft integer check (roof_sqft between 100 and 200000),
  add column roof_pitch smallint check (roof_pitch between 0 and 24);

-- A booking's "last changed" time ignores bookkeeping: the calendar sync's own
-- fields, and the map position and roof measurement the clean-up removes.
create or replace function wb.touch_updated_at() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'calendar_event_id' - 'calendar_synced_at' - 'updated_at' - 'lat' - 'lng' - 'roof' - 'roof_measured_at')
     is distinct from
     (to_jsonb(old) - 'calendar_event_id' - 'calendar_synced_at' - 'updated_at' - 'lat' - 'lng' - 'roof' - 'roof_measured_at') then
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger estimate_requests_touch before update on wb.estimate_requests
  for each row execute function wb.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Public API (role anon)
-- ---------------------------------------------------------------------------

create function wb_api.create_estimate_request(p jsonb, p_token_hash bytea, p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r wb.estimate_requests;
  tries integer := 0;
  v_constraint text;
begin
  -- The same request again (a double tap or a retry) returns the one already made.
  select * into r from wb.estimate_requests where idempotency_key = p_key;
  if found then
    return jsonb_build_object('id', r.id, 'ref', r.ref, 'existing', true);
  end if;

  -- The same person asking again about the same home within a day: one request, one alert.
  select * into r from wb.estimate_requests
  where mobile = p ->> 'mobile' and lower(address) = lower(p ->> 'address')
    and status in ('new', 'called') and created_at > now() - interval '1 day'
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', r.id, 'ref', r.ref, 'existing', true);
  end if;

  -- One number can't flood the owners' phones.
  if (select count(*) from wb.estimate_requests where mobile = p ->> 'mobile' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'too_many_requests' using errcode = 'WB429';
  end if;

  loop
    begin
      insert into wb.estimate_requests (
        ref, address, place_id, lat, lng, county, city, zip, state,
        name, mobile, email, lead_source, utm, token_hash, idempotency_key
      ) values (
        wb.new_ref(), p ->> 'address', nullif(p ->> 'place_id', ''),
        (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
        nullif(p ->> 'county', ''), nullif(p ->> 'city', ''), nullif(p ->> 'zip', ''), nullif(p ->> 'state', ''),
        trim(p ->> 'name'), p ->> 'mobile', nullif(lower(trim(p ->> 'email')), ''),
        coalesce(nullif(p ->> 'lead_source', ''), 'direct'), coalesce(p -> 'utm', '{}'::jsonb),
        p_token_hash, p_key
      )
      returning * into r;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'estimate_requests_ref_key' and tries < 5 then
        tries := tries + 1;  -- reference collision: draw another
      elsif v_constraint = 'estimate_requests_idempotency_key_key' then
        -- The same request finished in parallel: return it.
        select * into r from wb.estimate_requests where idempotency_key = p_key;
        return jsonb_build_object('id', r.id, 'ref', r.ref, 'existing', true);
      else
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object('id', r.id, 'ref', r.ref, 'existing', false);
end $$;

-- The customer's link to pick a time: what they already told us, so the booking
-- form starts filled in. Works while the request is open, for 60 days.
create function wb_api.estimate_request_get(p_token_hash bytea) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ref', r.ref,
    'address', r.address,
    'place_id', r.place_id,
    'lat', r.lat,
    'lng', r.lng,
    'county', r.county,
    'city', r.city,
    'zip', r.zip,
    'state', r.state,
    'name', r.name,
    'mobile', r.mobile,
    'email', r.email
  )
  from wb.estimate_requests r
  where r.token_hash = p_token_hash
    and r.status in ('new', 'called')
    and r.created_at > now() - interval '60 days'
$$;

-- What the customer may see: the visit, then the estimate once sent (now with
-- the roof's size and pitch when the estimate states them), then the job.
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
    -- True when the address was picked from the map's list, so a satellite picture of it can be trusted.
    'has_place', b.place_id is not null,
    'estimate', (
      select jsonb_build_object(
        'status', e.status,
        'amount_cents', e.amount_cents,
        'summary', e.summary,
        'has_file', e.file_path is not null,
        'sent_at', e.sent_at,
        'decided_at', e.decided_at,
        'asked_at', e.replied_at,
        'roof_sqft', e.roof_sqft,
        'roof_pitch', e.roof_pitch
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

-- Clean-up the scheduled job runs. New here: what Google gave us is deleted
-- after 30 days (map positions from address lookup, and roof measurements).
create or replace function wb.cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gate integer;
  rates integer;
  questions integer;
  google integer := 0;
  n integer;
begin
  gate := wb.purge_gate_codes();
  delete from wb.rate_events where at < now() - interval '1 day';
  get diagnostics rates = row_count;
  delete from wb.assistant_questions where asked_at < now() - interval '30 days';
  get diagnostics questions = row_count;

  update wb.bookings set lat = null, lng = null
  where lat is not null and created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  google := google + n;
  update wb.bookings set roof = null, roof_measured_at = null
  where roof ->> 'source' = 'google' and roof_measured_at < now() - interval '30 days';
  get diagnostics n = row_count;
  google := google + n;
  update wb.estimate_requests set lat = null, lng = null
  where lat is not null and created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  google := google + n;
  update wb.estimate_requests set roof = null, roof_measured_at = null
  where roof ->> 'source' = 'google' and roof_measured_at < now() - interval '30 days';
  get diagnostics n = row_count;
  google := google + n;

  return jsonb_build_object('gate_codes', gate, 'rate_events', rates, 'assistant_questions', questions, 'google_data', google);
end $$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table wb.estimate_requests enable row level security;
create policy owners_only on wb.estimate_requests for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
grant select, insert, update, delete on wb.estimate_requests to authenticated, service_role;

revoke all on function wb_api.create_estimate_request(jsonb, bytea, uuid) from public;
grant execute on function wb_api.create_estimate_request(jsonb, bytea, uuid) to anon, authenticated, service_role;
revoke all on function wb_api.estimate_request_get(bytea) from public;
grant execute on function wb_api.estimate_request_get(bytea) to anon, authenticated, service_role;
revoke all on function wb.cleanup() from public;
grant execute on function wb.cleanup() to service_role;
