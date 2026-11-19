// Work the scheduled job does every 15 minutes.
import { asService } from './db';
import { config } from './env';
import { retryFailed } from './messaging/send';
import { runReminders } from './reminders';
import { syncCalendar } from './calendar';

async function removeOrphanPhotos(): Promise<number> {
  const rows = await asService(
    (tx) => tx`select id, path from wb.booking_photos where booking_id is null and created_at < now() - interval '2 days' limit 100`,
  );
  if (rows.length === 0) return 0;
  const base = config.supabaseUrl();
  const key = config.supabaseServiceKey();
  if (base && key) {
    const headers: Record<string, string> = key.startsWith('eyJ')
      ? { apikey: key, Authorization: `Bearer ${key}` }
      : { apikey: key };
    const res = await fetch(`${base}/storage/v1/object/${config.photoBucket()}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: rows.map((r) => r.path) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Could not delete photos: ${res.status}`);
  }
  await asService((tx) => tx`delete from wb.booking_photos where id = any(${rows.map((r) => r.id)}::uuid[])`);
  return rows.length;
}

export async function runJobs(now = new Date()): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (err) {
      console.error(`job ${name} failed`, err);
      out[name] = `failed: ${(err as Error).message}`;
    }
  };
  await step('reminders', () => runReminders(now));
  await step('retried', () => retryFailed());
  await step('cleanup', async () => (await asService((tx) => tx`select wb.cleanup() as r`))[0]?.r);
  await step('orphanPhotos', () => removeOrphanPhotos());
  await step('slots', () => asService((tx) => tx`select wb.refresh_slots()`).then(() => 'refreshed'));
  await step('calendar', () => syncCalendar(now));
  return out;
}
