import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getArticle, helpArticles } from '../../src/help/load';
import { search } from '../../src/help/search';

const helpDir = new URL('../../src/content/help/', import.meta.url);
const files = readdirSync(helpDir).filter((f) => f.endsWith('.md'));

describe('help center', () => {
  it('loads every answer whose facts are set', () => {
    expect(helpArticles.length).toBeGreaterThan(10);
    for (const a of helpArticles) {
      expect(a.question).toMatch(/\?$/);
      expect(a.html.length).toBeGreaterThan(20);
      expect(a.markdown).not.toContain('{{');
      expect(a.markdown).not.toMatch(/[?!]\{/);
    }
  });

  it('hides answers that depend on blank facts', () => {
    expect(getArticle('licensed')).toBeUndefined(); // no license number yet
    expect(getArticle('warranty')).toBeUndefined(); // no warranty yet
    expect(getArticle('how-long')).toBeUndefined(); // no visit length yet
  });

  it('shows the answers the brief requires', () => {
    for (const slug of ['cost', 'be-home', 'drone-or-walk', 'after-inspection', 'insurance-pay', 'after-storm', 'repair-or-replace', 'service-area']) {
      expect(getArticle(slug), slug).toBeDefined();
    }
  });

  it('every related link points at a real answer file', () => {
    const slugs = new Set(files.map((f) => f.replace(/\.md$/, '')));
    for (const file of files) {
      const raw = readFileSync(new URL(file, helpDir), 'utf8');
      const related = /related:\s*\[([^\]]*)\]/.exec(raw)?.[1] ?? '';
      for (const slug of related.split(',').map((s) => s.trim()).filter(Boolean)) {
        expect(slugs.has(slug), `${file} -> ${slug}`).toBe(true);
      }
    }
  });

  it('search finds the right answer for everyday wording', () => {
    const docs = helpArticles.map((a) => ({ slug: a.slug, q: a.question, k: a.keywords.join(' '), t: a.text }));
    expect(search(docs, 'how much does an inspection cost')[0]?.slug).toBe('cost');
    expect(search(docs, 'water dripping from my ceiling')[0]?.slug).toBe('leak-now');
    expect(search(docs, 'will insurance pay')[0]?.slug).toBe('insurance-pay');
    expect(search(docs, 'do I have to be there')[0]?.slug).toBe('be-home');
    expect(search(docs, 'xyzzy')).toEqual([]);
  });
});
