// The instant estimate: an address in, the house's outline from above, and a
// ballpark for a new roof. Or, when the outline is missing or wrong, the
// house's size typed in. A rough guide, never a quote.
import { useState } from 'preact/hooks';
import {
  candidates,
  dollars,
  outlineFromHouse,
  parseTile,
  roofEstimate,
  tilesAround,
  type Candidate,
  type PriceConfig,
  type RoofEstimate,
  type TileData,
} from './roof';

interface Props {
  config: PriceConfig;
  material: string;
  priceText: string;
  bookLabel: string;
  phone: string;
  phoneHref: string;
  /** Aerial photos from USGS; off in tests, which never call outside services. */
  imagery: boolean;
}

interface Match {
  address: string;
  lat: number;
  lon: number;
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/, Nc, (\d{5})$/, ', NC $1')
    .replace(/\b(Ne|Nw|Se|Sw)\b/g, (d) => d.toUpperCase());

// An aerial photo around the house (USDA NAIP, public domain), and its outline drawn on top.
const VIEW_W = 640;
const VIEW_H = 400;
const HALF_W_M = 40; // meters from the center to each side

function aerialUrl(c: Candidate): string {
  const r = 6378137;
  const x = (c.lon * Math.PI * r) / 180;
  const y = Math.log(Math.tan(((90 + c.lat) * Math.PI) / 360)) * r;
  const k = 1 / Math.cos((c.lat * Math.PI) / 180); // Web Mercator stretches distances by this
  const hw = HALF_W_M * k;
  const hh = hw * (VIEW_H / VIEW_W);
  const q = new URLSearchParams({
    bbox: [x - hw, y - hh, x + hw, y + hh].map((n) => n.toFixed(2)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${VIEW_W},${VIEW_H}`,
    format: 'jpg',
    f: 'image',
  });
  return `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?${q}`;
}

function outlinePoints(c: Candidate): string {
  const scale = VIEW_W / (2 * HALF_W_M);
  return c.outline.map(([x, y]) => `${(VIEW_W / 2 + x * scale).toFixed(1)},${(VIEW_H / 2 - y * scale).toFixed(1)}`).join(' ');
}

async function loadBuildings(lat: number, lon: number) {
  const keys = tilesAround(lat, lon, 80);
  const lists = await Promise.all(
    keys.map(async (k) => {
      const res = await fetch(`/data/outlines/${k}.json`);
      if (!res.ok) return [];
      return parseTile(k, (await res.json()) as TileData);
    }),
  );
  return lists.flat();
}

export default function EstimateApp(p: Props) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [match, setMatch] = useState<Match | null>(null);
  const [houses, setHouses] = useState<Candidate[]>([]);
  const [pick, setPick] = useState(0);
  const [manual, setManual] = useState(false);
  const [sqft, setSqft] = useState('');
  const [stories, setStories] = useState('1');
  const [manualResult, setManualResult] = useState<RoofEstimate | null>(null);

  async function lookUp(e: Event) {
    e.preventDefault();
    setError('');
    setMatch(null);
    setHouses([]);
    setPick(0);
    setManualResult(null);
    setManual(false);
    if (query.trim().length < 5) {
      setError('Enter the street address, town and ZIP code.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: query }) });
      const data = (await res.json()) as { matches?: Match[]; message?: string };
      if (!res.ok) throw new Error(data.message ?? 'Something went wrong. Try again.');
      const m = data.matches?.[0];
      if (!m) {
        setError("We couldn't find that address. Check the spelling and the ZIP code, or enter your house's size below.");
        setManual(true);
        return;
      }
      setMatch(m);
      const found = candidates(await loadBuildings(m.lat, m.lon), m.lat, m.lon);
      setHouses(found);
      if (found.length === 0) setManual(true);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Try again.');
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  function fromSize(e: Event) {
    e.preventDefault();
    setError('');
    const n = Number(sqft.replace(/[,\s]/g, ''));
    if (!Number.isFinite(n) || n < 300 || n > 15000) {
      setError('Enter the heated square feet, like 1,800. Your listing or tax card has it.');
      return;
    }
    setManualResult(roofEstimate(outlineFromHouse(n, Number(stories)), p.config));
  }

  const house = houses[pick];
  const result = manualResult ?? (house ? roofEstimate(house.areaM2, p.config) : null);

  function book() {
    const lines = result?.price
      ? `From the instant estimate: about ${result.squares[0]} to ${result.squares[1]} squares, ${dollars(result.price[0])} to ${dollars(result.price[1])}.`
      : '';
    try {
      sessionStorage.setItem('estimate-handoff-v1', JSON.stringify({ address: match ? titleCase(match.address) : query, notes: lines }));
    } catch {
      // Private browsing: the booking form still works, just without the address filled in.
    }
    location.href = '/book/';
  }

  return (
    <div class="estimate">
      <form class="estimate-lookup" onSubmit={lookUp} noValidate>
        <label for="est-address">Your address</label>
        <p class="hint" id="est-address-hint">Street, town and ZIP code. For example: 123 Ocean Blvd W, Holden Beach, NC 28462</p>
        <input
          id="est-address"
          type="text"
          autoComplete="street-address"
          aria-describedby="est-address-hint"
          maxLength={200}
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="btn" disabled={busy}>
          {busy ? 'Measuring...' : 'Get my estimate'}
        </button>
      </form>

      {error && (
        <div class="error-box" role="alert">
          <p>{error}</p>
        </div>
      )}

      {match && house && !manualResult && (
        <section class="estimate-card" aria-labelledby="est-found-h">
          <h2 id="est-found-h">{titleCase(match.address)}</h2>
          {p.imagery && (
            <figure class="aerial">
              <div class="aerial-frame">
                <img src={aerialUrl(house)} alt="Aerial photo of the house we measured, outlined in yellow" width={VIEW_W} height={VIEW_H} />
                <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
                  <polygon points={outlinePoints(house)} />
                </svg>
              </div>
              <figcaption>Is this your house?</figcaption>
            </figure>
          )}
          <div class="actions">
            {pick + 1 < houses.length && (
              <button type="button" class="btn secondary" onClick={() => setPick(pick + 1)}>
                Not my house. Show the next one
              </button>
            )}
            <button type="button" class="btn secondary" onClick={() => setManual(true)}>
              Enter my house's size instead
            </button>
          </div>
        </section>
      )}

      {result && (
        <section class="estimate-card" aria-labelledby="est-result-h">
          <h2 id="est-result-h">Ballpark for a new roof</h2>
          {result.price ? (
            <p class="price">
              {dollars(result.price[0])} to {dollars(result.price[1])}
            </p>
          ) : (
            <p>
              This looks like a building we can't size from above, like a townhome row or a business. We'll measure it at the
              inspection.
            </p>
          )}
          <ul class="plain">
            <li>Your house seen from above: about {result.outlineSqft.toLocaleString('en-US')} square feet.</li>
            <li>
              With the slope: about {result.roofSqft[0].toLocaleString('en-US')} to {result.roofSqft[1].toLocaleString('en-US')} square feet of roof,
              or {result.squares[0]} to {result.squares[1]} squares.
            </li>
            <li>For {p.material}, installed.</li>
          </ul>
          <p class="small muted">
            A rough guide, not a quote. A photo from above can't show the roof's slope, how many layers are on it, rotten wood, or
            skylights and chimneys. {p.priceText} Your price is the one in your written estimate after the free inspection.
          </p>
          <div class="actions">
            <button type="button" class="btn" onClick={book}>
              {p.bookLabel}
            </button>
            <a class="btn secondary" href={p.phoneHref}>
              Call {p.phone}
            </a>
          </div>
        </section>
      )}

      {manual && (
        <section class="estimate-card" aria-labelledby="est-size-h">
          <h2 id="est-size-h">Use your house's size</h2>
          <form onSubmit={fromSize} noValidate>
            <div class="field">
              <label for="est-sqft">Heated square feet</label>
              <p class="hint" id="est-sqft-hint">
                From your listing or the county tax card.
              </p>
              <input id="est-sqft" type="text" inputMode="numeric" aria-describedby="est-sqft-hint" value={sqft} onInput={(e) => setSqft((e.currentTarget as HTMLInputElement).value)} />
            </div>
            <div class="field">
              <label for="est-stories">Stories</label>
              <select id="est-stories" value={stories} onChange={(e) => setStories((e.currentTarget as HTMLSelectElement).value)}>
                <option value="1">1</option>
                <option value="1.5">1 and a half</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>
            <button type="submit" class="btn">
              Show the ballpark
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
