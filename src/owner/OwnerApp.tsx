// The owner app: sign in, then Home, Customers, Schedule, Tasks and More along
// the bottom on a phone, or down the side on a computer. One page; the part
// after # says which screen (nothing personal in it).
import { useEffect, useState } from 'preact/hooks';
import Icon, { type IconName } from '../icons/Icon';
import { api, auth, whenSignedOut } from './api';
import { followNotifications } from './push';
import { whenShownAgain } from '../booking/fresh';
import Availability from './Availability';
import BookingView from './BookingView';
import Crews from './Crews';
import Customers from './Customers';
import CustomerView from './CustomerView';
import Estimates from './Estimates';
import Home from './Home';
import Jobs from './Jobs';
import More from './More';
import QuickAdd from './QuickAdd';
import Referrals from './Referrals';
import Reports from './Reports';
import Requests from './Requests';
import RequestView from './RequestView';
import Questions from './Questions';
import Schedule from './Schedule';
import SignIn from './SignIn';
import Tasks from './Tasks';
import Team from './Team';
import Today from './Today';
import Upcoming from './Upcoming';
import type { Person } from './ui';

export interface AppProps {
  businessName: string;
  domain: string;
  phone: string;
}

function parse(hash: string): { view: string; arg: string } {
  const [, view = 'today', arg = ''] = hash.replace(/^#/, '').split('/');
  return { view, arg };
}

export function go(path: string) {
  location.hash = path;
}

interface NavItem {
  view: string;
  label: string;
  href: string;
  icon: IconName;
}

/** Along the bottom on a phone. */
const TABS: NavItem[] = [
  { view: 'today', label: 'Home', href: '#/today', icon: 'house' },
  { view: 'customers', label: 'Customers', href: '#/customers', icon: 'users' },
  { view: 'schedule', label: 'Schedule', href: '#/schedule', icon: 'calendar-days' },
  { view: 'tasks', label: 'Tasks', href: '#/tasks/mine', icon: 'list-todo' },
  { view: 'more', label: 'More', href: '#/more', icon: 'menu' },
];

/** Down the side on a computer, with room for the rest. */
const SIDE: NavItem[] = [
  ...TABS.slice(0, 4),
  { view: 'requests', label: 'Requests', href: '#/requests', icon: 'phone-call' },
  { view: 'estimates', label: 'Estimates', href: '#/estimates', icon: 'file-text' },
  { view: 'jobs', label: 'Jobs', href: '#/jobs', icon: 'hammer' },
  { view: 'team', label: 'Team', href: '#/team', icon: 'user-check' },
  { view: 'reports', label: 'Reports', href: '#/reports', icon: 'chart-column' },
  { view: 'more', label: 'More', href: '#/more', icon: 'settings' },
];

/** Which tab lights up for a screen that isn't a tab itself. */
const PARENT: Record<string, string> = {
  booking: 'schedule',
  upcoming: 'schedule',
  day: 'today',
  requests: 'today',
  request: 'today',
  customer: 'customers',
  estimates: 'more',
  jobs: 'more',
  crews: 'more',
  team: 'more',
  reports: 'more',
  availability: 'more',
  referrals: 'more',
  questions: 'more',
};

const SIDE_PARENT: Record<string, string> = {
  booking: 'schedule',
  upcoming: 'schedule',
  day: 'today',
  request: 'requests',
  customer: 'customers',
  crews: 'jobs',
  availability: 'more',
  referrals: 'more',
  questions: 'more',
};

export default function OwnerApp(props: AppProps) {
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  const [route, setRoute] = useState(parse(location.hash));
  const [team, setTeam] = useState<{ me: string; owners: Person[]; due: number }>({ me: '', owners: [], due: 0 });
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const onHash = () => {
      setRoute(parse(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    whenSignedOut(() => setState('out'));
    followNotifications();
    if (!auth) {
      setState('out');
    } else {
      void auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out'));
      const { data } = auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) setState('out');
        else setState('in');
      });
      return () => {
        window.removeEventListener('hashchange', onHash);
        data.subscription.unsubscribe();
      };
    }
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Who's on the team (for assigning) and the count on the Tasks tab.
  useEffect(() => {
    if (state !== 'in') return;
    const load = () =>
      api<{ me: string; owners: Person[]; due: number }>('people')
        .then(setTeam)
        .catch(() => {});
    void load();
    return whenShownAgain(load, 120_000);
  }, [state, route.view]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  if (state === 'loading') return <p class="owner-pad">Loading...</p>;
  if (state === 'out') return <SignIn businessName={props.businessName} onIn={() => setState('in')} />;

  const tab = PARENT[route.view] ?? route.view;
  const side = SIDE_PARENT[route.view] ?? route.view;
  const me = team.me;
  const badge = (view: string) =>
    view === 'tasks' && team.due > 0 ? (
      <span class="tab-badge">
        <span class="visually-hidden">, </span>
        {team.due > 99 ? '99+' : team.due}
        <span class="visually-hidden"> due</span>
      </span>
    ) : null;

  return (
    <div class="owner">
      <nav class="side-nav" aria-label="Owner app">
        <p class="side-brand">{props.businessName}</p>
        <ul class="reset-list">
          {SIDE.map((t) => (
            <li key={t.view}>
              <a href={t.href} aria-current={side === t.view ? 'page' : undefined}>
                <Icon name={t.icon} size={20} />
                {t.label}
                {badge(t.view)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" class="owner-main">
        {flash && (
          <p class="toast" role="status">
            {flash}
          </p>
        )}
        {route.view === 'today' && <Home />}
        {route.view === 'day' && <Today date={route.arg} />}
        {route.view === 'upcoming' && <Upcoming />}
        {route.view === 'booking' && <BookingView id={route.arg} />}
        {route.view === 'customers' && <Customers me={me} />}
        {route.view === 'customer' && <CustomerView id={route.arg} me={me} />}
        {route.view === 'schedule' && <Schedule from={route.arg} me={me} />}
        {route.view === 'tasks' && <Tasks filter={route.arg} />}
        {route.view === 'team' && <Team />}
        {route.view === 'reports' && <Reports />}
        {route.view === 'requests' && <Requests />}
        {route.view === 'request' && <RequestView id={route.arg} businessName={props.businessName} />}
        {route.view === 'estimates' && <Estimates />}
        {route.view === 'jobs' && <Jobs />}
        {route.view === 'crews' && <Crews />}
        {route.view === 'availability' && <Availability />}
        {route.view === 'referrals' && <Referrals domain={props.domain} />}
        {route.view === 'questions' && <Questions />}
        {route.view === 'more' && <More businessName={props.businessName} />}
      </main>
      <QuickAdd people={team.owners} me={me} onFlash={setFlash} />
      <nav class="tabs" aria-label="Owner app tabs">
        {TABS.map((t) => (
          <a key={t.view} href={t.href} aria-current={tab === t.view ? 'page' : undefined}>
            <span class="tab-icon">
              <Icon name={t.icon} size={22} />
              {badge(t.view)}
            </span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
