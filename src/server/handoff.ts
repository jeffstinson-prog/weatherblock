// A ping to the person something was just handed to: a task, a customer or an
// inspection. Nobody gets pinged for what they hand themselves.
import type { Owner } from './auth';
import { asOwner } from './db';
import { pushToOwners } from './push';

export async function tellAssignee(
  owner: Owner,
  assignee: string | null | undefined,
  what: { title: string; body: string; url: string; tag: string },
): Promise<void> {
  if (!assignee || assignee === owner.userId) return;
  const [me] = await asOwner(owner.userId, (tx) => tx`select name from wb.owners where user_id = ${owner.userId}`);
  const first = String(me?.name ?? '').split(' ')[0] || 'Someone';
  await pushToOwners({ title: `${first} ${what.title}`, body: what.body, url: what.url, tag: what.tag }, assignee);
}
