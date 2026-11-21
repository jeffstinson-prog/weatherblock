import type { APIRoute } from 'astro';

export const prerender = false;

// Referral links for agents and property managers: /r/SMITH24 opens the
// booking page with the code filled in. The code is checked when booking.
export const GET: APIRoute = ({ params, redirect }) => {
  const code = (params.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return redirect(code ? `/book/?ref=${code}` : '/book/', 302);
};
