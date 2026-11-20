import type { APIRoute } from 'astro';
import { BadRequest, json, rateOk, readJson, sameOrigin, tooMany } from '../../server/http';
import { inServiceArea, roofImageUrl, verifyPlace, type Place } from '../../server/maps';
import { roofFromSolar } from '../../server/solar';

export const prerender = false;

// The instant estimate: Google's measurement of the roof at an address the
// customer picked from the suggestions. Nothing is stored.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Use the estimate page on our website.' });
  try {
    if (!(await rateOk('estimate', clientAddress, 30, 3600))) return tooMany();
    const body = (await readJson(request, 8_000)) as { place?: Partial<Place> & { sig?: string } };
    const place = body.place;
    if (!place || !verifyPlace(place)) {
      return json(400, { error: 'bad_request', message: 'Pick your address from the list as you type.' });
    }
    if (!inServiceArea(place)) return json(200, { source: 'out_of_area' });
    const roof = await roofFromSolar(place.lat, place.lng).catch((err) => {
      console.error('solar lookup failed', err);
      return null;
    });
    if (!roof) return json(200, { source: 'none' });
    return json(200, { source: 'google', roof, image: roofImageUrl(roof.box) });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('estimate failed', err);
    return json(200, { source: 'none' });
  }
};
