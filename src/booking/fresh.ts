// Open times go stale on a phone. A tab left open last night comes back this
// morning showing last night's list, with "Tomorrow" on times that are now past.
// These helpers let a page notice it's been shown again and reload.

/** How old a list of open times can get before we load it again. */
export const STALE_MS = 5 * 60_000;

/**
 * Calls `check` when the page is shown again (back to the tab, back to the app,
 * restored from the back button), and once a minute while it's on screen.
 * Returns a function that stops it.
 */
export function whenShownAgain(check: () => void, everyMs = 60_000): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) check();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onShow);
  const timer = window.setInterval(onVisible, everyMs);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onShow);
    window.clearInterval(timer);
  };
}

/** The times that haven't started yet. The server already leaves out anything too soon to book. */
export const stillAhead = <T extends { startsAt: string }>(list: T[], now = Date.now()): T[] =>
  list.filter((s) => Date.parse(s.startsAt) > now);

/** True when a picked time has started, so it can't be booked any more. */
export const hasStarted = (slot: { startsAt: string } | null | undefined, now = Date.now()): boolean =>
  Boolean(slot && Date.parse(slot.startsAt) <= now);
