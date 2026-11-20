// House rules for every word on the site.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { helpArticles } from '../../src/help/load';
import { facts } from '../../src/facts';

const root = new URL('../../', import.meta.url).pathname;

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const siteFiles = [
  ...walk(join(root, 'src'), ['.astro', '.md', '.ts', '.tsx', '.css']),
  join(root, 'facts.yaml'),
];

describe('voice', () => {
  it('uses no em dashes or en dashes', () => {
    const offenders = siteFiles.filter((f) => /[–—]/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('never hardcodes the business name outside facts.yaml', () => {
    const offenders = siteFiles
      .filter((f) => !f.endsWith('facts.yaml'))
      .filter((f) => /WeatherBlock/i.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('avoids sales and hype words', () => {
    const hype = /\b(best in|#1|number one|unbeatable|act now|limited time|don't miss|hurry|world-class|top-rated|industry-leading|cutting-edge|seamless|elevate|unparalleled)\b/i;
    const offenders = walk(join(root, 'src'), ['.astro', '.md']).filter((f) => hype.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('states no prices of ours anywhere', () => {
    // Pages and components never contain a dollar amount; prices come only from facts.prices.
    const pageFiles = [...walk(join(root, 'src/pages'), ['.astro', '.ts']), ...walk(join(root, 'src/components'), ['.astro'])];
    const offenders = pageFiles.filter((f) => /\$\s?\d/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
    expect(facts.prices).toEqual([]);
  });

  it('puts dollar figures in help answers only when the answer cites its sources', () => {
    // Prices that come from facts.yaml (the roof price per square) are ours to state; anything else needs a source.
    const own = facts.derived.roofPriceText;
    const unsourced = helpArticles
      .filter((a) => /\$\s?\d/.test(own ? a.markdown.replaceAll(own, '') : a.markdown) && a.sources.length === 0)
      .map((a) => a.slug);
    expect(unsourced).toEqual([]);
  });

  it('never says we file, handle or negotiate claims, or waive deductibles, except to say we do not', () => {
    for (const a of helpArticles) {
      for (const sentence of a.text.split(/(?<=[.!?])\s+/)) {
        const risky = /\b(we|we'll|we will|we can)\b[^.]*\b(file|handle|negotiate|waive|cover|absorb|pay)\b[^.]*\b(claim|deductible)/i.test(sentence);
        if (risky) expect(sentence, `${a.slug}: ${sentence}`).toMatch(/\b(don't|do not|never|can't|cannot|won't)\b/i);
      }
    }
  });
});
