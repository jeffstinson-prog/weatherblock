import type { APIRoute } from 'astro';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../server/http';
import { createRequest, requestForBooking } from '../../server/requests';
import { looksLikeToken } from '../../server/tokens';

export const prerender = false;

// Estimate requests from /estimate/: an address and how to reach the person.
// The owners are told at once. Nothing about the roof's size or price goes
// back to the browser, unless the facts file says to show a ballpark.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Use the estimate page on our website.' });
  try {
    const body = (await readJson(request, 16_000)) as { action?: unknown; token?: unknown };

    // The link from the request's email: what they already told us, for the booking form.
    if (body.action === 'get') {
      if (!(await rateOk('request_get', clientAddress, 40, 3600))) return tooMany();
      const found = looksLikeToken(body.token) ? await requestForBooking(body.token) : null;
      return found
        ? json(200, found)
        : json(404, { error: 'not_found', message: 'That link is old or already used. You can still book below.' });
    }

    if (!(await rateOk('estimate_request', clientAddress, 6, 3600))) return tooMany();
    const result = await createRequest(body);
    if (!result.ok) {
      const { ok: _ok, status, ...rest } = result;
      return json(status, rest);
    }
    const { ok: _ok, existing, ...rest } = result;
    return json(existing ? 200 : 201, rest);
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('estimate request failed', err);
    return serverError();
  }
};
