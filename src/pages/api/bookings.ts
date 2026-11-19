import type { APIRoute } from 'astro';
import { createBooking } from '../../server/booking';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../server/http';
import { bookingCreated } from '../../server/notify';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Book from our website.' });
  try {
    if (!(await rateOk('booking', clientAddress, 6, 3600))) return tooMany();
    const result = await createBooking(await readJson(request));
    if (!result.ok) {
      const { ok: _ok, status, ...body } = result;
      return json(status, body);
    }
    let notified = { email: false, sms: false };
    if (!result.existing) {
      try {
        notified = await bookingCreated(result.booking, result.manageUrl);
      } catch (err) {
        // The booking is made; a failed message must not undo it. Owners see it in the app.
        console.error('notify failed', err);
      }
    }
    return json(result.existing ? 200 : 201, {
      booking: result.booking,
      token: result.token,
      notified,
    });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('booking failed', err);
    return serverError();
  }
};
