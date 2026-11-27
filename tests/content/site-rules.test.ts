// Every page of the built site keeps the house rules: no prices, no insurance
// promises, no claim handling, no deductible offers, no claims we can't back up.
// Run after a build (npm run build:test).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../../src/server/assistant/guard';
import { allowedFromKnowledge } from '../../src/server/assistant/knowledge';

const root = existsSync('dist/client') ? 'dist/client' : 'dist';

function pages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name.endsWith('.html') ? [p] : [];
  });
}

function visibleText(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|li|h[1-6]|dt|dd|td|th|figcaption|summary|button|label|legend)>/gi, '. ')
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/([?!:])\s*\./g, '$1')
    .replace(/\s+/g, ' ');
}

function assets(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return assets(p);
    return /\.(html|js|json|webmanifest)$/.test(name) ? [p] : [];
  });
}

describe('nothing a browser is sent carries the roof price', () => {
  // The price per square is in facts.yaml for the owners' ballpark. It must not ride along
  // in a page, in the data a page hands its scripts, or in a script.
  const files = assets(root).filter((f) => !f.includes('/data/outlines/'));
  it('found the pages and scripts', () => {
    expect(files.some((f) => f.endsWith('.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('/estimate/index.html'))).toBe(true);
  });
  it('no price table, no price per square', () => {
    const table = /pricePerSquare|largeRoof|measuredRange|slopeFactor|per square \(100 square feet\)/;
    expect(files.filter((f) => table.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root, ''))).toEqual([]);
  });
});

describe('the built site keeps the rules', () => {
  const files = pages(root);
  it('found the built pages', () => {
    expect(files.length).toBeGreaterThan(30);
  });
  const allowed = allowedFromKnowledge();
  for (const file of files) {
    it(file.replace(root, ''), () => {
      const problems = check(visibleText(readFileSync(file, 'utf8')), allowed, 'site').map((v) => `[${v.rule}] ${v.sentence}`);
      expect(problems).toEqual([]);
    });
  }
});

describe('a shared link shows the logo', () => {
  // iMessage, Facebook, LinkedIn and others show this picture with a link to any page.
  const html = pages(root).filter((f) => !f.includes('/app/'));
  it('every page names the share picture, its size and a large card', () => {
    expect(html.length).toBeGreaterThan(10);
    const missing = html.filter((f) => {
      const page = readFileSync(f, 'utf8');
      return !(
        /<meta property="og:image" content="https:\/\/[^"]+\/brand\/share\.png"/.test(page) &&
        page.includes('<meta property="og:image:width" content="1200"') &&
        page.includes('<meta property="og:image:height" content="630"') &&
        page.includes('<meta name="twitter:card" content="summary_large_image"')
      );
    });
    expect(missing.map((f) => f.replace(root, ''))).toEqual([]);
  });
  it('the picture is there, 1200 by 630', () => {
    const png = readFileSync(join(root, 'brand', 'share.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
