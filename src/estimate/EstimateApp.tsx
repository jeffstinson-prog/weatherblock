// The estimate page: find the home, say how to reach you, and the request goes
// to the owners so one of them can call. The page shows the roof from above and
// nothing about its size. A price shows only if the facts file turns that on,
// and then only after the request is sent.
import { useEffect, useRef, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import AddressField from '../booking/AddressField';
import { RequestFailed, post, readSource, uuid, type Place } from '../booking/client';
import { refLabel } from '../booking/format';
import { formatMobile, normalizeMobile } from '../booking/rules';
import { ErrorSummary, TextField } from '../booking/ui';
import { validateRequest } from './rules';

export interface EstimateProps {
  /** The button that sends the request: "Get my free estimate". */
  cta: string;
  /** Where "Pick a time now" goes: the booking form, worded for an estimate. */
  bookHref: string;
  businessName: string;
  phone: string;
  phoneHref: string;
  serviceAreaShort: string;
  /** Finishes "One of us will call you ...": "soon", or the promise in the facts file. */
  callback: string;
  free: boolean;
}

interface Sent {
  ref: string;
  firstName: string;
  mobile: string;
  ballpark: { low: string; high: string; material: string } | null;
}

// Where each error should send the cursor.
const TARGETS: Record<string, string> = { address: 'address', name: 'name', mobile: 'mobile', email: 'email' };

export default function EstimateApp(p: EstimateProps) {
  const [text, setText] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [typed, setTyped] = useState(false);
  const [satellite, setSatellite] = useState<string | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  // One key per visit: a double tap or a retry makes one request, not two.
  const key = useRef(uuid());
  const startedAt = useRef(Date.now());
  const latest = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent) {
      heading.current?.focus();
      window.scrollTo({ top: 0 });
    }
  }, [sent]);

  /** The roof from above, so they can say "yes, that's my house". Only a picture comes back. */
  async function look(pl: Place, fallback: string | null) {
    const ticket = ++latest.current;
    setPicture(null);
    if (!pl.inArea) return;
    setLooking(true);
    try {
      const r = await post<{ outOfArea: boolean; picture: string | null }>('/api/estimate', { place: pl });
      if (ticket === latest.current) setPicture(r.picture ?? fallback);
    } catch {
      if (ticket === latest.current) setPicture(fallback);
    } finally {
      if (ticket === latest.current) setLooking(false);
    }
  }

  function clearError(k: string) {
    if (errors[k]) {
      const next = { ...errors };
      delete next[k];
      setErrors(next);
    }
  }

  const address = () => (place ? { ...place } : { text: text.trim(), typed });
  const outOfArea = place && !place.inArea ? `That address is outside our area. We serve ${p.serviceAreaShort}. Call ${p.phone} if you think that's wrong.` : undefined;

  async function send(e: Event) {
    e.preventDefault();
    const found = validateRequest({ address: { text, placeId: place?.placeId, typed }, contact: { name, mobile, email } });
    if (outOfArea) found.address = outOfArea;
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const res = await post<Sent>('/api/estimate-requests', {
        key: key.current,
        startedAt: startedAt.current,
        website: honeypot,
        address: address(),
        contact: { name: name.trim(), mobile: normalizeMobile(mobile) ?? mobile, email: email.trim() },
        source: { utm: readSource().utm },
      });
      setSent(res);
    } catch (err) {
      const body = (err as RequestFailed).body ?? { error: 'offline', message: "We couldn't reach the server. Try again." };
      if (body.fields && Object.keys(body.fields).length > 0) {
        setErrors(body.fields);
        setFormError(body.message);
      } else {
        setFormError(`${body.message} You can also call or text ${p.phone}.`);
      }
    } finally {
      setBusy(false);
    }
  }

  /** Straight to the booking form, with the address and their details already in. */
  function pickTime() {
    try {
      sessionStorage.setItem(
        'estimate-handoff-v1',
        JSON.stringify({ place: address(), satellite, contact: { name: name.trim(), mobile, email: email.trim() } }),
      );
    } catch {
      // Private browsing: the booking form still works, just without anything filled in.
    }
    location.href = p.bookHref;
  }

  if (sent) {
    return (
      <div class="booking done">
        <div class="done-mark" aria-hidden="true">
          <Icon name="check" size={30} stroke={3} />
        </div>
        <h2 tabIndex={-1} ref={heading} class="step-title">
          Thanks{sent.firstName ? `, ${sent.firstName}` : ''}. Your request is in.
        </h2>
        <p class="ref">
          Reference <strong>{refLabel(sent.ref)}</strong>
        </p>

        {sent.ballpark && (
          <section class="estimate-card result" aria-labelledby="est-ballpark-h">
            <h3 id="est-ballpark-h">Ballpark for a new roof</h3>
            <p class="price">
              {sent.ballpark.low} to {sent.ballpark.high}
            </p>
            <p class="small muted">
              For {sent.ballpark.material}, installed. A rough guide, not a quote. A photo from above can't show how many layers are on the roof,
              rotten wood, or every skylight and chimney. Your price is the one in your written estimate.
            </p>
          </section>
        )}

        <p>
          To finish your estimate we need a few details a photo from above can't show: how many layers are on the roof, the wood underneath,
          the flashing.
        </p>

        <h3>What happens next</h3>
        <ul class="ticks">
          <li>
            <Icon name="check" size={18} stroke={2.5} />
            <span>
              One of us will call you {p.callback} at {formatMobile(sent.mobile)}.
            </span>
          </li>
          <li>
            <Icon name="check" size={18} stroke={2.5} />
            <span>
              We set up your {p.free ? 'free ' : ''}estimate. It starts with a roof inspection, so the price fits your roof as it is.
            </span>
          </li>
          <li>
            <Icon name="check" size={18} stroke={2.5} />
            <span>Don't want to wait? Pick a time now. Your details are already filled in.</span>
          </li>
        </ul>

        <div class="actions">
          <button type="button" class="btn lg" onClick={pickTime}>
            Pick a time now
            <Icon name="arrow-right" size={20} />
          </button>
          <a class="btn secondary" href={p.phoneHref}>
            <Icon name="phone" size={18} />
            Call {p.phone}
          </a>
        </div>
      </div>
    );
  }

  const ready = (place?.inArea ?? false) || typed;

  return (
    <div class="booking estimate">
      <ErrorSummary errors={errors} targets={TARGETS} message={formError} />
      <form noValidate onSubmit={send}>
        <AddressField
          value={text}
          selected={Boolean(place)}
          typed={typed}
          error={errors.address}
          outOfArea={outOfArea}
          onText={(t) => {
            setText(t);
            setPlace(null);
            setTyped(false);
            setPicture(null);
            setSatellite(null);
            clearError('address');
          }}
          onPlace={(pl, sat) => {
            setText(pl.text);
            setPlace(pl);
            setTyped(false);
            setSatellite(sat);
            clearError('address');
            void look(pl, sat);
          }}
          onUseTyped={() => {
            setTyped(true);
            setPlace(null);
            setPicture(null);
            setSatellite(null);
            clearError('address');
          }}
        />

        {looking && (
          <p class="measuring" aria-live="polite">
            Finding your roof...
          </p>
        )}

        {place?.inArea && picture && (
          <figure class="aerial found-roof">
            <div class="aerial-frame">
              <img src={picture} alt={`Satellite view of ${place.text}`} width={640} height={400} />
            </div>
            <figcaption>
              Is this your house? If not, change the address above.{' '}
              <span class="muted">
                Picture:{' '}
                <span class="gmp-attribution" translate={false}>
                  Google Maps
                </span>
                .
              </span>
            </figcaption>
          </figure>
        )}

        {ready && (
          <>
            <h2 class="reach-title">How can we reach you?</h2>
            <TextField
              id="name"
              label="Your name"
              autocomplete="name"
              maxLength={120}
              value={name}
              error={errors.name}
              onInput={(v) => {
                setName(v);
                clearError('name');
              }}
            />
            <TextField
              id="mobile"
              label="Mobile number"
              hint="So we can call you about your estimate."
              type="tel"
              inputMode="tel"
              autocomplete="tel"
              maxLength={20}
              value={mobile}
              error={errors.mobile}
              onInput={(v) => {
                setMobile(v);
                clearError('mobile');
              }}
            />
            <TextField
              id="email"
              label="Email"
              optional
              hint="For a copy of your request."
              type="email"
              inputMode="email"
              autocomplete="email"
              maxLength={254}
              value={email}
              error={errors.email}
              onInput={(v) => {
                setEmail(v);
                clearError('email');
              }}
            />
            <div class="hp" aria-hidden="true">
              <label for="website">Leave this empty</label>
              <input id="website" type="text" tabIndex={-1} autoComplete="off" value={honeypot} onInput={(e) => setHoneypot((e.currentTarget as HTMLInputElement).value)} />
            </div>
            <p class="hint consent">
              By sending this, you agree that {p.businessName} may call or text you at this number about your estimate.{' '}
              <a href="/privacy/" target="_blank" rel="noopener">
                Privacy
              </a>
              .
            </p>
            <div class="step-actions">
              <button type="submit" class="btn lg" disabled={busy}>
                {busy ? 'Sending...' : p.cta}
                {!busy && <Icon name="arrow-right" size={20} />}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
