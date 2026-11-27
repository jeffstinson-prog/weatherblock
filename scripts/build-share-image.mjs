// Writes public/brand/share.png: the picture a link to the site shows in iMessage,
// Facebook, LinkedIn and the like. 1200 x 630, the size they all show large.
// The logo on a white card over the site's deep ocean colors, the domain under it.
//
//   node scripts/build-share-image.mjs
//
// Uses the Playwright Chromium already on the machine. Run it again when the logo
// or the domain changes, and commit the result. Share pictures are cached by the
// apps for a long time, so give a new picture a new file name (and change it in
// src/layouts/Base.astro).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..');
const facts = load(readFileSync(join(root, 'facts.yaml'), 'utf8'));
const domain = String(facts.web.domain);
const logo = readFileSync(join(root, 'src', 'assets', 'logo.png')).toString('base64');
const figtree = readFileSync(join(root, 'src', 'assets', 'fonts', 'figtree-latin-wght-normal.woff2')).toString('base64');
const out = join(root, 'public', 'brand', 'share.png');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${figtree}) format('woff2'); font-weight: 300 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; }
  body {
    display: grid; place-items: center; overflow: hidden;
    font-family: Figtree, sans-serif;
    background:
      radial-gradient(900px 520px at 50% 18%, rgb(38 142 188 / 0.42), transparent 70%),
      radial-gradient(700px 420px at 85% 110%, rgb(128 187 174 / 0.30), transparent 70%),
      linear-gradient(160deg, #0f3a4b 0%, #0a2631 100%);
  }
  .stack { display: grid; justify-items: center; gap: 34px; }
  .card {
    position: relative; overflow: hidden;
    width: 760px; padding: 52px 60px 58px;
    background: #ffffff; border-radius: 36px;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.18), 0 40px 80px -30px rgb(0 0 0 / 0.65);
  }
  .card img { display: block; width: 100%; height: auto; }
  .card::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 10px;
    background: linear-gradient(90deg, #268ebc, #80bbae);
  }
  .domain {
    color: #f2f7f8; font-size: 34px; font-weight: 600; letter-spacing: 0.04em;
  }
</style></head>
<body>
  <div class="stack">
    <div class="card"><img src="data:image/png;base64,${logo}" alt=""></div>
    <p class="domain">${domain}</p>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();

await sharp(png).png({ compressionLevel: 9, palette: false }).toFile(out);
console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
