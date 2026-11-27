import type { APIRoute } from 'astro';
import { TZ } from '../../../booking/format';
import { NotAnOwner, ownerFrom, type Owner } from '../../../server/auth';
import { openSlots } from '../../../server/booking';
import { BadRequest, json, readJson, serverError } from '../../../server/http';
import * as o from '../../../server/owner';
import * as p from '../../../server/pipeline';
import * as q from '../../../server/requests';
import { home } from '../../../server/home';
import * as crm from '../../../server/crm';
import * as sched from '../../../server/schedule';
import * as tasks from '../../../server/tasks';
import * as team from '../../../server/team';
import * as push from '../../../server/push';

export const prerender = false;

const UUID = /^[0-9a-f-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function result(r: (o.ActionResult | p.Result | q.ActionResult | push.PushResult | crm.Result | tasks.Result | sched.Result) & Record<string, unknown>) {
  return r.ok ? json(200, r) : json(r.status, { error: (r.code as string | undefined) ?? 'failed', message: r.message });
}

async function route(owner: Owner, method: string, path: string[], url: URL, request: Request): Promise<Response> {
  const [head, id] = path;
  const body = method === 'POST' ? ((await readJson(request, 64_000)) as Record<string, unknown>) : {};

  if (method === 'GET' && head === 'day') {
    const date = url.searchParams.get('date') ?? today();
    if (!DATE.test(date)) return json(400, { error: 'bad_date', message: 'Pick a date.' });
    return json(200, { date, bookings: await o.day(owner, date) });
  }
  if (method === 'GET' && head === 'home') return json(200, await home(owner));
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
      // After the inspection: the estimate and the roof job.
      case 'estimate_save':
        return result(await p.saveEstimate(owner, id, body.estimate));
      case 'estimate_upload':
        return result(await p.estimateUpload(owner, id));
      case 'estimate':
        return result(await p.estimateAction(owner, id, body.estimateAction));
      case 'job_schedule':
        return result(await p.scheduleJob(owner, id, body.job));
      case 'job_status':
        return result(await p.setJobStatus(owner, id, body.status));
      case 'assign':
        return result(await sched.assignInspector(owner, id, body.userId));
      // Photos from the visit, and which ones the customer sees.
      case 'photo_add':
        return result(await o.teamPhotoUpload(owner, id, body.contentType, body.bytes));
      case 'photo_set':
        return result(await o.setPhoto(owner, id, body.photoId, { shared: body.shared, caption: body.caption }));
      case 'photo_remove':
        return result(await o.removeTeamPhoto(owner, id, body.photoId));
    }
  }

  // Customers: one per mobile number, with their tasks, notes and history.
  if (method === 'GET' && head === 'customers') return json(200, await crm.customers(owner));
  if (head === 'customer' && id && /^\+?\d{10,11}$/.test(id)) {
    if (method === 'GET') {
      const c = await crm.customer(owner, id);
      return c ? json(200, c) : json(404, { error: 'not_found', message: 'Customer not found.' });
    }
    switch (body.action) {
      case 'profile':
        return result(await crm.saveProfile(owner, id, body.profile));
      case 'note':
        return result(await crm.addNote(owner, id, body.note));
      case 'email':
        return result(await crm.emailCustomer(owner, id, body.email));
    }
  }
  if (head === 'lead' && method === 'POST') return result(await crm.createLead(owner, body.lead));

  // Tasks.
  if (method === 'GET' && head === 'people') return json(200, await tasks.people(owner));
  if (method === 'GET' && head === 'tasks') return json(200, await tasks.listTasks(owner, url.searchParams.get('which') === 'done' ? 'done' : 'open'));
  if (head === 'task' && method === 'POST') {
    if (!id) return result(await tasks.createTask(owner, body.task));
    if (UUID.test(id)) return result(body.action === 'delete' ? await tasks.deleteTask(owner, id) : await tasks.updateTask(owner, id, body.task));
  }

  // Schedule, team and reports.
  if (method === 'GET' && head === 'schedule') {
    const from = sched.validDate(url.searchParams.get('from')) ?? today();
    return json(200, await sched.schedule(owner, from, Number(url.searchParams.get('days') ?? 7) || 7));
  }
  if (method === 'GET' && head === 'team') return json(200, await team.team(owner));
  if (method === 'GET' && head === 'reports') return json(200, await team.reports(owner, Number(url.searchParams.get('days') ?? 90) || 90));

  // Estimate requests: people to call.
  if (method === 'GET' && head === 'requests') return json(200, await q.listRequests(owner));
  if (head === 'request' && id && UUID.test(id)) {
    if (method === 'GET') {
      const d = await q.requestDetail(owner, id);
      return d ? json(200, d) : json(404, { error: 'not_found', message: 'Request not found.' });
    }
    switch (body.action) {
      case 'status':
        return result(await q.setRequestStatus(owner, id, body.status, body.reason));
      case 'notes':
        return result(await q.setRequestNotes(owner, id, body.notes));
      case 'measure':
        return result(await q.remeasureRequest(owner, id));
    }
  }

  if (method === 'GET' && head === 'pipeline') return json(200, await p.pipeline(owner));
  if (head === 'jobs') {
    if (method === 'GET') return json(200, await p.jobsCalendar(owner, url.searchParams.get('from') ?? today()));
    if (method === 'POST' && id === 'move-day') return result(await p.moveDay(owner, body));
  }
  if (head === 'crews') {
    if (method === 'GET') return json(200, { crews: await p.listCrews(owner) });
    return result(await p.saveCrews(owner, body.crews));
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

  if (head === 'questions' && method === 'GET') return json(200, { questions: await o.questions(owner) });

  // Phone notifications: this owner's phones.
  if (head === 'push') {
    if (method === 'GET') return json(200, { publicKey: await push.pushPublicKey(), devices: await push.myDevices(owner) });
    switch (body.action) {
      case 'subscribe':
        return result(await push.subscribe(owner, body.subscription, body.device));
      case 'unsubscribe':
        return result(await push.unsubscribe(owner, body.endpoint));
      case 'test':
        return result(await push.testPush(owner));
    }
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
