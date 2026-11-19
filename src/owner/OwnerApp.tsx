// The owner app: sign in, then Today, Upcoming, Availability and More.
// One page; the part after # says which screen (nothing personal in it).
import { useEffect, useState } from 'preact/hooks';
import { auth, whenSignedOut } from './api';
import Availability from './Availability';
import BookingView from './BookingView';
import More from './More';
import Referrals from './Referrals';
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

const TABS = [
  { view: 'today', label: 'Today', href: '#/today' },
  { view: 'upcoming', label: 'Upcoming', href: '#/upcoming' },
  { view: 'availability', label: 'Availability', href: '#/availability' },
  { view: 'more', label: 'More', href: '#/more' },
];

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

  const tab = route.view === 'booking' || route.view === 'day' ? 'today' : route.view === 'referrals' ? 'more' : route.view;

  return (
    <div class="owner">
      <main id="main" class="owner-main">
        {route.view === 'today' && <Today date={null} />}
        {route.view === 'day' && <Today date={route.arg} />}
        {route.view === 'upcoming' && <Upcoming />}
        {route.view === 'booking' && <BookingView id={route.arg} />}
        {route.view === 'availability' && <Availability />}
        {route.view === 'referrals' && <Referrals domain={props.domain} />}
        {route.view === 'more' && <More businessName={props.businessName} />}
      </main>
      <nav class="tabs" aria-label="Owner app">
        {TABS.map((t) => (
          <a key={t.view} href={t.href} aria-current={tab === t.view ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
