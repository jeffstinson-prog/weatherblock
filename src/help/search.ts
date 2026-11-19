// Tiny search for the help center. The whole index is a few kilobytes, so it
// ships with the page and runs on the phone. No search service, no WebAssembly.

export interface SearchDoc {
  slug: string;
  q: string; // the question
  k: string; // extra keywords
  t: string; // answer text
}

const STOP = new Set(
  (
    'a an and are as at be but by can could did do does for from get got had has have how i if in into is it its ' +
    'me my of on or our please so than that the their them then there these they this to too us was we what when ' +
    'where which who why will with would you your yours im ive dont doesnt'
  ).split(' '),
);

// Words people use for the same thing.
const SYNONYMS: Record<string, string[]> = {
  cost: ['price', 'charge', 'fee', 'free', 'pay', 'much', 'expensive', 'estimate'],
  price: ['cost', 'estimate', 'quote'],
  quote: ['estimate', 'price', 'cost'],
  estimate: ['quote', 'price', 'cost'],
  free: ['cost', 'charge'],
  insurance: ['insurer', 'claim', 'adjuster', 'policy', 'coverage', 'cover'],
  claim: ['insurance', 'adjuster', 'insurer'],
  adjuster: ['claim', 'insurance'],
  deductible: ['insurance', 'waive', 'cover'],
  leak: ['leaking', 'water', 'drip', 'dripping', 'stain'],
  water: ['leak', 'drip'],
  storm: ['hurricane', 'wind', 'hail', 'tropical', 'damage'],
  hurricane: ['storm', 'wind'],
  wind: ['storm', 'hurricane'],
  hail: ['storm'],
  grant: ['fortified', 'nciua', 'money', 'program'],
  fortified: ['grant', 'ibhs'],
  long: ['time', 'duration', 'minutes', 'hours'],
  home: ['house', 'present'],
  reschedule: ['cancel', 'change', 'move', 'time'],
  cancel: ['reschedule', 'change'],
  drone: ['walk', 'climb', 'ladder'],
  walk: ['drone', 'climb'],
  finance: ['financing', 'loan', 'payment', 'payments', 'credit', 'acorn'],
  loan: ['financing', 'finance'],
  credit: ['financing', 'finance'],
  replace: ['replacement', 'new', 'reroof'],
  repair: ['fix', 'patch', 'repairs'],
  fix: ['repair'],
  area: ['serve', 'town', 'county', 'where', 'location'],
  serve: ['area', 'county'],
  license: ['licensed', 'insured', 'contractor'],
  warranty: ['guarantee'],
  material: ['shingle', 'metal', 'tile', 'materials'],
  shingle: ['material', 'shingles'],
  metal: ['material'],
  coast: ['coastal', 'beach', 'salt', 'ocean'],
  salt: ['coast', 'coastal'],
  '2027': ['june', 'change', 'policy', 'insurance'],
  change: ['2027', 'new'],
  text: ['texts', 'sms', 'message'],
};

export function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// Phrases whose meaning lives in words we otherwise skip.
const PHRASES: [RegExp, string][] = [
  [/\bbe (there|around)\b/g, 'be home'],
  [/\bhow long\b/g, 'long duration'],
  [/\bhow much\b/g, 'cost'],
];

export function tokens(text: string): string[] {
  let t = text.toLowerCase().normalize('NFKD');
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  return (t.match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map(stem);
}

function expand(token: string): string[] {
  const extra = SYNONYMS[token] ?? [];
  return [token, ...extra.map(stem)];
}

export interface SearchHit {
  slug: string;
  q: string;
  score: number;
}

export function search(docs: SearchDoc[], query: string, limit = 8): SearchHit[] {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return [];
  const prepared = docs.map((d) => ({
    d,
    q: new Set(tokens(d.q)),
    k: new Set(tokens(d.k)),
    t: new Set(tokens(d.t)),
  }));
  const hits: SearchHit[] = [];
  for (const p of prepared) {
    let score = 0;
    let matched = 0;
    for (const token of qTokens) {
      let best = 0;
      for (const [i, word] of expand(token).entries()) {
        const weight = i === 0 ? 1 : 0.5; // exact word beats a synonym
        if (p.q.has(word)) best = Math.max(best, 5 * weight);
        else if (p.k.has(word)) best = Math.max(best, 3 * weight);
        else if (p.t.has(word)) best = Math.max(best, 1 * weight);
      }
      if (best > 0) matched++;
      score += best;
    }
    if (score > 0) hits.push({ slug: p.d.slug, q: p.d.q, score: score * (matched / qTokens.length) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
