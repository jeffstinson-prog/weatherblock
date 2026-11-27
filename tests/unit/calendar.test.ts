// The Google Calendar connection, without Google: reading the key from Netlify,
// signing in as the service account, and reading what blocks time.
import { generateKeyPairSync } from 'node:crypto';
import { importSPKI, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const spki = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const email = 'website-calendar@weatherblock-calendar.iam.gserviceaccount.com';
// The key file as Google downloads it: the private key's line breaks written as \n.
const keyFile = JSON.stringify(
  {
    type: 'service_account',
    project_id: 'weatherblock-calendar',
    private_key_id: '0123456789abcdef',
    private_key: pem,
    client_email: email,
    client_id: '100000000000000000000',
    token_uri: 'https://oauth2.googleapis.com/token',
  },
  null,
  2,
);

const load = () => import('../../src/server/calendar');

beforeEach(() => {
  vi.resetModules();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
});

describe('the Google key in Netlify', () => {
  it('takes the whole key file, pasted as is', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyFile;
    const { serviceAccount, serviceAccountEmail } = await load();
    expect(serviceAccount()).toEqual({ email, pem: pem.trim() });
    expect(serviceAccountEmail()).toBe(email);
  });

  it('takes the private key copied from inside the file, quotes and comma included, with the email set apart', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = email;
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = `${JSON.stringify(pem)},`;
    const { serviceAccount } = await load();
    expect(serviceAccount()).toEqual({ email, pem: pem.trim() });
  });

  it("gives up plainly on a key it can't use", async () => {
    const { serviceAccount, calendarApi } = await load();
    expect(serviceAccount()).toBeNull(); // not set
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyFile.slice(0, 200); // cut short
    expect(serviceAccount()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify(pem); // no email anywhere
    expect(serviceAccount()).toBeNull();
    expect(calendarApi()).toBeNull();
  });
});

describe('reading the calendar', () => {
  const calendarId = 'info@weatherblockroofingnc.com';
  const from = new Date('2026-11-25T05:00:00.000Z');
  const to = new Date('2026-12-18T05:00:00.000Z');

  function google(listStatus = 200) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const items = [
      { id: 'dentist', status: 'confirmed', start: { dateTime: '2026-11-30T10:30:00-05:00' }, end: { dateTime: '2026-11-30T11:30:00-05:00' } },
      { id: 'birthday', status: 'confirmed', transparency: 'transparent', start: { date: '2026-12-01' }, end: { date: '2026-12-02' } },
      { id: 'away', status: 'confirmed', start: { date: '2026-12-03' }, end: { date: '2026-12-05' } },
      {
        id: 'declined',
        status: 'confirmed',
        start: { dateTime: '2026-12-07T08:00:00-05:00' },
        end: { dateTime: '2026-12-07T09:00:00-05:00' },
        attendees: [{ email: calendarId, self: true, responseStatus: 'declined' }],
      },
      { id: 'gone', status: 'cancelled', start: { dateTime: '2026-12-08T08:00:00-05:00' }, end: { dateTime: '2026-12-08T09:00:00-05:00' } },
      {
        id: 'ours',
        status: 'confirmed',
        start: { dateTime: '2026-12-09T08:00:00-05:00' },
        end: { dateTime: '2026-12-09T10:00:00-05:00' },
        extendedProperties: { private: { bookingId: '00000000-0000-4000-8000-000000000001' } },
      },
    ];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 });
      }
      if (listStatus !== 200) return new Response('{}', { status: listStatus });
      return new Response(JSON.stringify({ items }), { status: 200 });
    });
    return calls;
  }

  it('signs in as the service account, then lists the events in the time asked', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyFile;
    const calls = google();
    const { calendarApi } = await load();
    const api = calendarApi();
    expect(api).not.toBeNull();
    await api!.list(calendarId, from, to);

    const [token, list] = calls;
    expect(token!.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(token!.init!.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload } = await jwtVerify(form.get('assertion')!, await importSPKI(spki, 'RS256'), {
      issuer: email,
      audience: 'https://oauth2.googleapis.com/token',
    });
    expect(payload.scope).toBe('https://www.googleapis.com/auth/calendar.events');

    const u = new URL(list!.url);
    expect(u.pathname).toBe('/calendar/v3/calendars/info%40weatherblockroofingnc.com/events');
    expect(u.searchParams.get('timeMin')).toBe(from.toISOString());
    expect(u.searchParams.get('timeMax')).toBe(to.toISOString());
    expect(u.searchParams.get('singleEvents')).toBe('true');
    expect((list!.init!.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('busy events block; free ones, declined meetings and cancelled ones do not; all-day events run midnight to midnight', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyFile;
    google();
    const { calendarApi } = await load();
    const events = await calendarApi()!.list(calendarId, from, to);
    const by = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(by.dentist).toMatchObject({ start: '2026-11-30T15:30:00.000Z', end: '2026-11-30T16:30:00.000Z', transparent: false, bookingId: null, cancelled: false });
    expect(by.birthday).toMatchObject({ transparent: true });
    expect(by.away).toMatchObject({ start: '2026-12-03T05:00:00.000Z', end: '2026-12-05T05:00:00.000Z', transparent: false });
    expect(by.declined).toMatchObject({ transparent: true });
    expect(by.gone).toMatchObject({ cancelled: true });
    expect(by.ours).toMatchObject({ bookingId: '00000000-0000-4000-8000-000000000001' });
  });

  it('says what to check when Google says no', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyFile;
    google(404);
    let api = (await load()).calendarApi()!;
    await expect(api.list(calendarId, from, to)).rejects.toThrow(`Google can't find that calendar (404). Check the Calendar ID, and that the calendar is shared with ${email}.`);

    vi.resetModules();
    google(403);
    api = (await load()).calendarApi()!;
    await expect(api.list(calendarId, from, to)).rejects.toThrow(/turned on in the Google Cloud project.*"Make changes to events"/);
  });
});
