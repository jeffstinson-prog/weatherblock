import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json } from '../../server/http';
import { read } from '../../server/env';
import { runJobs } from '../../server/jobs';

export const prerender = false;

// Called by the scheduled function with a shared secret. Nothing else gets in.
export const POST: APIRoute = async ({ request }) => {
  const secret = read('CRON_SECRET');
  const given = request.headers.get('x-cron-secret') ?? '';
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return json(404, { error: 'not_found' });
  }
  return json(200, await runJobs());
};
