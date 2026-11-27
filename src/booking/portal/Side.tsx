// The side column on a wide screen (the end of the page on a phone): who to
// reach and how, the visit's time and place, and the project's documents.
import Icon from '../../icons/Icon';
import { monthDay, refLabel, whenLabel } from '../format';
import type { PortalBooking, PortalFacts } from './types';

function names(list: string[]): string {
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** An email address that breaks after the @ and before the last dot on a narrow screen, never mid-word. */
function Address(props: { email: string }) {
  const at = props.email.lastIndexOf('@');
  const dot = props.email.lastIndexOf('.');
  if (at < 0 || dot < at) return <>{props.email}</>;
  return (
    <>
      {props.email.slice(0, at + 1)}
      <wbr />
      {props.email.slice(at + 1, dot)}
      <wbr />
      {props.email.slice(dot)}
    </>
  );
}

export function Team(props: { booking: PortalBooking; facts: PortalFacts }) {
  const { booking, facts } = props;
  return (
    <section class="side-card" aria-labelledby="team-h">
      <h2 id="team-h">Your team</h2>
      <p class="team-name">
        <strong>{facts.businessName}</strong>
        {facts.town && <span class="muted">, {facts.town}</span>}
      </p>
      {facts.team.length > 0 && <p class="muted small team-people">{names(facts.team)}</p>}
      <ul class="link-rows">
        {facts.phoneHref && (
          <li>
            <a href={facts.phoneHref}>
              <Icon name="phone" size={20} />
              <span class="row-text">
                <span class="row-label">Call</span>{' '}
                <span class="row-value">{facts.phone}</span>
              </span>
              <Icon name="chevron-right" size={18} class="row-go" />
            </a>
          </li>
        )}
        {facts.smsHref && (
          <li>
            <a href={facts.smsHref}>
              <Icon name="message-square" size={20} />
              <span class="row-text">
                <span class="row-label">Text</span>{' '}
                <span class="row-value">{facts.phone}</span>
              </span>
              <Icon name="chevron-right" size={18} class="row-go" />
            </a>
          </li>
        )}
        {facts.email && (
          <li>
            <a href={`mailto:${facts.email}`}>
              <Icon name="mail" size={20} />
              <span class="row-text">
                <span class="row-label">Email</span>{' '}
                <span class="row-value email">
                  <Address email={facts.email} />
                </span>
              </span>
              <Icon name="chevron-right" size={18} class="row-go" />
            </a>
          </li>
        )}
      </ul>
      <h3>Your visit</h3>
      <dl class="summary">
        <div>
          <dt>
            <Icon name="calendar-days" size={16} />
            When
          </dt>
          <dd>{whenLabel(booking.startsAt, booking.endsAt)}</dd>
        </div>
        <div>
          <dt>
            <Icon name="map-pin" size={16} />
            Where
          </dt>
          <dd>{booking.address}</dd>
        </div>
        <div>
          <dt>
            <Icon name="receipt-text" size={16} />
            Reference
          </dt>
          <dd>{refLabel(booking.ref)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function Documents(props: { booking: PortalBooking; fileUrl: string }) {
  const { booking } = props;
  const est = booking.estimate;
  const warranty = booking.warranty;
  const rows = [
    est?.hasFile && props.fileUrl ? { key: 'estimate', href: props.fileUrl, label: 'Your estimate', value: `PDF, sent ${monthDay(est.sentAt)}`, icon: 'file-text' as const } : null,
    // Shows once the server sends a warranty document (see PortalBooking.warranty).
    warranty?.url
      ? { key: 'warranty', href: warranty.url, label: 'Warranty', value: warranty.issuedAt ? `PDF, ${monthDay(warranty.issuedAt)}` : 'PDF', icon: 'shield-check' as const }
      : null,
  ].filter((r) => r !== null);
  return (
    <section class="side-card" aria-labelledby="docs-h">
      <h2 id="docs-h">Documents</h2>
      {rows.length === 0 ? (
        <p class="muted small">{est && !est.hasFile ? 'Your estimate is on this page.' : 'No documents yet.'}</p>
      ) : (
        <ul class="link-rows">
          {rows.map((r) => (
            <li key={r.key}>
              <a href={r.href} target="_blank" rel="noopener">
                <Icon name={r.icon} size={20} />
                <span class="row-text">
                  <span class="row-label">{r.label}</span>
                  <span class="visually-hidden">, </span>
                  <span class="row-value">{r.value}</span>
                </span>
                <Icon name="external-link" size={18} class="row-go" />
                <span class="visually-hidden"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
