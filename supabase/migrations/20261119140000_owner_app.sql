-- Owner app: calendar sync status, and a few views for the app and the CSV export.

-- A booking's "last changed" time ignores the calendar sync's own bookkeeping,
-- so the sync can tell when a booking really changed.
create or replace function wb.touch_updated_at() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'calendar_event_id' - 'calendar_synced_at' - 'updated_at')
     is distinct from (to_jsonb(old) - 'calendar_event_id' - 'calendar_synced_at' - 'updated_at') then
    new.updated_at := now();
  end if;
  return new;
end $$;

alter table wb.settings
  add column calendar_status text not null default 'not_connected'
    check (calendar_status in ('not_connected', 'ok', 'error')),
  add column calendar_error text,
  add column calendar_synced_at timestamptz;

-- Bookings with their window, for lists and the export. Runs with the
-- caller's rights, so row level security still applies.
create view wb.booking_list with (security_invoker = true) as
select
  b.id, b.ref, b.status, b.slot_id, s.starts_at, s.ends_at,
  b.address, b.city, b.zip, b.county, b.lat, b.lng,
  b.name, b.mobile, b.email, b.relationship,
  b.roof_material, b.roof_age, b.reason, b.notes,
  b.someone_home, b.gate_code is not null as has_gate_code, b.pets,
  b.sms_consent, b.lead_source, b.heard_about, b.referral_code,
  r.name as referrer_name, r.kind as referrer_kind,
  b.utm, b.via_assistant, b.owner_notes, b.on_my_way_at,
  b.created_at, b.updated_at, b.cancelled_at, b.cancel_reason,
  (select count(*)::int from wb.booking_photos p where p.booking_id = b.id) as photos
from wb.bookings b
join wb.slots s on s.id = b.slot_id
left join wb.referrers r on r.code = b.referral_code;

grant select on wb.booking_list to authenticated, service_role;

-- How full each upcoming window is (for the owners' view of the week).
create view wb.slot_load with (security_invoker = true) as
select s.id, s.starts_at, s.ends_at, coalesce(s.capacity_override, s.capacity) as capacity,
       (select count(*)::int from wb.bookings b where b.slot_id = s.id and b.status <> 'cancelled') as booked
from wb.slots s;

grant select on wb.slot_load to authenticated, service_role;
