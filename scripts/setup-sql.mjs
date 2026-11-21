// Prints every migration as one file to paste into the Supabase SQL Editor:
//   npm run --silent db:setup-sql > setup.sql
// For a new, empty project. It runs as one transaction, records the
// migrations so the Supabase CLI knows they're in, opens the first windows,
// and ends with a one-line summary to check.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const split = (f) => {
  const stem = f.replace(/\.sql$/, '');
  const i = stem.indexOf('_');
  return { version: stem.slice(0, i), name: stem.slice(i + 1) };
};

const out = [
  '-- WeatherBlock Roofing: database setup.',
  '-- For a new, empty Supabase project. Paste all of it into the SQL Editor and click Run.',
  "-- It runs as one transaction: if anything fails, nothing is changed.",
  '',
  'begin;',
  '',
];
for (const f of files) {
  out.push(`-- ===== ${f} =====`, readFileSync(join(dir, f), 'utf8').trimEnd(), '');
}
out.push(
  "-- ===== Record the migrations, so the Supabase CLI knows they're in =====",
  'create schema if not exists supabase_migrations;',
  'create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);',
  'insert into supabase_migrations.schema_migrations (version, name) values',
  files.map((f) => `  ('${split(f).version}', '${split(f).name}')`).join(',\n'),
  'on conflict (version) do nothing;',
  '',
  "-- Open the first three weeks of windows now (the site's 15-minute job keeps them current).",
  'select wb.refresh_slots();',
  '',
  'commit;',
  '',
  '-- What you should see: tables 14, tables_without_row_security 0,',
  '-- bookable_windows about 75 (it depends on the day), photo_bucket 1, migrations 5.',
  'select',
  "  (select count(*) from pg_tables where schemaname = 'wb') as tables,",
  "  (select count(*) from pg_tables where schemaname = 'wb' and not rowsecurity) as tables_without_row_security,",
  '  (select count(*) from wb.slots where starts_at > now()) as bookable_windows,',
  "  (select count(*) from storage.buckets where id = 'booking-photos') as photo_bucket,",
  `  (select count(*) from supabase_migrations.schema_migrations where version in (${files.map((f) => `'${split(f).version}'`).join(', ')})) as migrations;`,
);
process.stdout.write(out.join('\n') + '\n');
