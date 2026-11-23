// The roof as measured from above, with a ballpark. For the owners: the site
// shows customers none of this.
export interface RoofSheet {
  source: 'google' | 'outline';
  sqft: [number, number];
  squares: [number, number];
  pitch: string;
  imageryDate: string;
  ballpark: [number, number] | null;
}

const count = (n: number) => n.toLocaleString('en-US');
const dollars = (n: number) => `$${n.toLocaleString('en-US')}`;
const month = (iso: string) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

export default function RoofPanel(props: {
  roof: RoofSheet | null;
  picture: string | null;
  address: string;
  /** Shown when there's no measurement and one can be tried. */
  onMeasure?: () => void;
  busy?: boolean;
}) {
  const r = props.roof;
  return (
    <section aria-labelledby="roof-sheet-h" class="panel roof-sheet">
      <h2 id="roof-sheet-h">Roof from above</h2>
      {props.picture && (
        <img class="roof-shot" src={props.picture} alt={`Satellite view of ${props.address}`} width={640} height={400} loading="lazy" />
      )}
      {r ? (
        <>
          <dl class="kv">
            {r.source === 'google' ? (
              <>
                <dt>Size</dt>
                <dd>
                  About {count(r.sqft[0])} square feet, {r.squares[0]} squares
                </dd>
                <dt>With waste</dt>
                <dd>Up to {r.squares[1]} squares</dd>
                {r.pitch && (
                  <>
                    <dt>Pitch</dt>
                    <dd>{r.pitch}</dd>
                  </>
                )}
                {r.imageryDate && (
                  <>
                    <dt>Imagery</dt>
                    <dd>{month(r.imageryDate)}, Google</dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt>Size</dt>
                <dd>
                  About {r.squares[0]} to {r.squares[1]} squares, from the building's outline. Slope not known.
                </dd>
              </>
            )}
            <dt>Ballpark</dt>
            <dd>{r.ballpark ? <strong>{dollars(r.ballpark[0])} to {dollars(r.ballpark[1])}</strong> : 'Too big or too small to price from above'}</dd>
          </dl>
          <p class="muted small">
            A starting point from the prices in the facts file. The customer doesn't see it. Check the size at the visit: the imagery can be
            years old.
          </p>
        </>
      ) : (
        <>
          <p>Not measured from above. Measure it at the visit.</p>
          {props.onMeasure && (
            <button type="button" class="btn secondary" disabled={props.busy} onClick={props.onMeasure}>
              Try measuring it
            </button>
          )}
        </>
      )}
    </section>
  );
}
