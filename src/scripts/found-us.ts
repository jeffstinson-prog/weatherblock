// Remembers how someone found us (a campaign tag, a referral code, or the site
// they came from) on their own device for 30 days, so a booking can say where
// it came from. No cookies. Nothing leaves the phone unless they book.
try {
  const KEY = 'found-us-v1';
  const params = new URLSearchParams(location.search);
  const from = document.referrer ? new URL(document.referrer).host : '';
  const external = from !== '' && from !== location.host;
  const tagged = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'].some((k) => params.has(k));
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { at: number } | null;
  const stale = !saved || Date.now() - saved.at > 30 * 86_400_000;
  if (tagged || (external && stale)) {
    const clean = (v: string | null, n = 60) => (v ?? '').replace(/[^\w .-]/g, '').slice(0, n);
    localStorage.setItem(
      KEY,
      JSON.stringify({
        at: Date.now(),
        source: clean(params.get('utm_source')),
        medium: clean(params.get('utm_medium')),
        campaign: clean(params.get('utm_campaign')),
        ref: (params.get('ref') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
        referrer: external ? clean(from, 100) : '',
        landing: clean(location.pathname, 100),
      }),
    );
  }
} catch {
  // Private browsing or storage turned off: fine.
}
