import type { APIRoute } from 'astro';
import { BadRequest, json, rateOk, readJson, sameOrigin, tooMany } from '../../../server/http';
import { details, satelliteUrl } from '../../../server/maps';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden' });
  try {
    if (!(await rateOk('places', clientAddress, 300, 3600))) return tooMany();
    const body = (await readJson(request, 2000)) as { placeId?: unknown; sessionToken?: unknown };
    if (typeof body.placeId !== 'string' || body.placeId.length > 300) throw new BadRequest('placeId');
    const session = typeof body.sessionToken === 'string' ? body.sessionToken.slice(0, 64) : '';
    const place = await details(body.placeId, session);
    if (!place) return json(404, { error: 'not_found', message: 'We couldn\'t find that address. Try typing it again.' });
    return json(200, { place, satellite: satelliteUrl(place.lat, place.lng) });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request' });
    console.error('place details failed', err);
    return json(503, { error: 'unavailable', message: 'Address lookup is down right now. Tap "Use the address I typed".' });
  }
};
