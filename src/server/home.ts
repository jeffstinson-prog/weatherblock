// The owner app's home screen in one trip: who to call, today's stops, the
// week ahead and the money in play. One request, so it opens fast on a phone.
import { TZ } from '../booking/format';
import type { Owner } from './auth';
import { asOwner } from './db';
import { row as bookingRow } from './owner';
import { asRoofSheet, roofSummary } from './roofsheet';

const iso = (v: unknown) => new Date(v as string).toISOString();

/** Today's date where the business is, as YYYY-MM-DD. */
export const localToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export async function home(owner: Owner, now = new Date()) {
  const today = localToday(now);
  return asOwner(owner.userId, async (tx) => {
    const [me] = await tx`select name from wb.owners where user_id = ${owner.userId}`;
    const toCall = await tx`
      select id, ref, name, mobile, address, created_at, roof, lead_source
      from wb.estimate_requests where status = 'new' order by created_at limit 50`;
    const [called] = await tx`select count(*)::int as n from wb.estimate_requests where status = 'called'`;
    const visits = await tx`
      select * from wb.booking_list
      where status <> 'cancelled'
        and (starts_at at time zone ${TZ})::date between ${today}::date and ${today}::date + 6
      order by starts_at, created_at`;
    const [money] = await tx`
      select
        count(*) filter (where e.status = 'sent')::int as out_count,
        coalesce(sum(e.amount_cents) filter (where e.status = 'sent'), 0)::bigint as out_cents,
        count(*) filter (where e.status = 'accepted' and e.decided_at >= date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ})::int as won_count,
        coalesce(sum(e.amount_cents) filter (where e.status = 'accepted' and e.decided_at >= date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ}), 0)::bigint as won_cents
      from wb.estimates e`;
    const [toWrite] = await tx`
      select count(*)::int as n from wb.booking_list l left join wb.estimates e on e.booking_id = l.id
      where l.status = 'done' and (e.id is null or e.status = 'draft')`;
    // Tasks due today or late: mine, and anyone's that nobody has taken. Call-backs
    // are left out because "Call now" already shows them.
    const tasks = await tx`
      select t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') as due_on, t.mobile, t.assignee, t.auto_key is not null as auto,
        coalesce(
          (select b.name from wb.bookings b where b.mobile = t.mobile order by b.created_at desc limit 1),
          (select r.name from wb.estimate_requests r where r.mobile = t.mobile order by r.created_at desc limit 1)
        ) as customer_name
      from wb.tasks t
      where t.status = 'open' and (t.assignee = ${owner.userId} or t.assignee is null)
        and t.due_on <= ${today}::date and coalesce(t.auto_key, '') not like 'call:%'
      order by t.due_on, t.created_at limit 8`;
    const [counts] = await tx`
      select count(*) filter (where assignee = ${owner.userId})::int as mine,
             count(*) filter (where assignee = ${owner.userId} and due_on < ${today}::date)::int as late,
             count(*) filter (where assignee is null)::int as unassigned
      from wb.tasks where status = 'open'`;
    return {
      today,
      name: (me?.name as string | undefined) ?? '',
      me: owner.userId,
      tasks: tasks.map((t) => ({
        id: t.id as string,
        title: t.title as string,
        dueOn: t.due_on as string,
        mobile: (t.mobile as string | null) ?? null,
        mine: t.assignee === owner.userId,
        auto: Boolean(t.auto),
        customerName: (t.customer_name as string | null) ?? '',
      })),
      taskCounts: { mine: Number(counts?.mine ?? 0), late: Number(counts?.late ?? 0), unassigned: Number(counts?.unassigned ?? 0) },
      toCall: toCall.map((r) => ({
        id: r.id as string,
        ref: r.ref as string,
        name: r.name as string,
        mobile: r.mobile as string,
        address: r.address as string,
        createdAt: iso(r.created_at),
        roof: roofSummary(asRoofSheet(r.roof)),
        leadSource: r.lead_source as string,
      })),
      calledCount: Number(called?.n ?? 0),
      visits: visits.map(bookingRow),
      estimates: {
        out: { count: Number(money?.out_count ?? 0), cents: Number(money?.out_cents ?? 0) },
        wonThisMonth: { count: Number(money?.won_count ?? 0), cents: Number(money?.won_cents ?? 0) },
        toWrite: Number(toWrite?.n ?? 0),
      },
    };
  });
}

export type Home = Awaited<ReturnType<typeof home>>;
