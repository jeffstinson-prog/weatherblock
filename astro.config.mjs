// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

// Netlify in production and previews. Tests build the same site with the
// Node adapter so Playwright and Lighthouse can run it on any machine.
const useNode = process.env.E2E_ADAPTER === 'node';
const site = process.env.SITE_URL || 'https://weatherblockroofingnc.com';
const supabaseUrl = (process.env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

export default defineConfig({
  site,
  output: 'static',
  adapter: useNode ? node({ mode: 'standalone' }) : netlify({ imageCDN: false }),
  session: false,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  prefetch: false,
  devToolbar: { enabled: false },
  markdown: { syntaxHighlight: false },
  integrations: [
    preact(),
    sitemap({
      filter: (page) => !/^\/(app|b|r|api)(\/|$)/.test(new URL(page).pathname),
    }),
  ],
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        `connect-src 'self'${supabaseUrl ? ` ${supabaseUrl}` : ''}`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
      ],
    },
  },
});
