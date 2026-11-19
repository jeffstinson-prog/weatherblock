import type { APIRoute } from 'astro';
import { TIMEZONE, openSlots } from '../../server/booking';
import { json, serverError } from '../../server/http';

export const prerender = false;

// Open inspection windows. Nothing personal in or out, so a plain GET.
export const GET: APIRoute = async () => {
  try {
    return json(200, { timezone: TIMEZONE, slots: await openSlots() });
  } catch (err) {
    console.error('slots failed', err);
    return serverError();
  }
};
