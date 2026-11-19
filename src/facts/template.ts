// Facts in text: {{path}} placeholders and conditional blocks.
//
//   {{contact.phone}}             the value; the block is dropped if it is blank
//   {{reviews.google.asOf|date}}  formatted as "November 19, 2026"
//   {{reviews.google.rating|1dp}} one decimal place, "5.0"
//   ?{credentials.license.number} keep this block only if the fact is set
//   !{credentials.license.number} keep this block only if the fact is blank
//
// A "block" is a Markdown paragraph, heading, or a single list item. Dropping
// the whole block keeps a blank fact from leaving half a sentence behind.

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([a-z0-9]+)\s*)?\}\}/g;
const CONDITION = /^\s*([?!])\{\s*([a-zA-Z0-9_.]+)\s*\}\s*/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getPath(source: unknown, path: string): unknown {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Blank means: missing, null, empty or whitespace text, or an empty list. `false` is a value, not blank. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  return false;
}

/** True when a fact is set and not `false`. Used for conditions. */
export function isOn(value: unknown): boolean {
  return !isBlank(value) && value !== false;
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

function format(value: unknown, filter: string | undefined): string {
  if (filter === 'date' && typeof value === 'string') return formatDate(value);
  if (filter === '1dp' && typeof value === 'number') return value.toFixed(1);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/**
 * Fill {{placeholders}} in a single string. Returns null when any placeholder
 * points at a blank fact, so the caller can hide the whole string.
 */
export function fill(text: string, facts: unknown): string | null {
  let missing = false;
  const out = text.replace(PLACEHOLDER, (_all, path: string, filter?: string) => {
    const value = getPath(facts, path);
    if (isBlank(value) || typeof value === 'object' && !Array.isArray(value)) {
      missing = true;
      return '';
    }
    return format(value, filter);
  });
  return missing ? null : out;
}

/** Apply a leading ?{path} / !{path} condition. Returns the text without the marker, or null to drop it. */
function applyCondition(text: string, facts: unknown): string | null {
  const m = CONDITION.exec(text);
  if (!m) return text;
  const on = isOn(getPath(facts, m[2]!));
  const keep = m[1] === '?' ? on : !on;
  return keep ? text.slice(m[0].length) : null;
}

function processUnit(text: string, facts: unknown): string | null {
  const conditioned = applyCondition(text, facts);
  if (conditioned === null) return null;
  return fill(conditioned, facts);
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;

/** Apply facts to a Markdown document, block by block. */
export function applyFacts(markdown: string, facts: unknown): string {
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const kept: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const isList = lines.length > 0 && LIST_ITEM.test(lines[0]!);
    if (!isList) {
      const out = processUnit(block, facts);
      if (out !== null && out.trim() !== '') kept.push(out);
      continue;
    }
    // Group list lines into items (continuation lines stay with their item).
    const items: string[] = [];
    for (const line of lines) {
      if (LIST_ITEM.test(line) || items.length === 0) items.push(line);
      else items[items.length - 1] += '\n' + line;
    }
    const keptItems: string[] = [];
    for (const item of items) {
      const m = LIST_ITEM.exec(item);
      const marker = m ? m[0] : '';
      const body = item.slice(marker.length);
      const out = processUnit(body, facts);
      if (out !== null && out.trim() !== '') keptItems.push(marker + out);
    }
    if (keptItems.length > 0) kept.push(keptItems.join('\n'));
  }

  return kept.join('\n\n');
}

/** Resolve {{placeholders}} inside the facts' own text values (for example the financing disclosure). */
export function resolveFactStrings<T>(facts: T): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return node.includes('{{') ? fill(node, facts) ?? '' : node;
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return walk(facts) as T;
}
