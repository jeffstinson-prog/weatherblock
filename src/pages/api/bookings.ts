import type { APIRoute } from 'astro';
import { createBooking } from '../../server/booking';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../server/http';
import { bookingCreated } from '../../server/notify';
import { attachToBooking } from '../../server/requests';

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
      const a = result.body.address;
      const [told, attached] = await Promise.allSettled([
        bookingCreated(result.booking, result.manageUrl),
        // If this person asked for an estimate first, tie the two together. Either way, measure the roof for the owners.
        // (createBooking has checked the address's signature, so a place ID here means the position can be trusted.)
        attachToBooking({
          id: result.booking.id,
          mobile: result.mobile,
          lat: a.placeId && typeof a.lat === 'number' ? a.lat : null,
          lng: a.placeId && typeof a.lng === 'number' ? a.lng : null,
        }),
      ]);
      // The booking is made; a failed message or measurement must not undo it. Owners see it in the app.
      if (told.status === 'fulfilled') notified = told.value;
      else console.error('notify failed', told.reason);
      if (attached.status === 'rejected') console.error('roof sheet failed', attached.reason);
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
