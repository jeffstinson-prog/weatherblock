import type { APIRoute } from 'astro';
import { BadRequest, json, rateOk, readJson, sameOrigin, tooMany } from '../../server/http';
import { inServiceArea, roofImageUrl, satelliteUrl, verifyPlace, type Place } from '../../server/maps';
import { roofFromSolar } from '../../server/solar';

export const prerender = false;

// The estimate page's picture: the roof at the address someone picked, seen
// from above, so they can say "yes, that's my house". Only the picture leaves
// the server. The roof's size, pitch and any price stay with the owners.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Use the estimate page on our website.' });
  try {
    if (!(await rateOk('estimate', clientAddress, 30, 3600))) return tooMany();
    const body = (await readJson(request, 8_000)) as { place?: Partial<Place> & { sig?: string } };
    const place = body.place;
    if (!place || !verifyPlace(place)) {
      return json(400, { error: 'bad_request', message: 'Pick your address from the list as you type.' });
    }
    if (!inServiceArea(place)) return json(200, { outOfArea: true, picture: null });
    const roof = await roofFromSolar(place.lat, place.lng).catch((err) => {
      console.error('solar lookup failed', err);
      return null;
    });
    // With Google's measurement: a close view with the roof outlined. Without: the plain satellite view.
    return json(200, { outOfArea: false, picture: (roof ? roofImageUrl(roof.box) : null) ?? satelliteUrl(place.lat, place.lng) });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('estimate picture failed', err);
    return json(200, { outOfArea: false, picture: null });
  }
};
