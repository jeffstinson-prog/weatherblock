import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { asPublic, dbErrorCode } from '../../../server/db';
import { BadRequest, json, rateOk, readJson, sameOrigin, serverError, tooMany } from '../../../server/http';
import { createUpload } from '../../../server/storage';

export const prerender = false;

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 10 * 1024 * 1024;

// Ask for a place to upload one photo. The phone then uploads it directly.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden' });
  try {
    if (!(await rateOk('photos', clientAddress, 40, 3600))) return tooMany();
    const body = (await readJson(request, 2000)) as { draftKey?: unknown; contentType?: unknown; bytes?: unknown; action?: unknown; photoId?: unknown };
    if (body.action === 'remove') {
      const ok = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
      if (!ok(body.draftKey) || !ok(body.photoId)) throw new BadRequest('ids');
      await asPublic((tx) => tx`select wb_api.remove_draft_photo(${body.draftKey as string}, ${body.photoId as string})`);
      return json(200, { removed: true });
    }
    const type = typeof body.contentType === 'string' ? body.contentType : '';
    const bytes = typeof body.bytes === 'number' ? Math.floor(body.bytes) : 0;
    if (typeof body.draftKey !== 'string' || !/^[0-9a-f-]{36}$/.test(body.draftKey)) throw new BadRequest('draftKey');
    if (!TYPES[type]) return json(415, { error: 'type', message: 'Add a JPG, PNG or WebP photo.' });
    if (bytes < 1 || bytes > MAX_BYTES) return json(413, { error: 'size', message: 'That photo is too big. Try a smaller one.' });
    const id = randomUUID();
    const path = `uploads/${id}.${TYPES[type]}`;
    const photoId = await asPublic(async (tx) => {
      const [r] = await tx`select wb_api.register_photo(${body.draftKey as string}, ${path}, ${type}, ${bytes}) as id`;
      return String(r!.id);
    });
    return json(200, { photoId, upload: await createUpload(path, type) });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request' });
    if (dbErrorCode(err) === 'too_many') return json(429, { error: 'too_many', message: 'You can add up to 6 photos.' });
    console.error('photo upload failed', err);
    return serverError();
  }
};
