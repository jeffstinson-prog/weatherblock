// The assistant: one call to Claude per question, answering only from the
// help center and the facts file, then the rule check before anything is shown.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { AGES, MATERIALS, REASONS } from '../../booking/rules';
import { facts } from '../../facts';
import { getArticle, helpArticles } from '../../help/load';
import { search } from '../../help/search';
import { asPublic } from '../db';
import { appEnv, read } from '../env';
import { check, sentences, type Violation } from './guard';
import { allowedFromKnowledge, systemPrompt } from './knowledge';

const vals = <T extends readonly { value: string }[]>(list: T) => ['', ...list.map((o) => o.value)] as [string, ...string[]];

export const Reply = z.object({
  answer: z.string(),
  found_in_help: z.boolean(),
  help_slugs: z.array(z.string()),
  offer: z.enum(['none', 'book', 'call', 'book_or_call']),
  booking: z
    .object({
      material: z.enum(vals(MATERIALS)),
      age: z.enum(vals(AGES)),
      reason: z.enum(vals(REASONS)),
      note: z.string(),
    })
    .nullable(),
});
export type RawReply = z.infer<typeof Reply>;

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantReply {
  answer: string;
  links: { slug: string; question: string }[];
  offer: RawReply['offer'];
  booking: RawReply['booking'];
  unknown: boolean;
}

export class AssistantUnavailable extends Error {}

export const MODEL = () => read('ASSISTANT_MODEL') ?? 'claude-opus-5-5';

let client: Anthropic | undefined;
let cachedSystem: string | undefined;
let cachedAllowed: ReturnType<typeof allowedFromKnowledge> | undefined;

const system = () => (cachedSystem ??= systemPrompt());
export const allowed = () => (cachedAllowed ??= allowedFromKnowledge());

async function askClaude(turns: Turn[]): Promise<RawReply | 'refused'> {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL(),
    max_tokens: 2000,
    // If the model declines on safety grounds, the API retries on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // The system prompt never changes between requests, so it is cached.
    system: [{ type: 'text', text: system(), cache_control: { type: 'ephemeral' } }],
    messages: turns.map((t) => ({ role: t.role, content: t.text })),
    output_config: { effort: 'low', format: betaZodOutputFormat(Reply) },
  });
  if (response.stop_reason === 'refusal') return 'refused';
  if (!response.parsed_output) throw new Error(`No usable reply (stop reason ${response.stop_reason})`);
  return response.parsed_output;
}

/**
 * Stand-in for tests and local work without a key: finds the closest help
 * answer. A question containing TEST_BREAK_RULE gets a reply that breaks the
 * rules on purpose, to prove the check stops it.
 */
function standIn(question: string): RawReply {
  if (question.includes('TEST_BREAK_RULE')) {
    return { answer: 'Good news: your insurance will pay for the new roof, and we can waive your deductible.', found_in_help: true, help_slugs: [], offer: 'book', booking: null };
  }
  const docs = helpArticles.map((a) => ({ slug: a.slug, q: a.question, k: a.keywords.join(' '), t: a.text }));
  const hit = search(docs, question, 1)[0];
  if (!hit) {
    return { answer: `I don't have an answer for that. Call ${facts.contact.phone}, or book an inspection and ask us in person.`, found_in_help: false, help_slugs: [], offer: 'book_or_call', booking: null };
  }
  const article = getArticle(hit.slug)!;
  const text = sentences(article.text.replace(/\n+/g, ' ')).slice(0, 3).join(' ');
  const leak = /\bleak/i.test(question);
  return {
    answer: text,
    found_in_help: true,
    help_slugs: [hit.slug],
    offer: 'book',
    booking: leak ? { material: '', age: '', reason: 'leak', note: question.slice(0, 200) } : null,
  };
}

const FALLBACK = () =>
  `I can't give you a reliable answer to that. Call or text ${facts.contact.phone}, or book an inspection and ask us in person.`;

export interface Outcome {
  reply: AssistantReply;
  violations: Violation[];
  raw: RawReply | 'refused';
}

export async function answer(turns: Turn[]): Promise<Outcome> {
  const question = turns.at(-1)?.text ?? '';
  let raw: RawReply | 'refused';
  if (read('ANTHROPIC_API_KEY') || read('ANTHROPIC_AUTH_TOKEN')) raw = await askClaude(turns);
  else if (appEnv() === 'test' || appEnv() === 'development') raw = standIn(question);
  else throw new AssistantUnavailable();

  if (raw === 'refused') {
    const reply: AssistantReply = { answer: FALLBACK(), links: [], offer: 'call', booking: null, unknown: true };
    await log(question, false, 'refused', []);
    return { reply, violations: [], raw };
  }

  const violations = check(raw.answer, allowed());
  const links = raw.help_slugs
    .map((slug) => getArticle(slug))
    .filter((a) => a !== undefined)
    .slice(0, 3)
    .map((a) => ({ slug: a.slug, question: a.question }));
  // Names, numbers and addresses never ride along into the booking form.
  const booking = raw.booking ? { ...raw.booking, note: raw.booking.note.replace(/\S+@\S+|\+?\d[\d\s().-]{6,}\d/g, '').slice(0, 300) } : null;

  const reply: AssistantReply =
    violations.length > 0
      ? { answer: FALLBACK(), links: [], offer: 'book_or_call', booking: null, unknown: true }
      : { answer: raw.answer.trim(), links, offer: raw.offer, booking, unknown: !raw.found_in_help };
  await log(question, raw.found_in_help && violations.length === 0, violations[0]?.rule ?? null, raw.help_slugs);
  return { reply, violations, raw };
}

async function log(question: string, answered: boolean, blocked: string | null, slugs: string[]) {
  try {
    await asPublic((tx) => tx`select wb_api.log_question(${question.slice(0, 1000)}, ${answered}, ${blocked}, ${slugs.slice(0, 3)})`);
  } catch (err) {
    console.error('could not log question', err);
  }
}
