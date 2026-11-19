import type { APIRoute } from 'astro';
import { TZ } from '../../../booking/format';
import { NotAnOwner, ownerFrom, type Owner } from '../../../server/auth';
import { openSlots } from '../../../server/booking';
import { BadRequest, json, readJson, serverError } from '../../../server/http';
import * as o from '../../../server/owner';

export const prerender = false;

const UUID = /^[0-9a-f-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function result(r: o.ActionResult & Record<string, unknown>) {
  return r.ok ? json(200, r) : json(r.status, { error: 'failed', message: r.message });
}

async function route(owner: Owner, method: string, path: string[], url: URL, request: Request): Promise<Response> {
  const [head, id] = path;
  const body = method === 'POST' ? ((await readJson(request, 64_000)) as Record<string, unknown>) : {};

  if (method === 'GET' && head === 'day') {
    const date = url.searchParams.get('date') ?? today();
    if (!DATE.test(date)) return json(400, { error: 'bad_date', message: 'Pick a date.' });
    return json(200, { date, bookings: await o.day(owner, date) });
  }
  if (method === 'GET' && head === 'upcoming') return json(200, await o.upcoming(owner));
  if (method === 'GET' && head === 'slots') return json(200, { slots: await openSlots() });

  if (head === 'booking' && id && UUID.test(id)) {
    if (method === 'GET') {
      const d = await o.detail(owner, id);
      return d ? json(200, d) : json(404, { error: 'not_found', message: 'Booking not found.' });
    }
    const tell = body.tellCustomer !== false;
    switch (body.action) {
      case 'status':
        return result(await o.setStatus(owner, id, body.status, tell));
      case 'notes':
        return result(await o.setNotes(owner, id, body.notes));
      case 'reschedule':
        return result(await o.reschedule(owner, id, body.slotId, tell));
      case 'on_my_way':
        return result(await o.sendOnMyWay(owner, id, body.minutes));
    }
  }

  if (head === 'availability') {
    if (method === 'GET') return json(200, await o.getAvailability(owner));
    return result(await o.saveAvailability(owner, body));
  }
  if (head === 'days-off' && method === 'POST') {
    return result(body.action === 'remove' ? await o.removeDayOff(owner, body.day) : await o.addDayOff(owner, body.day, body.note));
  }
  if (head === 'calendar' && id === 'sync' && method === 'POST') return json(200, await o.syncNow(owner));

  if (head === 'referrers') {
    if (method === 'GET') return json(200, { referrers: await o.listReferrers(owner) });
    return result(await o.saveReferrer(owner, body));
  }

  if (head === 'export' && method === 'GET') {
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!DATE.test(from) || !DATE.test(to)) return json(400, { error: 'bad_date', message: 'Pick both dates.' });
    return new Response(await o.exportCsv(owner, from, to), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bookings-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (head === 'me') {
    if (method === 'GET') return json(200, await o.me(owner));
    return result(await o.saveMe(owner, body));
  }

  return json(404, { error: 'not_found', message: 'Not found.' });
}

export const ALL: APIRoute = async ({ request, params, url }) => {
  let owner: Owner | null;
  try {
    owner = await ownerFrom(request);
  } catch (err) {
    if (err instanceof NotAnOwner) {
      return json(403, { error: 'not_owner', message: "This account isn't set up as an owner." });
    }
    console.error('owner auth failed', err);
    return serverError();
  }
  if (!owner) return json(401, { error: 'signed_out', message: 'Sign in again.' });
  try {
    return await route(owner, request.method, (params.path ?? '').split('/').filter(Boolean), url, request);
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    console.error('owner request failed', err);
    return serverError();
  }
};
