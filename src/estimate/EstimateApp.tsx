// The instant estimate: pick your address, and Google's measurement of your
// roof becomes a ballpark for a new one. When Google has no data for a house,
// its outline in open building data stands in; when that's missing too, the
// house's size typed in. A rough guide, never a quote.
import { useRef, useState } from 'preact/hooks';
import AddressField from '../booking/AddressField';
import { post, type Place } from '../booking/client';
import {
  candidates,
  dollars,
  measuredEstimate,
  outlineFromHouse,
  parseTile,
  pitchLabel,
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
  serviceAreaShort: string;
}

interface SolarRoof {
  areaM2: number;
  groundAreaM2: number;
  pitchDegrees: number;
  imageryDate: string;
}

type Found =
  | { source: 'google'; roof: SolarRoof; image: string | null }
  | { source: 'outline'; houses: Candidate[]; pick: number }
  | { source: 'none' };

const monthYear = (iso: string) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

// Without Google data: a USDA aerial photo (public domain) with the outline drawn on top.
const VIEW_W = 640;
const VIEW_H = 400;
const HALF_W_M = 40;

function aerialUrl(c: Candidate): string {
  const r = 6378137;
  const x = (c.lon * Math.PI * r) / 180;
  const y = Math.log(Math.tan(((90 + c.lat) * Math.PI) / 360)) * r;
  const hw = HALF_W_M / Math.cos((c.lat * Math.PI) / 180);
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

async function outlinesNear(lat: number, lon: number): Promise<Candidate[]> {
  const lists = await Promise.all(
    tilesAround(lat, lon, 80).map(async (k) => {
      const res = await fetch(`/data/outlines/${k}.json`);
      return res.ok ? parseTile(k, (await res.json()) as TileData) : [];
    }),
  );
  return candidates(lists.flat(), lat, lon);
}

export default function EstimateApp(p: Props) {
  const [text, setText] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [satellite, setSatellite] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [manual, setManual] = useState(false);
  const [sqft, setSqft] = useState('');
  const [stories, setStories] = useState('1');
  const [manualResult, setManualResult] = useState<RoofEstimate | null>(null);
  // Read the box itself when the button is pressed: someone can type before the page's script is ready.
  const sqftBox = useRef<HTMLInputElement>(null);

  async function measure(pl: Place) {
    setError('');
    setFound(null);
    setManual(false);
    setManualResult(null);
    if (!pl.inArea) return;
    setBusy(true);
    try {
      const r = await post<{ source: 'google' | 'none' | 'out_of_area'; roof?: SolarRoof; image?: string | null }>('/api/estimate', { place: pl });
      if (r.source === 'google' && r.roof) {
        setFound({ source: 'google', roof: r.roof, image: r.image ?? null });
        return;
      }
      const houses = await outlinesNear(pl.lat, pl.lng);
      if (houses.length > 0) {
        setFound({ source: 'outline', houses, pick: 0 });
      } else {
        setFound({ source: 'none' });
        setManual(true);
      }
    } catch {
      setError("We couldn't measure that roof just now. Enter your house's size below, or try again in a minute.");
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  function fromSize(e: Event) {
    e.preventDefault();
    setError('');
    const raw = sqftBox.current?.value ?? sqft;
    setSqft(raw);
    const n = Number(raw.replace(/[,\s]/g, ''));
    if (!Number.isFinite(n) || n < 300 || n > 15000) {
      setError('Enter the heated square feet, like 1,800. Your listing or tax card has it.');
      return;
    }
    setManualResult(roofEstimate(outlineFromHouse(n, Number(stories)), p.config));
  }

  const house = found?.source === 'outline' ? found.houses[found.pick] : undefined;
  const result: RoofEstimate | null =
    manualResult ??
    (found?.source === 'google'
      ? measuredEstimate(found.roof.areaM2, found.roof.groundAreaM2, p.config)
      : house
        ? roofEstimate(house.areaM2, p.config)
        : null);

  function book() {
    const notes = result?.price
      ? `From the instant estimate: about ${result.squares[0]} to ${result.squares[1]} squares, ${dollars(result.price[0])} to ${dollars(result.price[1])}.`
      : '';
    try {
      sessionStorage.setItem('estimate-handoff-v1', JSON.stringify({ address: place?.text ?? text, place, satellite, notes }));
    } catch {
      // Private browsing: the booking form still works, just without the address filled in.
    }
    location.href = '/book/';
  }

  return (
    <div class="estimate">
      <div class="estimate-lookup">
        <AddressField
          value={text}
          selected={Boolean(place)}
          typed={typed}
          outOfArea={place && !place.inArea ? `That address is outside our area. We serve ${p.serviceAreaShort}.` : undefined}
          onText={(t) => {
            setText(t);
            setPlace(null);
            setTyped(false);
          }}
          onPlace={(pl, sat) => {
            setText(pl.text);
            setPlace(pl);
            setSatellite(sat);
            setTyped(false);
            void measure(pl);
          }}
          onUseTyped={() => {
            setTyped(true);
            setPlace(null);
            setFound(null);
            setError("We need the address from the list to measure the roof. Pick it as you type, or enter your house's size below.");
            setManual(true);
          }}
        />
        {busy && <p aria-live="polite">Measuring your roof...</p>}
      </div>

      {error && (
        <div class="error-box" role="alert">
          <p>{error}</p>
        </div>
      )}

      {found?.source === 'google' && !manualResult && (
        <section class="estimate-card" aria-labelledby="est-found-h">
          <h2 id="est-found-h">{place?.text}</h2>
          {found.image && (
            <figure class="aerial">
              <div class="aerial-frame">
                <img src={found.image} alt="Satellite view of the roof we measured, outlined in yellow" width={640} height={400} />
              </div>
              <figcaption>Is this your house?</figcaption>
            </figure>
          )}
          <p class="small muted">
            Measured from aerial imagery{found.roof.imageryDate ? ` taken ${monthYear(found.roof.imageryDate)}` : ''}, with{' '}
            <span class="gmp-attribution" translate={false}>
              Google Maps
            </span>
            .
          </p>
          <div class="actions">
            <button type="button" class="btn secondary" onClick={() => setManual(true)}>
              Enter my house's size instead
            </button>
          </div>
        </section>
      )}

      {found?.source === 'outline' && house && !manualResult && (
        <section class="estimate-card" aria-labelledby="est-found-h">
          <h2 id="est-found-h">{place?.text}</h2>
          <figure class="aerial">
            <div class="aerial-frame">
              <img src={aerialUrl(house)} alt="Aerial photo of the house we measured, outlined in yellow" width={VIEW_W} height={VIEW_H} />
              <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
                <polygon points={outlinePoints(house)} />
              </svg>
            </div>
            <figcaption>Is this your house?</figcaption>
          </figure>
          <div class="actions">
            {found.pick + 1 < found.houses.length && (
              <button type="button" class="btn secondary" onClick={() => setFound({ ...found, pick: found.pick + 1 })}>
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
            {found?.source === 'google' && !manualResult ? (
              <>
                <li>
                  Your roof: about {result.roofSqft[0].toLocaleString('en-US')} square feet, or {result.squares[0]} squares.
                </li>
                <li>Average pitch: about {pitchLabel(found.roof.pitchDegrees)}.</li>
                <li>
                  The range adds up to {Math.round((p.config.measuredRange[1] - 1) * 100)}% for waste and what a photo from above can't see.
                </li>
              </>
            ) : (
              <>
                <li>Your house seen from above: about {result.outlineSqft.toLocaleString('en-US')} square feet.</li>
                <li>
                  With the slope: about {result.roofSqft[0].toLocaleString('en-US')} to {result.roofSqft[1].toLocaleString('en-US')} square feet of
                  roof, or {result.squares[0]} to {result.squares[1]} squares.
                </li>
              </>
            )}
            <li>For {p.material}, installed.</li>
          </ul>
          <p class="small muted">
            A rough guide, not a quote. A photo from above can't show how many layers are on the roof, rotten wood, or every skylight
            and chimney. {p.priceText} Your price is the one in your written estimate after the free inspection.
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
              <input
                id="est-sqft"
                ref={sqftBox}
                type="text"
                inputMode="numeric"
                aria-describedby="est-sqft-hint"
                value={sqft}
                onInput={(e) => setSqft((e.currentTarget as HTMLInputElement).value)}
              />
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
