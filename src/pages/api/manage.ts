import type { APIRoute } from 'astro';
import { cancelByToken, customerView, getByToken, rescheduleByToken } from '../../server/booking';
import { customerAnswer, customerEstimateFile } from '../../server/pipeline';
import { portalView, readMessage, sendPortalMessage } from '../../server/portal';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../server/http';
import { bookingChanged } from '../../server/notify';
import { looksLikeToken } from '../../server/tokens';

export const prerender = false;

// The customer's secret link: view, reschedule, cancel, answer the estimate, and
// write to us. The token travels in the request body, never in a URL. Every answer
// carries the whole page (the booking, its photos and messages), minus the booking's id.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Use the link we sent you.' });
  try {
    if (!(await rateOk('manage', clientAddress, 40, 3600))) return tooMany();
    const body = (await readJson(request)) as {
      token?: unknown;
      action?: unknown;
      slotId?: unknown;
      reason?: unknown;
      answer?: unknown;
      note?: unknown;
      body?: unknown;
    };
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
      // The same view as when the page loaded, so the estimate keeps its roof picture after an answer.
      return json(200, { booking: await portalView(customerView(answered.booking as Record<string, unknown>)) });
    } else if (body.action === 'estimate_file') {
      const url = await customerEstimateFile(body.token);
      return url ? json(200, { url }) : json(404, { error: 'not_found', message: 'There is no estimate file to show.' });
    } else if (body.action === 'message') {
      // A message to the team. Checked before it counts against the limit, so a typo costs nothing.
      const read = readMessage(body.body);
      if (!read.ok) return json(read.status, { error: read.error, message: read.message });
      if (!(await rateOk('portal_message', clientAddress, 10, 3600))) return tooMany();
      const sent = await sendPortalMessage(body.token, read.text);
      if (!sent.ok) return json(sent.status, { error: sent.error, message: sent.message });
      return json(200, { messages: sent.messages });
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
    return json(200, { booking: await portalView(result.booking) });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('manage failed', err);
    return serverError();
  }
};
