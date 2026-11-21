// Lighthouse CI: phone settings, every key page must score 95+ in all four categories.
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
      numberOfRuns: 1,
      settings: {
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        // SEO is checked with search engines allowed in (LH_LAUNCHED=1), see the CI workflow.
        'categories:seo': ['error', { minScore: 0.95 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
