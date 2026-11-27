// How the business is doing: leads and how far they got, where they came
// from, money won by month, money still out, and how fast the first call was.
import { useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { money } from '../booking/format';
import { Failed, Loading, Segmented, sourceLabel, useData } from './ui';

interface Data {
  days: number;
  leads: number;
  funnel: { step: string; n: number }[];
  sources: { source: string; leads: number; booked: number; won: number; wonCents: number }[];
  wonByMonth: { month: string; count: number; cents: number }[];
  pipeline: { count: number; cents: number };
  medianMinutesToCall: number | null;
  calls: number;
}

function minutesLabel(m: number | null): string {
  if (m === null) return 'None yet';
  if (m < 60) return `${m} min`;
  const h = m / 60;
  if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)} hr`;
  return `${Math.round(h / 24)} days`;
}

const monthLabel = (ym: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`));

/** One row: a name and figure on top, a thin bar under them, all bars on one baseline. */
function BarRow(props: { name: string; figure: string; value: number; max: number; detail?: string }) {
  const pct = props.max > 0 ? Math.max(props.value > 0 ? 2 : 0, Math.round((props.value / props.max) * 100)) : 0;
  return (
    <li class="bar-row">
      <span class="bar-name">{props.name}</span>
      <span class="bar-figure">{props.figure}</span>
      <svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect class="bar-track" x="0" y="0" width="100" height="8" rx="4" />
        {pct > 0 && <rect class="bar-fill" x="0" y="0" width={pct} height="8" rx="4" />}
        <title>{`${props.name}: ${props.figure}${props.detail ? `, ${props.detail}` : ''}`}</title>
      </svg>
      {props.detail && <span class="bar-detail">{props.detail}</span>}
    </li>
  );
}

export default function Reports() {
  const [days, setDays] = useState<'30' | '90' | '365'>('90');
  const { data, error, reload } = useData<Data>(`reports?days=${days}`);

  if (error && !data) return <Failed message={error} onRetry={() => void reload()} />;
  if (!data) return <Loading title="Reports" />;

  const won = data.funnel.find((f) => f.step === 'Won')?.n ?? 0;
  const wonCents = data.sources.reduce((n, s) => n + s.wonCents, 0);
  const rate = data.leads > 0 ? Math.round((won / data.leads) * 100) : 0;
  const maxSource = Math.max(0, ...data.sources.map((s) => s.leads));
  const maxMonth = Math.max(0, ...data.wonByMonth.map((m) => m.cents));

  return (
    <div class="owner-pad reports">
      <p class="back">
        <a href="#/more">
          <Icon name="chevron-left" size={18} />
          More
        </a>
      </p>
      <div class="screen-head">
        <h1>Reports</h1>
        <Segmented
          label="Period"
          value={days}
          onChange={setDays}
          options={[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: 'Year' },
          ]}
        />
      </div>
      <p class="muted small">New customers who first reached out in the last {data.days} days, and how far each one got.</p>

      <dl class="stat-grid kpis">
        <div class="stat">
          <dt class="stat-l">Leads</dt>
          <dd class="stat-n">{data.leads}</dd>
        </div>
        <div class="stat">
          <dt class="stat-l">Won ({rate}%)</dt>
          <dd class="stat-n">{money(wonCents)}</dd>
        </div>
        <div class="stat">
          <dt class="stat-l">
            {data.pipeline.count} estimate{data.pipeline.count === 1 ? '' : 's'} out
          </dt>
          <dd class="stat-n">{money(data.pipeline.cents)}</dd>
        </div>
        <div class="stat">
          <dt class="stat-l">Typical time to first call</dt>
          <dd class="stat-n">{minutesLabel(data.medianMinutesToCall)}</dd>
        </div>
      </dl>

      <section class="panel" aria-labelledby="funnel-h">
        <h2 id="funnel-h">How far they got</h2>
        {data.leads === 0 ? (
          <p class="muted">No new leads in this period.</p>
        ) : (
          <ul class="reset-list bars">
            {data.funnel.map((f) => (
              <BarRow key={f.step} name={f.step} figure={String(f.n)} value={f.n} max={data.leads} detail={`${data.leads ? Math.round((f.n / data.leads) * 100) : 0}% of leads`} />
            ))}
          </ul>
        )}
      </section>

      <section class="panel" aria-labelledby="src-h">
        <h2 id="src-h">Where leads came from</h2>
        {data.sources.length === 0 ? (
          <p class="muted">Nothing yet.</p>
        ) : (
          <ul class="reset-list bars">
            {data.sources.map((s) => (
              <BarRow
                key={s.source}
                name={sourceLabel(s.source)}
                figure={`${s.leads} lead${s.leads === 1 ? '' : 's'}`}
                value={s.leads}
                max={maxSource}
                detail={`${s.booked} booked · ${s.won} won${s.wonCents ? `, ${money(s.wonCents)}` : ''}`}
              />
            ))}
          </ul>
        )}
      </section>

      <section class="panel" aria-labelledby="won-h">
        <h2 id="won-h">Won by month</h2>
        <p class="small muted">Estimates customers said yes to, the last six months.</p>
        {data.wonByMonth.length === 0 ? (
          <p class="muted">No yeses yet.</p>
        ) : (
          <ul class="reset-list bars">
            {data.wonByMonth.map((m) => (
              <BarRow key={m.month} name={monthLabel(m.month)} figure={money(m.cents)} value={m.cents} max={maxMonth} detail={`${m.count} job${m.count === 1 ? '' : 's'}`} />
            ))}
          </ul>
        )}
      </section>
      {data.calls > 0 && (
        <p class="small muted">
          Time to first call is the middle of {data.calls} call-back{data.calls === 1 ? '' : 's'}, from the request to when it was marked called.
        </p>
      )}
    </div>
  );
}
