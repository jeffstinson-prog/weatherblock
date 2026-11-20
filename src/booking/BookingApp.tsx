// Booking, start to finish: 1 home, 2 roof, 3 time, 4 you, 5 check and book.
// Everything typed is kept on the phone, so a refresh or a closed tab doesn't lose it.
import { useEffect, useRef, useState } from 'preact/hooks';
import AddressField from './AddressField';
import Done, { type DoneInfo } from './Done';
import {
  RequestFailed,
  clearSaved,
  getSlots,
  loadSaved,
  post,
  readSource,
  save,
  shrinkPhoto,
  thumbnail,
  uploadPhoto,
  uuid,
  type Slot,
} from './client';
import { windowLabel, whenLabel } from './format';
import {
  AGES,
  HEARD_ABOUT,
  MATERIALS,
  REASONS,
  RELATIONSHIPS,
  SOMEONE_HOME,
  STEPS,
  firstStepWithErrors,
  labelOf,
  normalizeMobile,
  formatMobile,
  validateStep,
  type Draft,
  type Errors,
} from './rules';
import { Choices, ErrorSummary, SlotPicker, TextField } from './ui';

export interface BookingProps {
  businessName: string;
  phone: string;
  phoneHref: string;
  consentText: string;
  bookLabel: string;
  free: boolean;
  serviceAreaShort: string;
  deliverables: string;
  byDrone: boolean;
  domain: string;
}

const TITLES = ['Your home', 'Your roof', 'Pick a time', 'Your details', 'Check and book'];
const MAX_PHOTOS = 6;

// Where each error should send the cursor.
const TARGETS: Record<string, string> = {
  address: 'address',
  relationship: 'relationship-owner',
  material: 'material-shingle',
  age: 'age-0-5',
  reason: 'reason-leak',
  slot: 'slot',
  someoneHome: 'someoneHome-yes',
  name: 'name',
  mobile: 'mobile',
  email: 'email',
  referralCode: 'referralCode',
};

function newDraft(): Draft {
  const source = readSource();
  return {
    draftKey: uuid(),
    startedAt: Date.now(),
    address: { text: '' },
    relationship: '',
    roof: { material: '', age: '', reason: '', notes: '' },
    photos: [],
    slot: null,
    visit: { someoneHome: '', gateCode: '', pets: '' },
    contact: { name: '', mobile: '', email: '', smsConsent: false },
    source: { heardAbout: '', referralCode: source.referralCode, utm: source.utm, viaAssistant: false },
  };
}

/** A booking the instant estimate started: the address they typed and what it showed, for us to pick up. */
function takeEstimateHandoff(d: Draft): Draft {
  try {
    const raw = sessionStorage.getItem('estimate-handoff-v1');
    if (!raw) return d;
    sessionStorage.removeItem('estimate-handoff-v1');
    const h = JSON.parse(raw) as { address?: string; notes?: string };
    return {
      ...d,
      address: d.address.text ? d.address : { text: (h.address ?? '').slice(0, 300) },
      roof: { ...d.roof, reason: d.roof.reason || 'replace', notes: (d.roof.notes || h.notes || '').slice(0, 2000) },
    };
  } catch {
    return d;
  }
}

/** A booking the assistant started: it leaves a few answers on the phone for us to pick up. */
function takeAssistantHandoff(d: Draft): Draft {
  try {
    const raw = sessionStorage.getItem('assistant-handoff-v1');
    if (!raw) return d;
    sessionStorage.removeItem('assistant-handoff-v1');
    const h = JSON.parse(raw) as { material?: string; reason?: string; age?: string; notes?: string };
    const pick = (list: readonly { value: string }[], v?: string) => (v && list.some((o) => o.value === v) ? v : '');
    return {
      ...d,
      roof: {
        material: pick(MATERIALS, h.material) || d.roof.material,
        age: pick(AGES, h.age) || d.roof.age,
        reason: pick(REASONS, h.reason) || d.roof.reason,
        notes: (h.notes ?? d.roof.notes).slice(0, 2000),
      },
      source: { ...d.source, viaAssistant: true },
    };
  } catch {
    return d;
  }
}

