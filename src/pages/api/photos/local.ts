import type { APIRoute } from 'astro';
import { checkLocalSignature, localAllowed, localRead, localWrite } from '../../../server/storage';

export const prerender = false;

// Development and test stand-in for Supabase Storage. Off in production.
export const PUT: APIRoute = async ({ request, url }) => {
  const path = url.searchParams.get('path') ?? '';
  const sig = url.searchParams.get('sig') ?? '';
  if (!localAllowed() || !checkLocalSignature('put', path, sig)) return new Response('Not found', { status: 404 });
  const body = await request.arrayBuffer();
  if (body.byteLength > 10 * 1024 * 1024) return new Response('Too large', { status: 413 });
  await localWrite(path, body);
  return new Response(null, { status: 200 });
};

export const GET: APIRoute = async ({ url }) => {
  const path = url.searchParams.get('path') ?? '';
  const sig = url.searchParams.get('sig') ?? '';
  if (!localAllowed() || !checkLocalSignature('get', path, sig)) return new Response('Not found', { status: 404 });
  try {
    const data = await localRead(path);
    return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
