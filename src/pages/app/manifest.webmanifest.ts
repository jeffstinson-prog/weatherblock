import type { APIRoute } from 'astro';
import { facts } from '../../facts';

// Lets the owner app install to a phone's home screen. The name comes from facts.yaml.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: `${facts.business.name} owners`,
      short_name: 'Owners',
      start_url: '/app/#/today',
      scope: '/app/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#1a6a93',
      icons: [
        { src: '/icons/mark-white-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/mark-white-512.png', sizes: '512x512', type: 'image/png' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
