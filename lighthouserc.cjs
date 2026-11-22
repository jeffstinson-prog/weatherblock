// Lighthouse CI: phone settings, every key page must score 95+ in all four categories.
// Each page is measured three times and judged on its middle run: one measurement on a
// shared test machine swings too much, most of all the first one after the server starts.
// Run after `npm run build:node`. Locally, set CHROME_PATH to a Chrome or Chromium binary.
const pages = ['/', '/book/', '/estimate/', '/help/', '/help/cost/', '/ask/', '/services/roof-replacement/', '/financing/', '/about/', '/privacy/'];

module.exports = {
  ci: {
    collect: {
      // Needs DATABASE_URL (the booking page loads open times). APP_ENV=test uses stand-ins for Google and storage.
      startServerCommand: 'node scripts/start-node.mjs',
      startServerReadyPattern: 'Server listening',
      startServerReadyTimeout: 60000,
      url: pages.map((p) => `http://127.0.0.1:4321${p}`),
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        // SEO is checked with search engines allowed in (FORCE_INDEXABLE=1), see the CI workflow.
        'categories:seo': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
