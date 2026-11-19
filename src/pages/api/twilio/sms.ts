import type { APIRoute } from 'astro';
import { normalizeMobile } from '../../../booking/rules';
import { appEnv, config, read } from '../../../server/env';
import { handleInbound, validTwilioSignature } from '../../../server/messaging/inbound';

export const prerender = false;

const twiml = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });

// Twilio calls this when someone texts our number. Set it as the number's
// (or Messaging Service's) incoming message webhook: https://<site>/api/twilio/sms
export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;

  const token = read('TWILIO_AUTH_TOKEN');
  if (token) {
    const url = `${config.siteUrl()}/api/twilio/sms`;
    if (!validTwilioSignature(token, url, params, request.headers.get('x-twilio-signature') ?? '')) {
      return new Response('Forbidden', { status: 403 });
    }
  } else if (appEnv() !== 'test' && appEnv() !== 'development') {
    return new Response('Forbidden', { status: 403 });
  }

  const from = normalizeMobile(params.From ?? '');
  if (!from) return twiml();
  try {
    await handleInbound({
      from,
      to: params.To ?? '',
      body: params.Body ?? '',
      sid: params.MessageSid ?? params.SmsSid ?? '',
      optOutType: params.OptOutType,
    });
  } catch (err) {
    console.error('inbound text failed', err);
  }
  return twiml();
};
