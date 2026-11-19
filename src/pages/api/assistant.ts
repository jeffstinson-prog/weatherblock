import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { AssistantUnavailable, answer, type Turn } from '../../server/assistant/answer';
import { BadRequest, json, rateOk, readJson, sameOrigin, tooMany } from '../../server/http';
import { facts } from '../../facts';

export const prerender = false;

const MAX_TURNS = 16; // 8 questions and 8 answers
const MAX_CHARS = 600;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden' });
  try {
    if (!(await rateOk('assistant', clientAddress, 30, 3600))) return tooMany();
    const body = (await readJson(request, 20_000)) as { turns?: unknown };
    const turns = (Array.isArray(body.turns) ? body.turns : [])
      .filter((t): t is Turn => typeof t === 'object' && t !== null && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
      .slice(-MAX_TURNS)
      .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }));
    if (turns.length === 0 || turns[0]!.role !== 'user' || turns.at(-1)!.role !== 'user' || !turns.at(-1)!.text.trim()) {
      return json(400, { error: 'bad_request', message: 'Type a question first.' });
    }
    const { reply } = await answer(turns);
    return json(200, { ...reply, automated: true });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request', message: err.message });
    if (err instanceof AssistantUnavailable) {
      return json(503, { error: 'unavailable', message: `The assistant isn't available right now. Search the help center, or call ${facts.contact.phone}.` });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json(503, { error: 'busy', message: `The assistant is busy. Try again in a minute, or call ${facts.contact.phone}.` });
    }
    console.error('assistant failed', err);
    return json(500, { error: 'server', message: `Something went wrong. Call ${facts.contact.phone} and we'll answer it.` });
  }
};