export default function BookingApp(props: BookingProps) {
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [step, setStep] = useState(0);
  const [satellite, setSatellite] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [restored, setRestored] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState('');
  const [alternatives, setAlternatives] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [fromReview, setFromReview] = useState(false);
  const [photoStatus, setPhotoStatus] = useState('');
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Pick up where they left off.
  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setDraft(takeEstimateHandoff(takeAssistantHandoff(saved.draft)));
      setStep(Math.min(Math.max(saved.step, 0), 4));
      setSatellite(saved.satellite);
      setRestored(saved.step > 0 || saved.draft.address.text.length > 0);
    } else {
      setDraft((d) => takeEstimateHandoff(takeAssistantHandoff(d)));
    }
    setReady(true);
  }, []);

  // Save as they go.
  useEffect(() => {
    if (!ready || done) return;
    const t = window.setTimeout(() => save(step, draft, satellite), 250);
    return () => window.clearTimeout(t);
  }, [draft, step, satellite, ready, done]);

  // Move focus to the new step's heading, so screen readers and keyboards follow along.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);

  useEffect(() => {
    if (ready && STEPS[step] === 'time' && slots === null) void loadSlots();
  }, [step, ready]);

  async function loadSlots() {
    setSlotsError('');
    try {
      const list = await getSlots();
      setSlots(list);
      // A saved choice that has since filled up is cleared, so nobody books a gone window.
      if (draft.slot && !list.some((s) => s.id === draft.slot!.id)) {
        setDraft((d) => ({ ...d, slot: null }));
      }
    } catch (err) {
      setSlotsError((err as RequestFailed).body?.message ?? 'Could not load times.');
    }
  }

  const update = (fn: (d: Draft) => Draft) => {
    setDraft((d) => fn(d));
  };

  function clearError(key: string) {
    if (errors[key]) {
      const next = { ...errors };
      delete next[key];
      setErrors(next);
    }
  }

  function goTo(i: number) {
    setErrors({});
    setFormError(undefined);
    setStep(i);
  }

  /** Open a step from the review screen; Continue then comes straight back. */
  function edit(i: number) {
    setFromReview(true);
    goTo(i);
  }

  function next() {
    const name = STEPS[step]!;
    const found = validateStep(name, draft);
    if (name === 'address' && draft.address.inArea === false) {
      found.address = `That address is outside our area. We serve ${props.serviceAreaShort}. Call ${props.phone} if you think that's wrong.`;
    }
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;
    if (fromReview) {
      setFromReview(false);
      setStep(STEPS.length - 1);
      return;
    }
    setStep(step + 1);
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - draft.photos.length;
    const list = [...files].slice(0, room);
    if (files.length > room) setPhotoStatus(`You can add up to ${MAX_PHOTOS} photos. Adding the first ${room}.`);
    for (const [i, file] of list.entries()) {
      setPhotoStatus(`Adding photo ${i + 1} of ${list.length}...`);
      try {
        const small = await shrinkPhoto(file);
        const id = await uploadPhoto(draft.draftKey, small);
        const thumb = await thumbnail(small);
        update((d) => ({ ...d, photos: [...d.photos, { id, thumb }] }));
      } catch (err) {
        setPhotoStatus(err instanceof RequestFailed ? err.body.message : "That photo didn't work. Try another, or skip photos.");
        return;
      }
    }
    setPhotoStatus(`${list.length === 1 ? 'Photo' : 'Photos'} added.`);
  }

  async function removePhoto(id: string) {
    update((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));
    setPhotoStatus('Photo removed.');
    await post('/api/photos', { action: 'remove', draftKey: draft.draftKey, photoId: id }).catch(() => {});
  }

  async function book() {
    const firstBad = firstStepWithErrors(draft);
    if (firstBad) {
      const i = STEPS.indexOf(firstBad);
      setFromReview(true);
      setStep(i);
      setErrors(validateStep(firstBad, draft));
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      const res = await post<{ booking: DoneInfo['booking']; token: string; notified: DoneInfo['notified'] }>('/api/bookings', {
        draftKey: draft.draftKey,
        startedAt: draft.startedAt,
        website: honeypot,
        address: draft.address,
        relationship: draft.relationship,
        roof: draft.roof,
        slotId: draft.slot!.id,
        slotStartsAt: draft.slot!.startsAt,
        visit: draft.visit,
        contact: { ...draft.contact, mobile: normalizeMobile(draft.contact.mobile) ?? draft.contact.mobile },
        source: draft.source,
      });
      clearSaved();
      setDone({
        booking: res.booking,
        token: res.token,
        notified: res.notified,
        email: draft.contact.email.trim(),
        mobile: normalizeMobile(draft.contact.mobile) ?? '',
      });
      window.scrollTo({ top: 0 });
    } catch (err) {
      const e = err as RequestFailed;
      const body = e.body ?? { error: 'offline', message: "We couldn't reach the server. Try again." };
      if (body.error === 'slot_full') {
        setAlternatives(body.alternatives ?? []);
        setSlots(null);
        update((d) => ({ ...d, slot: null }));
        setFormError(body.message);
      } else if (body.fields && Object.keys(body.fields).length > 0) {
        const fieldStep = (key: string) =>
          key === 'address' || key === 'relationship' ? 0 : ['material', 'age', 'reason'].includes(key) ? 1 : ['slot', 'someoneHome'].includes(key) ? 2 : 3;
        const target = Math.min(...Object.keys(body.fields).map(fieldStep));
        setFromReview(true);
        setStep(target);
        setErrors(body.fields);
        setFormError(body.message);
      } else {
        setFormError(`${body.message} You can also call ${props.phone} and we'll book it for you.`);
      }
    } finally {
      setBusy(false);
    }
  }

  // Step one renders on the server too, so the page doesn't jump when the script loads.
  if (done) {
    return <Done info={done} props={props} />;
  }

  const name = STEPS[step]!;
  const total = STEPS.length;
  const bookLabel = props.free ? 'Book my free inspection' : 'Book my inspection';

  return (
    <div class="booking">
      <div class="progress" aria-hidden="true">
        <div class="bar" data-step={step + 1} />
      </div>
      <p class="step-count">
        Step {step + 1} of {total}
      </p>
      <h2 tabIndex={-1} ref={heading} class="step-title">
        {TITLES[step]}
      </h2>

      {restored && step === 0 && (
        <div class="notice">
          <p>We kept what you entered before.</p>
          <button
            type="button"
            class="link-btn"
            onClick={() => {
              clearSaved();
              setDraft(newDraft());
              setSatellite(null);
              setRestored(false);
              setErrors({});
            }}
          >
            Start over instead
          </button>
        </div>
      )}

      <ErrorSummary errors={errors} targets={TARGETS} message={formError} />

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (name === 'review') void book();
          else next();
        }}
      >
        {name === 'address' && (
          <>
            <AddressField
              value={draft.address.text}
              selected={Boolean(draft.address.placeId)}
              typed={Boolean(draft.address.typed)}
              error={errors.address}
              outOfArea={
                draft.address.inArea === false
                  ? `That address is outside our area. We serve ${props.serviceAreaShort}. Call ${props.phone} if you think that's wrong.`
                  : undefined
              }
              onText={(text) => {
                update((d) => ({ ...d, address: { text } }));
                setSatellite(null);
                clearError('address');
              }}
              onPlace={(place, sat) => {
                update((d) => ({ ...d, address: { ...place } }));
                setSatellite(sat);
                clearError('address');
              }}
              onUseTyped={() => {
                update((d) => ({ ...d, address: { text: d.address.text.trim(), typed: true } }));
                setSatellite(null);
                clearError('address');
              }}
            />
            <Choices
              name="relationship"
              legend="Whose home is it?"
              options={RELATIONSHIPS}
              value={draft.relationship}
              error={errors.relationship}
              onChange={(v) => {
                update((d) => ({ ...d, relationship: v }));
                clearError('relationship');
              }}
            />
          </>
        )}

        {name === 'roof' && (
          <>
            <Choices
              name="material"
              legend="What is the roof made of?"
              options={MATERIALS}
              value={draft.roof.material}
              error={errors.material}
              onChange={(v) => {
                update((d) => ({ ...d, roof: { ...d.roof, material: v } }));
                clearError('material');
              }}
            />
            <Choices
              name="age"
              legend="About how old is it?"
              options={AGES}
              value={draft.roof.age}
              error={errors.age}
              onChange={(v) => {
                update((d) => ({ ...d, roof: { ...d.roof, age: v } }));
                clearError('age');
              }}
            />
            <Choices
              name="reason"
              legend="Why do you want an inspection?"
              options={REASONS}
              value={draft.roof.reason}
              error={errors.reason}
              onChange={(v) => {
                update((d) => ({ ...d, roof: { ...d.roof, reason: v } }));
                clearError('reason');
              }}
            />
            <TextField
              id="notes"
              label="Anything we should know?"
              optional
              multiline
              maxLength={2000}
              hint="For example: water stain in the upstairs bedroom."
              value={draft.roof.notes}
              onInput={(v) => update((d) => ({ ...d, roof: { ...d.roof, notes: v } }))}
            />
            <div class="field">
              <label for="photos">
                Photos <span class="hint">(optional, up to {MAX_PHOTOS})</span>
              </label>
              <p class="hint" id="photos-hint">
                Leaks, stains or damage you can see. Take them from the ground or inside, never from the roof.
              </p>
              {draft.photos.length < MAX_PHOTOS && (
                <input
                  id="photos"
                  type="file"
                  accept="image/*"
                  multiple
                  aria-describedby="photos-hint photos-status"
                  onChange={(e) => {
                    const input = e.currentTarget as HTMLInputElement;
                    void addPhotos(input.files).finally(() => (input.value = ''));
                  }}
                />
              )}
              <p class="hint" id="photos-status" aria-live="polite">
                {photoStatus}
              </p>
              {draft.photos.length > 0 && (
                <ul class="thumbs">
                  {draft.photos.map((p, i) => (
                    <li key={p.id}>
                      <img src={p.thumb} alt={`Photo ${i + 1}`} width={88} height={88} />
                      <button type="button" class="link-btn" onClick={() => void removePhoto(p.id)}>
                        Remove photo {i + 1}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {name === 'time' && (
          <>
            {slots === null && !slotsError && <p aria-live="polite">Loading open times...</p>}
            {slotsError && (
              <div class="error-box" role="alert">
                <p>{slotsError}</p>
                <button type="button" class="btn secondary" onClick={() => void loadSlots()}>
                  Try again
                </button>
              </div>
            )}
            {slots !== null && slots.length === 0 && (
              <div class="notice">
                <p>
                  No open times online right now. Call or text <a href={props.phoneHref}>{props.phone}</a> and we'll find one.
                </p>
              </div>
            )}
            {slots !== null && slots.length > 0 && (
              <SlotPicker
                slots={slots}
                value={draft.slot?.id ?? null}
                error={errors.slot}
                onChange={(s) => {
                  update((d) => ({ ...d, slot: { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt } }));
                  clearError('slot');
                }}
              />
            )}
            <Choices
              name="someoneHome"
              legend="Will anyone be home?"
              hint={props.byDrone ? "You don't have to be. We inspect from outside." : undefined}
              options={SOMEONE_HOME}
              value={draft.visit.someoneHome}
              error={errors.someoneHome}
              onChange={(v) => {
                update((d) => ({ ...d, visit: { ...d.visit, someoneHome: v } }));
                clearError('someoneHome');
              }}
            />
            <TextField
              id="gateCode"
              label="Gate or lockbox code"
              optional
              maxLength={100}
              hint="We delete it a week after the visit."
              value={draft.visit.gateCode}
              autocomplete="off"
              onInput={(v) => update((d) => ({ ...d, visit: { ...d.visit, gateCode: v } }))}
            />
            <TextField
              id="pets"
              label="Pets in the yard?"
              optional
              maxLength={300}
              hint="For example: friendly dog in the back yard."
              value={draft.visit.pets}
              onInput={(v) => update((d) => ({ ...d, visit: { ...d.visit, pets: v } }))}
            />
          </>
        )}

        {name === 'contact' && (
          <>
            <TextField
              id="name"
              label="Your name"
              autocomplete="name"
              maxLength={120}
              value={draft.contact.name}
              error={errors.name}
              onInput={(v) => {
                update((d) => ({ ...d, contact: { ...d.contact, name: v } }));
                clearError('name');
              }}
            />
            <TextField
              id="mobile"
              label="Mobile number"
              hint="Only used to reach you about this inspection."
              type="tel"
              inputMode="tel"
              autocomplete="tel"
              maxLength={20}
              value={draft.contact.mobile}
              error={errors.mobile}
              onInput={(v) => {
                update((d) => ({ ...d, contact: { ...d.contact, mobile: v } }));
                clearError('mobile');
              }}
            />
            <TextField
              id="email"
              label="Email"
              hint="We send your confirmation and your link to change or cancel here."
              type="email"
              inputMode="email"
              autocomplete="email"
              maxLength={254}
              value={draft.contact.email}
              error={errors.email}
              onInput={(v) => {
                update((d) => ({ ...d, contact: { ...d.contact, email: v } }));
                clearError('email');
              }}
            />
            <div class="field">
              <label class="check" for="smsConsent">
                <input
                  id="smsConsent"
                  type="checkbox"
                  checked={draft.contact.smsConsent}
                  onChange={(e) =>
                    update((d) => ({ ...d, contact: { ...d.contact, smsConsent: (e.currentTarget as HTMLInputElement).checked } }))
                  }
                />
                <span>{props.consentText}</span>
              </label>
              <p class="hint">
                <a href="/text-messages/" target="_blank" rel="noopener">
                  Text message terms
                </a>{' '}
                and{' '}
                <a href="/privacy/" target="_blank" rel="noopener">
                  privacy
                </a>
                . We email your confirmation either way.
              </p>
            </div>
            <div class="field">
              <label for="heardAbout">
                How did you hear about us? <span class="hint">(optional)</span>
              </label>
              <select
                id="heardAbout"
                value={draft.source.heardAbout}
                onChange={(e) =>
                  update((d) => ({ ...d, source: { ...d.source, heardAbout: (e.currentTarget as HTMLSelectElement).value } }))
                }
              >
                {HEARD_ABOUT.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <details class="field" open={Boolean(draft.source.referralCode) || Boolean(errors.referralCode)}>
              <summary>Have a referral code?</summary>
              <TextField
                id="referralCode"
                label="Referral code"
                optional
                maxLength={20}
                autocomplete="off"
                value={draft.source.referralCode}
                error={errors.referralCode}
                onInput={(v) => {
                  update((d) => ({ ...d, source: { ...d.source, referralCode: v.toUpperCase() } }));
                  clearError('referralCode');
                }}
              />
            </details>
            <div class="hp" aria-hidden="true">
              <label for="website">Leave this empty</label>
              <input id="website" type="text" tabIndex={-1} autoComplete="off" value={honeypot} onInput={(e) => setHoneypot((e.currentTarget as HTMLInputElement).value)} />
            </div>
          </>
        )}

        {name === 'review' && (
          <>
            {alternatives.length > 0 && (
              <fieldset class="alts">
                <legend>Open times near the one you picked</legend>
                <div class="choices one-col">
                  {alternatives.map((s) => (
                    <label class="choice" key={s.id}>
                      <input
                        type="radio"
                        name="alt"
                        checked={draft.slot?.id === s.id}
                        onChange={() => {
                          update((d) => ({ ...d, slot: { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt } }));
                          setFormError(undefined);
                        }}
                      />
                      <span>{whenLabel(s.startsAt, s.endsAt)}</span>
                    </label>
                  ))}
                </div>
                <button type="button" class="link-btn" onClick={() => edit(2)}>
                  See all open times
                </button>
              </fieldset>
            )}
            <p class="not-yet">
              You're not booked yet. Check the details, then tap <strong>{bookLabel}</strong>.
            </p>
            {satellite && draft.address.placeId ? (
              <figure class="satellite">
                <img src={satellite} alt={`Satellite view of ${draft.address.text}`} width={640} height={360} />
                <figcaption>Is this the right house? If not, change the address.</figcaption>
              </figure>
            ) : null}
            <dl class="summary">
              <div>
                <dt>Home</dt>
                <dd>
                  {draft.address.text}
                  <br />
                  <span class="muted">{labelOf(RELATIONSHIPS, draft.relationship)}</span>
                </dd>
                <dd>
                  <button type="button" class="link-btn" onClick={() => edit(0)}>
                    Change the address
                  </button>
                </dd>
              </div>
              <div>
                <dt>Roof</dt>
                <dd>
                  {labelOf(MATERIALS, draft.roof.material)}, {labelOf(AGES, draft.roof.age).toLowerCase()}.{' '}
                  {labelOf(REASONS, draft.roof.reason)}.
                  {draft.photos.length > 0 && ` ${draft.photos.length} ${draft.photos.length === 1 ? 'photo' : 'photos'}.`}
                </dd>
                <dd>
                  <button type="button" class="link-btn" onClick={() => edit(1)}>
                    Change roof details
                  </button>
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>
                  {draft.slot ? whenLabel(draft.slot.startsAt, draft.slot.endsAt) : 'Not picked yet'}
                  <br />
                  <span class="muted">Someone home: {labelOf(SOMEONE_HOME, draft.visit.someoneHome).toLowerCase()}</span>
                </dd>
                <dd>
                  <button type="button" class="link-btn" onClick={() => edit(2)}>
                    Change the time
                  </button>
                </dd>
              </div>
              <div>
                <dt>You</dt>
                <dd>
                  {draft.contact.name}
                  <br />
                  {normalizeMobile(draft.contact.mobile) ? formatMobile(normalizeMobile(draft.contact.mobile)!) : draft.contact.mobile}
                  <br />
                  {draft.contact.email}
                  <br />
                  <span class="muted">{draft.contact.smsConsent ? 'Texts: yes' : 'Texts: no'}</span>
                </dd>
                <dd>
                  <button type="button" class="link-btn" onClick={() => edit(3)}>
                    Change your details
                  </button>
                </dd>
              </div>
            </dl>
          </>
        )}

        <div class="step-actions">
          {step > 0 && !(fromReview && name !== 'review') && (
            <button type="button" class="btn secondary" onClick={() => goTo(step - 1)}>
              Back
            </button>
          )}
          {name === 'review' ? (
            <button type="submit" class="btn" disabled={busy || !draft.slot}>
              {busy ? 'Booking...' : bookLabel}
            </button>
          ) : (
            <button type="submit" class="btn">
              {fromReview ? 'Back to review' : 'Continue'}
            </button>
          )}
        </div>
      </form>
      {name === 'time' && draft.slot && (
        <p class="visually-hidden" aria-live="polite">
          Picked {windowLabel(draft.slot.startsAt, draft.slot.endsAt)}
        </p>
      )}
    </div>
  );
}
