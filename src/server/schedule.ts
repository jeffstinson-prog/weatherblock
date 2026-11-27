// The schedule: inspections and roof jobs, day by day, with who does each one.
// Owners assign the inspector for a visit here; jobs go on a crew's day.
import { z } from 'zod';
import { TZ, whenLabel } from '../booking/format';
import { labelOf, REASONS } from '../booking/rules';
import type { Owner } from './auth';
import { asOwner } from './db';
import { tellAssignee } from './handoff';
import { crewRow } from './pipeline';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; message: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown) => new Date(v as string).toISOString();

export async function schedule(owner: Owner, from: string, days = 7) {
  const span = Math.min(Math.max(days, 1), 31);
  return asOwner(owner.userId, async (tx) => {
    const visits = await tx`
      select l.id, l.ref, l.status, l.starts_at, l.ends_at, l.name, l.mobile, l.address, l.reason, l.someone_home, b.assigned_to
      from wb.booking_list l join wb.bookings b on b.id = l.id
      where l.status <> 'cancelled'
        and (l.starts_at at time zone ${TZ})::date between ${from}::date and ${from}::date + ${span - 1}::int
      order by l.starts_at, l.created_at`;
    const jobs = await tx`
      select j.booking_id, j.crew_id, to_char(j.day, 'YYYY-MM-DD') as day, j.status, l.name, l.mobile, l.address
      from wb.jobs j join wb.booking_list l on l.id = j.booking_id
      where j.status in ('scheduled', 'done') and j.day between ${from}::date and ${from}::date + ${span - 1}::int
      order by j.day, l.name`;
    const toSchedule = await tx`
      select l.id, l.name, l.mobile, l.address from wb.jobs j join wb.booking_list l on l.id = j.booking_id
      where j.status = 'to_schedule' order by j.created_at`;
    const crews = await tx`select * from wb.crews order by sort, created_at`;
    const owners = await tx`select user_id, name from wb.owners where active order by created_at`;
    const off = await tx`
      select to_char(day, 'YYYY-MM-DD') as day, coalesce(note, '') as note from wb.days_off
      where day between ${from}::date and ${from}::date + ${span - 1}::int`;
    const busy = await tx`
      select starts_at, ends_at from wb.calendar_busy
      where ends_at > (${from}::date)::timestamp at time zone ${TZ}
        and starts_at < (${from}::date + ${span}::int)::timestamp at time zone ${TZ}
      order by starts_at`;
    return {
      from,
      days: span,
      visits: visits.map((v) => ({
        id: v.id as string,
        ref: v.ref as string,
        status: v.status as string,
        startsAt: iso(v.starts_at),
        endsAt: iso(v.ends_at),
        name: v.name as string,
        mobile: v.mobile as string,
        address: v.address as string,
        reason: labelOf(REASONS, v.reason as string),
        assignedTo: (v.assigned_to as string | null) ?? null,
      })),
      jobs: jobs.map((j) => ({
        bookingId: j.booking_id as string,
        crewId: j.crew_id as string,
        day: j.day as string,
        status: j.status as string,
        name: j.name as string,
        mobile: j.mobile as string,
        address: j.address as string,
      })),
      toSchedule: toSchedule.map((r) => ({ id: r.id as string, name: r.name as string, mobile: r.mobile as string, address: r.address as string })),
      crews: crews.map(crewRow),
      owners: owners.map((o) => ({ id: o.user_id as string, name: o.name as string })),
      daysOff: off.map((o) => ({ day: o.day as string, note: o.note as string })),
      busy: busy.map((b) => ({ startsAt: iso(b.starts_at), endsAt: iso(b.ends_at) })),
    };
  });
}

export const validDate = (d: string | null) => (d && DATE.test(d) ? d : null);

/** Who does this inspection. Null takes it off everyone. */
export async function assignInspector(owner: Owner, bookingId: string, userId: unknown): Promise<Result> {
  const p = z.uuid().nullable().safeParse(userId ?? null);
  if (!p.success) return { ok: false, status: 400, message: 'Pick someone from the list.' };
  const done = await asOwner(owner.userId, async (tx) => {
    const [before] = await tx`select assigned_to from wb.bookings where id = ${bookingId}`;
    const [b] = await tx`update wb.bookings set assigned_to = ${p.data} where id = ${bookingId} returning id`;
    if (!b) return null;
    await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
             values (${bookingId}, 'owner', 'assigned', ${tx.json({ to: p.data })})`;
    const [v] = await tx`select name, status, starts_at, ends_at from wb.booking_list where id = ${bookingId}`;
    return { changed: before?.assigned_to !== p.data, v };
  });
  if (!done) return { ok: false, status: 404, message: 'Booking not found.' };
  if (done.changed && done.v && done.v.status === 'booked' && +new Date(done.v.ends_at as string) > Date.now()) {
    await tellAssignee(owner, p.data, {
      title: 'put you on an inspection',
      body: `${done.v.name as string}, ${whenLabel(iso(done.v.starts_at), iso(done.v.ends_at))}.`,
      url: `/app/#/booking/${bookingId}`,
      tag: `assign-${bookingId}`,
    });
  }
  return { ok: true };
}
