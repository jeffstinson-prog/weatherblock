import type { Config } from '@netlify/functions';

// Every 15 minutes: reminders, retrying failed messages, clean-up, calendar sync.
// The work itself lives in the site's /api/jobs endpoint, so it shares code and
// tests with everything else. This function only knocks on that door.
export default async () => {
  const site = Netlify.env.get('URL');
  const secret = Netlify.env.get('CRON_SECRET');
  if (!site || !secret) {
    console.error('URL or CRON_SECRET is not set');
    return;
  }
  const res = await fetch(`${site}/api/jobs`, { method: 'POST', headers: { 'x-cron-secret': secret } });
  console.log('jobs', res.status, await res.text());
};

export const config: Config = {
  // UTC. Every 15 minutes all day; the reminder rules decide what's due in Eastern time.
  schedule: '*/15 * * * *',
};
