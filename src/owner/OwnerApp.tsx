// The owner app: sign in, then Today (with the people to call), Upcoming, Estimates, Jobs and More.
// One page; the part after # says which screen (nothing personal in it).
import { useEffect, useState } from 'preact/hooks';
import Icon, { type IconName } from '../icons/Icon';
import { auth, whenSignedOut } from './api';
import Availability from './Availability';
import BookingView from './BookingView';
import Crews from './Crews';
import Estimates from './Estimates';
import Jobs from './Jobs';
import More from './More';
import Referrals from './Referrals';
import Requests from './Requests';
import RequestView from './RequestView';
import Questions from './Questions';
import SignIn from './SignIn';
import Today from './Today';
import Upcoming from './Upcoming';

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

const TABS: { view: string; label: string; href: string; icon: IconName }[] = [
  { view: 'today', label: 'Today', href: '#/today', icon: 'sun' },
  { view: 'upcoming', label: 'Upcoming', href: '#/upcoming', icon: 'calendar-days' },
  { view: 'estimates', label: 'Estimates', href: '#/estimates', icon: 'file-text' },
  { view: 'jobs', label: 'Jobs', href: '#/jobs', icon: 'hammer' },
  { view: 'more', label: 'More', href: '#/more', icon: 'menu' },
];

/** Which tab lights up for a screen that isn't a tab itself. */
const PARENT: Record<string, string> = {
  booking: 'today',
  day: 'today',
  requests: 'today',
  request: 'today',
  crews: 'jobs',
  availability: 'more',
  referrals: 'more',
  questions: 'more',
};

export default function OwnerApp(props: AppProps) {
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  const [route, setRoute] = useState(parse(location.hash));

  useEffect(() => {
    const onHash = () => {
      setRoute(parse(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    whenSignedOut(() => setState('out'));
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

  if (state === 'loading') return <p class="owner-pad">Loading...</p>;
  if (state === 'out') return <SignIn businessName={props.businessName} onIn={() => setState('in')} />;

  const tab = PARENT[route.view] ?? route.view;

  return (
    <div class="owner">
      <main id="main" class="owner-main">
        {route.view === 'today' && <Today date={null} />}
        {route.view === 'day' && <Today date={route.arg} />}
        {route.view === 'upcoming' && <Upcoming />}
        {route.view === 'booking' && <BookingView id={route.arg} />}
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
      <nav class="tabs" aria-label="Owner app">
        {TABS.map((t) => (
          <a key={t.view} href={t.href} aria-current={tab === t.view ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
