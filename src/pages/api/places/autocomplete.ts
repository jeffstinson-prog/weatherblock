import type { APIRoute } from 'astro';
import { BadRequest, json, rateOk, readJson, sameOrigin, tooMany } from '../../../server/http';
import { autocomplete } from '../../../server/maps';
import { config } from '../../../server/env';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden' });
  try {
    if (!(await rateOk('places', clientAddress, 300, 3600))) return tooMany();
    const body = (await readJson(request, 2000)) as { input?: unknown; sessionToken?: unknown };
    const input = typeof body.input === 'string' ? body.input.slice(0, 200) : '';
    const session = typeof body.sessionToken === 'string' ? body.sessionToken.slice(0, 64) : '';
    const provider = config.googleServerKey() ? 'google' : 'test';
    return json(200, { suggestions: await autocomplete(input, session), provider });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request' });
    console.error('autocomplete failed', err);
    // The page falls back to "use the address I typed".
    return json(503, { error: 'unavailable', suggestions: [] });
  }
};
