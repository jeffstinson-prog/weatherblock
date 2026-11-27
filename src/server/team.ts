// The team: the owners (who's on what this week) and the crews, and the numbers
// that say how the business is doing.
import { TZ } from '../booking/format';
import type { Owner } from './auth';
import { asOwner } from './db';
import { crewRow } from './pipeline';

export async function team(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const people = await tx`
      select o.user_id, o.name, o.email, coalesce(o.mobile, '') as mobile, o.active,
        (select count(*)::int from wb.tasks t where t.assignee = o.user_id and t.status = 'open') as open_tasks,
        (select count(*)::int from wb.tasks t where t.assignee = o.user_id and t.status = 'open' and t.due_on < (now() at time zone ${TZ})::date) as overdue,
        (select count(*)::int from wb.booking_list l join wb.bookings b on b.id = l.id
           where b.assigned_to = o.user_id and l.status = 'booked' and l.starts_at > now() and l.starts_at < now() + interval '7 days') as visits_week,
        (select count(*)::int from wb.customer_profiles p where p.assigned_to = o.user_id and not p.lost) as customers
      from wb.owners o order by o.created_at`;
    const crews = await tx`
      select c.*,
        (select count(*)::int from wb.jobs j where j.crew_id = c.id and j.status = 'scheduled'
           and j.day between (now() at time zone ${TZ})::date and (now() at time zone ${TZ})::date + 6) as jobs_week
      from wb.crews c order by c.sort, c.created_at`;
    const [unassigned] = await tx`
      select
        (select count(*)::int from wb.tasks where status = 'open' and assignee is null) as tasks,
        (select count(*)::int from wb.booking_list l join wb.bookings b on b.id = l.id
           where b.assigned_to is null and l.status = 'booked' and l.starts_at > now() and l.starts_at < now() + interval '7 days') as visits`;
    return {
      me: owner.userId,
      people: people.map((p) => ({
        id: p.user_id as string,
        name: p.name as string,
        email: p.email as string,
        mobile: p.mobile as string,
        active: Boolean(p.active),
        openTasks: Number(p.open_tasks),
        overdue: Number(p.overdue),
        visitsThisWeek: Number(p.visits_week),
        customers: Number(p.customers),
      })),
      crews: crews.map((c) => ({ ...crewRow(c), jobsThisWeek: Number(c.jobs_week) })),
      unassigned: { tasks: Number(unassigned?.tasks ?? 0), visits: Number(unassigned?.visits ?? 0) },
    };
  });
}

// ---------- Reports ----------

/**
 * How the last 90 days went: leads by where they came from, how far they got,
 * money won by month, money still out, and how fast the first call happened.
 * "How far they got" counts what happened, so a customer lost after the
 * estimate still counts as inspected and sent.
 */
export async function reports(owner: Owner, days = 90) {
  return asOwner(owner.userId, async (tx) => {
    const span = Math.min(Math.max(days, 7), 730);
    const rows = await tx`
      with contacts as (
        select mobile, created_at, lead_source from wb.estimate_requests
        union all select mobile, created_at, lead_source from wb.bookings
      ),
      firsts as (
        select distinct on (mobile) mobile, created_at as first_at, lead_source
        from contacts order by mobile, created_at
      ),
      reach as (
        select b.mobile,
          bool_or(true) as booked,
          bool_or(b.status = 'done') as inspected,
          bool_or(e.sent_at is not null) as sent,
          bool_or(e.status = 'accepted') as won,
          coalesce(sum(e.amount_cents) filter (where e.status = 'accepted'), 0)::bigint as won_cents
        from wb.bookings b left join wb.estimates e on e.booking_id = b.id
        group by b.mobile
      )
      select f.mobile, f.lead_source, coalesce(r.booked, false) as booked, coalesce(r.inspected, false) as inspected,
             coalesce(r.sent, false) as sent, coalesce(r.won, false) as won, coalesce(r.won_cents, 0)::bigint as won_cents
      from firsts f left join reach r on r.mobile = f.mobile
      where f.first_at > now() - make_interval(days => ${span})`;
    const won = await tx`
      select to_char(date_trunc('month', e.decided_at at time zone ${TZ}), 'YYYY-MM') as month,
             count(*)::int as n, coalesce(sum(e.amount_cents), 0)::bigint as cents
      from wb.estimates e
      where e.status = 'accepted' and e.decided_at > now() - interval '6 months'
      group by 1 order by 1`;
    const [pipe] = await tx`select count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as cents from wb.estimates where status = 'sent'`;
    const [speed] = await tx`
      select count(*)::int as n,
             percentile_cont(0.5) within group (order by extract(epoch from (called_at - created_at)) / 60) as median
      from wb.estimate_requests
      where called_at is not null and called_at >= created_at and created_at > now() - make_interval(days => ${span})`;
    const sources = new Map<string, { source: string; leads: number; booked: number; won: number; wonCents: number }>();
    for (const r of rows) {
      const key = (r.lead_source as string) || 'direct';
      const s = sources.get(key) ?? { source: key, leads: 0, booked: 0, won: 0, wonCents: 0 };
      s.leads++;
      if (r.booked) s.booked++;
      if (r.won) {
        s.won++;
        s.wonCents += Number(r.won_cents);
      }
      sources.set(key, s);
    }
    const count = (k: string) => rows.filter((r) => r[k]).length;
    return {
      days: span,
      leads: rows.length,
      funnel: [
        { step: 'Leads', n: rows.length },
        { step: 'Booked an inspection', n: count('booked') },
        { step: 'Inspected', n: count('inspected') },
        { step: 'Estimate sent', n: count('sent') },
        { step: 'Won', n: count('won') },
      ],
      sources: [...sources.values()].sort((a, b) => b.leads - a.leads),
      wonByMonth: won.map((w) => ({ month: w.month as string, count: Number(w.n), cents: Number(w.cents) })),
      pipeline: { count: Number(pipe?.n ?? 0), cents: Number(pipe?.cents ?? 0) },
      medianMinutesToCall: speed?.median === null || speed?.median === undefined ? null : Math.round(Number(speed.median)),
      calls: Number(speed?.n ?? 0),
    };
  });
}
