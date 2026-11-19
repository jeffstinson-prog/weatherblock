// Make someone an owner: they can then sign in to /app/ with an emailed code.
// Usage (with the production environment variables set):
//   node scripts/add-owner.mjs justin@example.com "Justin Coffey" 9105550123
// Needs PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL.
// (Or create the user in Supabase: Authentication, Users, Add user, then run this.)
import postgres from 'postgres';

const [email, name, mobile = ''] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node scripts/add-owner.mjs <email> "<name>" [mobile]');
  process.exit(1);
}
const base = process.env.PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key || !process.env.DATABASE_URL) {
  console.error('Set PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL first.');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

let res = await fetch(`${base}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, email_confirm: true }) });
let id;
if (res.ok) {
  id = (await res.json()).id;
} else {
  // Already a user: find them.
  res = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  const users = (await res.json()).users ?? [];
  id = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}
if (!id) {
  console.error('Could not create or find that user in Supabase Auth.');
  process.exit(1);
}
const digits = mobile.replace(/\D/g, '').slice(-10);
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`
  insert into wb.owners (user_id, name, email, mobile) values (${id}, ${name}, ${email.toLowerCase()}, ${digits ? `+1${digits}` : null})
  on conflict (user_id) do update set name = excluded.name, email = excluded.email, mobile = excluded.mobile, active = true`;
await sql.end();
console.log(`${name} (${email}) is an owner. They can sign in at /app/.`);
