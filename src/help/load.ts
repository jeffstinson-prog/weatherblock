// Help center: one Markdown file per question in src/content/help/.
// Facts are filled in at build time. An answer whose required facts are blank
// is left out entirely; a paragraph that mentions a blank fact is dropped.
import { load } from 'js-yaml';
import { marked } from 'marked';
import { z } from 'zod';
import { applyFacts, facts, fill, has } from '../facts';

export const TOPICS = [
  'Booking and inspections',
  'Insurance and claims',
  'Storms and leaks',
  'Roofs and materials',
  'Money',
  'About us',
] as const;
export type Topic = (typeof TOPICS)[number];

const Frontmatter = z.strictObject({
  question: z.string().min(5),
  topic: z.enum(TOPICS),
  order: z.number().int(),
  /** Facts that must be set for this answer to appear at all. */
  requires: z.array(z.string()).default([]),
  /** Show near the top of the help center and on the home page. */
  top: z.boolean().default(false),
  sources: z.array(z.strictObject({ label: z.string(), url: z.url() })).default([]),
  related: z.array(z.string()).default([]),
  /** Extra words people search with that aren't in the text. */
  keywords: z.array(z.coerce.string()).default([]),
});

export interface HelpArticle extends z.infer<typeof Frontmatter> {
  slug: string;
  /** Markdown with facts applied. */
  markdown: string;
  html: string;
  /** Plain text, for the assistant and search snippets. */
  text: string;
}

const files = import.meta.glob('../content/help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function split(raw: string, file: string): { data: unknown; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${file}: missing --- frontmatter ---`);
  return { data: load(m[1]!), body: m[2]! };
}

export function toPlainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/[*_`>#]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function build(): HelpArticle[] {
  const articles: HelpArticle[] = [];
  for (const [file, raw] of Object.entries(files)) {
    const slug = file.split('/').pop()!.replace(/\.md$/, '');
    const { data, body } = split(raw, file);
    const parsed = Frontmatter.safeParse(data);
    if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
    const fm = parsed.data;
    if (!fm.requires.every((path) => has(path))) continue;
    const question = fill(fm.question, facts);
    const markdown = applyFacts(body.trim(), facts);
    if (question === null || !markdown.trim()) continue;
    const html = marked.parse(markdown, { async: false, gfm: true }) as string;
    articles.push({ ...fm, question, slug, markdown, html, text: toPlainText(markdown) });
  }
  const topicIndex = (t: Topic) => TOPICS.indexOf(t);
  articles.sort((a, b) => topicIndex(a.topic) - topicIndex(b.topic) || a.order - b.order);
  // Drop related links that point at hidden or missing answers.
  const live = new Set(articles.map((a) => a.slug));
  for (const a of articles) a.related = a.related.filter((s) => live.has(s) && s !== a.slug);
  return articles;
}

export const helpArticles: HelpArticle[] = build();

export function getArticle(slug: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.slug === slug);
}

export function byTopic(): { topic: Topic; articles: HelpArticle[] }[] {
  return TOPICS.map((topic) => ({ topic, articles: helpArticles.filter((a) => a.topic === topic) })).filter(
    (g) => g.articles.length > 0,
  );
}

export const topArticles = (): HelpArticle[] => helpArticles.filter((a) => a.top);
