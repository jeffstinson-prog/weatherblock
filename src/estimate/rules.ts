// The estimate request's checks, shared by the page and the server so they
// always agree. Every error says how to fix it.
import { MESSAGES, isEmail, normalizeMobile } from '../booking/rules';

export interface RequestDraft {
  address: { text: string; placeId?: string; typed?: boolean };
  contact: { name: string; mobile: string; email: string };
}

export function validateRequest(d: RequestDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.address.text.trim().length < 5) e.address = MESSAGES.addressShort;
  else if (!d.address.placeId && !d.address.typed) e.address = MESSAGES.addressPick;
  if (d.contact.name.trim().length < 1) e.name = MESSAGES.name;
  if (!normalizeMobile(d.contact.mobile)) e.mobile = MESSAGES.mobile;
  // Email is optional here. If it's given, it has to be one.
  if (d.contact.email.trim() && !isEmail(d.contact.email)) e.email = MESSAGES.email;
  return e;
}
