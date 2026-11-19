// The confirmation screen.
import { useEffect, useRef } from 'preact/hooks';
import type { BookingProps } from './BookingApp';
import { downloadIcs, googleCalendarUrl } from './calendar';
import { refLabel, whenLabel } from './format';
import { formatMobile } from './rules';

export interface DoneInfo {
  booking: { ref: string; startsAt: string; endsAt: string; address: string; firstName: string; smsConsent: boolean };
  token: string;
  notified: { email: boolean; sms: boolean };
  email: string;
  mobile: string;
}

export default function Done({ info, props }: { info: DoneInfo; props: BookingProps }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const b = info.booking;
  const manage = `/b/#${info.token}`;
  const event = {
    ref: refLabel(b.ref),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    title: `Roof inspection: ${props.businessName}`,
    location: b.address,
    description: `Reference ${refLabel(b.ref)}. Questions: ${props.phone}. Change or cancel: https://${props.domain}${manage}`,
    domain: props.domain,
  };
  return (
    <div class="booking done">
      <h2 tabIndex={-1} ref={heading} class="step-title">
        You're booked{b.firstName ? `, ${b.firstName}` : ''}.
      </h2>
      <p class="ref">
        Reference <strong>{refLabel(b.ref)}</strong>
      </p>
      <dl class="summary">
        <div>
          <dt>When</dt>
          <dd>{whenLabel(b.startsAt, b.endsAt)}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{b.address}</dd>
        </div>
      </dl>

      {(info.notified.email || info.notified.sms) && (
        <p>
          {info.notified.email && <>We emailed your confirmation to {info.email}. </>}
          {info.notified.sms && <>We texted {formatMobile(info.mobile)}. </>}
        </p>
      )}

      <h3>What happens next</h3>
      <ul>
        {props.byDrone && <li>We inspect your roof by drone during your window.</li>}
        {props.deliverables && <li>You get {props.deliverables}.</li>}
        <li>
          Questions? Call or text <a href={props.phoneHref}>{props.phone}</a>.
        </li>
      </ul>

      <div class="actions">
        <button type="button" class="btn secondary" onClick={() => downloadIcs(event)}>
          Add to Apple or Outlook calendar
        </button>
        <a class="btn secondary" href={googleCalendarUrl(event, props.phone)} target="_blank" rel="noopener">
          Add to Google Calendar
        </a>
      </div>

      <h3>Change or cancel</h3>
      <p>
        Use your private link: <a href={manage}>change or cancel this inspection</a>. Bookmark it, or find it in your
        confirmation. Anyone with the link can change this booking, so keep it to yourself.
      </p>
    </div>
  );
}
