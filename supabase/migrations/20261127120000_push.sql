-- Phone notifications: the phones (and computers) each owner turned them on
-- for, in the installed owner app. A new lead or booking pings them at once,
-- without waiting on text-message registration.
--
-- The site's own key pair for signing them (Web Push "VAPID" keys) is made by
-- the server the first time it's needed and kept here, so no key has to be
-- copied anywhere by hand. Only the server reads it.

create table wb.push_keys (
  id smallint primary key default 1 check (id = 1),
  public_key text not null check (length(public_key) between 40 and 200),
  private_key text not null check (length(private_key) between 20 and 200),
  created_at timestamptz not null default now()
);
alter table wb.push_keys enable row level security;
revoke all on wb.push_keys from public, anon, authenticated;
grant select, insert on wb.push_keys to service_role;

create table wb.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references wb.owners (user_id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  device text not null default '' check (length(device) <= 120),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  failures smallint not null default 0
);
create index push_subscriptions_user on wb.push_subscriptions (user_id);

alter table wb.push_subscriptions enable row level security;
-- Each owner sees and changes only their own devices.
create policy own_devices on wb.push_subscriptions for all to authenticated
  using (wb.is_owner() and user_id = auth.uid()) with check (wb.is_owner() and user_id = auth.uid());
grant select, insert, update, delete on wb.push_subscriptions to authenticated, service_role;
