import type { APIRoute } from 'astro';
import { facts, indexable } from '../facts';

// Until launch, keep search engines out. After launch, keep them out of the
// owner app, booking links and the API.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap-index.xml', site ?? `https://${facts.web.domain}`).href;
  const body = indexable()
    ? ['User-agent: *', 'Disallow: /app/', 'Disallow: /b/', 'Disallow: /api/', '', `Sitemap: ${sitemap}`, ''].join('\n')
    : ['User-agent: *', 'Disallow: /', ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
