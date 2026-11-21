// Texts and email about bookings. Filled in by the notifications change;
// until then nothing is sent and the confirmation screen doesn't claim it was.
import type { BookingSummary } from './booking';

export interface Notified {
  email: boolean;
  sms: boolean;
}

export async function bookingCreated(_booking: BookingSummary, _manageUrl: string): Promise<Notified> {
  return { email: false, sms: false };
}

export async function bookingChanged(_booking: BookingSummary, _kind: 'rescheduled' | 'cancelled'): Promise<void> {}
