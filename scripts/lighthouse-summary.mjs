// Prints what Lighthouse measured, one line per page: the four scores and the timings
// behind the performance score, from the middle run, plus the performance score of
// every run. Run after `npx lhci autorun` (it reads .lighthouseci/).
import { existsSync, readFileSync } from 'node:fs';

const manifestPath = '.lighthouseci/manifest.json';
if (!existsSync(manifestPath)) {
  console.log('No Lighthouse reports to show.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pages = new Map();
for (const run of manifest) pages.set(run.url, [...(pages.get(run.url) ?? []), run]);

const pct = (n) => String(Math.round((n ?? 0) * 100)).padStart(4);
const cell = (s, w) => String(s ?? '').replace(/\u00a0/g, ' ').padStart(w);

console.log(`${'page'.padEnd(30)} perf a11y best  seo |    FCP    LCP    TBT   CLS  speed | performance, every run`);
for (const [url, runs] of pages) {
  const middle = runs.find((r) => r.isRepresentativeRun) ?? runs[0];
  const a = JSON.parse(readFileSync(middle.jsonPath, 'utf8')).audits;
  const s = middle.summary;
  console.log(
    `${new URL(url).pathname.padEnd(30)}${pct(s.performance)} ${pct(s.accessibility)} ${pct(s['best-practices'])} ${pct(s.seo)} |` +
      `${cell(a['first-contentful-paint']?.displayValue, 7)}${cell(a['largest-contentful-paint']?.displayValue, 7)}` +
      `${cell(a['total-blocking-time']?.displayValue, 7)}${cell(a['cumulative-layout-shift']?.displayValue, 6)}` +
      `${cell(a['speed-index']?.displayValue, 7)} | ${runs.map((r) => Math.round(r.summary.performance * 100)).join(', ')}`,
  );
}
