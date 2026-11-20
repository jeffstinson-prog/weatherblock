import type { APIRoute } from 'astro';
import { cancelByToken, getByToken, rescheduleByToken, toSummary } from '../../server/booking';
import { customerAnswer, customerEstimateFile } from '../../server/pipeline';
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
    const body = (await readJson(request)) as { token?: unknown; action?: unknown; slotId?: unknown; reason?: unknown; answer?: unknown; note?: unknown };
    if (!looksLikeToken(body.token)) {
      return json(404, { error: 'not_found', message: 'That link looks incomplete. Open it again from your text or email.' });
    }
    let result;
    if (body.action === 'get') {
      result = await getByToken(body.token);
    } else if (body.action === 'reschedule' && typeof body.slotId === 'string' && /^[0-9a-f-]{36}$/.test(body.slotId)) {
      result = await rescheduleByToken(body.token, body.slotId);
      if (result.ok) {
        await bookingChanged(result.booking, 'rescheduled', { previousStartsAt: result.previousStartsAt }).catch((e) =>
          console.error('notify failed', e),
        );
      }
    } else if (body.action === 'answer') {
      // The customer's answer to their estimate: go ahead, a question, or no thanks.
      const answered = await customerAnswer(body.token, body.answer, body.note);
      if (!answered.ok) return json(answered.status, { error: answered.code ?? 'failed', message: answered.message });
      const { id: _id, ...booking } = toSummary(answered.booking as Record<string, unknown>);
      return json(200, { booking });
    } else if (body.action === 'estimate_file') {
      const url = await customerEstimateFile(body.token);
      return url ? json(200, { url }) : json(404, { error: 'not_found', message: 'There is no estimate file to show.' });
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
