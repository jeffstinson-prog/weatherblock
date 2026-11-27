// Tasks: who does what, by when. The owners add their own, and the system adds
// the routine ones (call back, write the estimate, schedule the job, answer a
// question, close out) and closes them when the work is done (database triggers).
import { z } from 'zod';
import type { Owner } from './auth';
import { asOwner } from './db';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; message: string };
const fail = (status: number, message: string) => ({ ok: false as const, status, message });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function taskRow(t: Record<string, unknown>) {
  return {
    id: t.id as string,
    title: t.title as string,
    notes: (t.notes as string | null) ?? '',
    dueOn: (t.due_on as string | null) ?? null,
    assignee: (t.assignee as string | null) ?? null,
    assigneeName: (t.assignee_name as string | null) ?? '',
    mobile: (t.mobile as string | null) ?? null,
    customerName: (t.customer_name as string | null) ?? '',
    bookingId: (t.booking_id as string | null) ?? null,
    requestId: (t.request_id as string | null) ?? null,
    status: t.status as 'open' | 'done',
    auto: Boolean(t.auto_key),
    doneAt: t.done_at ? new Date(t.done_at as string).toISOString() : null,
    doneByName: (t.done_by_name as string | null) ?? '',
    createdAt: new Date(t.created_at as string).toISOString(),
  };
}

export type TaskRow = ReturnType<typeof taskRow>;

/** Open tasks (everyone's), or the last 60 done. */
export async function listTasks(owner: Owner, which: 'open' | 'done' = 'open') {
  return asOwner(owner.userId, async (tx) => {
    const rows = await tx`
      select t.*, to_char(t.due_on, 'YYYY-MM-DD') as due_on, a.name as assignee_name, d.name as done_by_name,
        coalesce(
          (select b.name from wb.bookings b where b.mobile = t.mobile order by b.created_at desc limit 1),
          (select r.name from wb.estimate_requests r where r.mobile = t.mobile order by r.created_at desc limit 1)
        ) as customer_name
      from wb.tasks t
      left join wb.owners a on a.user_id = t.assignee
      left join wb.owners d on d.user_id = t.done_by
      where t.status = ${which}
      order by ${which === 'open' ? tx`t.due_on nulls last, t.created_at` : tx`t.done_at desc`}
      limit ${which === 'open' ? 500 : 60}`;
    const owners = await tx`select user_id, name from wb.owners where active order by created_at`;
    return { tasks: rows.map(taskRow), owners: owners.map((o) => ({ id: o.user_id as string, name: o.name as string })), me: owner.userId };
  });
}

const TaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().default(''),
  dueOn: z.string().regex(DATE).nullable().optional(),
  assignee: z.uuid().nullable().optional(),
  mobile: z
    .string()
    .regex(/^\+1[2-9]\d{9}$/)
    .nullable()
    .optional(),
});

export async function createTask(owner: Owner, input: unknown): Promise<Result<{ id: string }>> {
  const p = TaskInput.safeParse(input);
  if (!p.success) return fail(400, 'Give the task a title (and a real date, if any).');
  const v = p.data;
  const [r] = await asOwner(
    owner.userId,
    (tx) => tx`
      insert into wb.tasks (title, notes, due_on, assignee, mobile, created_by)
      values (${v.title}, ${v.notes || null}, ${v.dueOn ?? null}, ${v.assignee ?? null}, ${v.mobile ?? null}, ${owner.userId})
      returning id`,
  );
  return { ok: true, id: r!.id as string };
}

const TaskUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  dueOn: z.string().regex(DATE).nullable().optional(),
  assignee: z.uuid().nullable().optional(),
  status: z.enum(['open', 'done']).optional(),
});

export async function updateTask(owner: Owner, id: string, input: unknown): Promise<Result> {
  const p = TaskUpdate.safeParse(input);
  if (!p.success) return fail(400, 'Check the task and try again.');
  const v = p.data;
  const found = await asOwner(owner.userId, async (tx) => {
    const [t] = await tx`select id from wb.tasks where id = ${id}`;
    if (!t) return false;
    if (v.title !== undefined) await tx`update wb.tasks set title = ${v.title} where id = ${id}`;
    if (v.notes !== undefined) await tx`update wb.tasks set notes = ${v.notes || null} where id = ${id}`;
    if (v.dueOn !== undefined) await tx`update wb.tasks set due_on = ${v.dueOn} where id = ${id}`;
    if (v.assignee !== undefined) await tx`update wb.tasks set assignee = ${v.assignee} where id = ${id}`;
    if (v.status === 'done') await tx`update wb.tasks set status = 'done', done_at = now(), done_by = ${owner.userId} where id = ${id} and status = 'open'`;
    if (v.status === 'open') await tx`update wb.tasks set status = 'open', done_at = null, done_by = null where id = ${id}`;
    return true;
  });
  return found ? { ok: true } : fail(404, 'That task is gone.');
}

export async function deleteTask(owner: Owner, id: string): Promise<Result> {
  await asOwner(owner.userId, (tx) => tx`delete from wb.tasks where id = ${id}`);
  return { ok: true };
}
