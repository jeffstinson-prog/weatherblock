-- Private storage for customers' roof photos (Supabase Storage).
-- Skipped on plain Postgres (tests), where there is no storage schema.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('booking-photos', 'booking-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;
