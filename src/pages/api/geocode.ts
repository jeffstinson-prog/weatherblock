import type { APIRoute } from 'astro';
import { geocode } from '../../server/geocode';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../server/http';

export const prerender = false;

// The instant estimate's address lookup. Nothing is stored.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Use the estimate page on our website.' });
  try {
    if (!(await rateOk('geocode', clientAddress, 30, 3600))) return tooMany();
    const body = (await readJson(request, 4_000)) as { address?: unknown };
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    if (address.length < 5 || address.length > 200) {
      return json(400, { error: 'bad_request', message: 'Enter the street address, town and ZIP code.' });
    }
    return json(200, { matches: await geocode(address) });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('geocode failed', err);
    return json(502, { error: 'lookup_failed', message: "We couldn't look up addresses just now. Enter your house's size instead, or try again in a minute." });
  }
};
