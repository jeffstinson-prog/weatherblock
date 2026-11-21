import type { APIRoute } from 'astro';
import { cancelByToken, getByToken, rescheduleByToken } from '../../server/booking';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../server/http';
import { bookingChanged } from '../../server/notify';
import { looksLikeToken } from '../../server/tokens';

export const prerender = false;

// The customer's secret link: view, reschedule, cancel. The token travels in
// the request body, never in a URL.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Use the link we sent you.' });
  try {
    if (!(await rateOk('manage', clientAddress, 40, 3600))) return tooMany();
    const body = (await readJson(request)) as { token?: unknown; action?: unknown; slotId?: unknown; reason?: unknown };
    if (!looksLikeToken(body.token)) {
      return json(404, { error: 'not_found', message: 'That link looks incomplete. Open it again from your text or email.' });
    }
    let result;
    if (body.action === 'get') {
      result = await getByToken(body.token);
    } else if (body.action === 'reschedule' && typeof body.slotId === 'string' && /^[0-9a-f-]{36}$/.test(body.slotId)) {
      result = await rescheduleByToken(body.token, body.slotId);
      if (result.ok) await bookingChanged(result.booking, 'rescheduled').catch((e) => console.error('notify failed', e));
    } else if (body.action === 'cancel') {
      result = await cancelByToken(body.token, typeof body.reason === 'string' ? body.reason : '');
      if (result.ok) await bookingChanged(result.booking, 'cancelled').catch((e) => console.error('notify failed', e));
    } else {
      return json(400, { error: 'bad_request', message: 'Something was missing. Try again.' });
    }
    if (!result.ok) {
      const { ok: _ok, status, ...rest } = result;
      return json(status, rest);
    }
    const { id: _id, ...booking } = result.booking;
    return json(200, { booking });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('manage failed', err);
    return serverError();
  }
};
