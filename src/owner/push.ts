// Phone notifications in the owner app: whether this phone can get them, and
// turning them on and off. On iPhone they only work in the app added to the
// Home Screen, not in a Safari tab, so the app says how to get there.
import { api } from './api';

export type PushState = 'unsupported' | 'install-first' | 'blocked' | 'off' | 'on';

const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/app/')) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (ios() && !standalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

/** "iPhone", "Android phone", "Mac": so an owner can tell their devices apart later. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || ios()) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  return 'Browser';
}

/** Ask for permission (must follow a tap), then sign this phone up with the server. */
export async function turnOn(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this app. Turn them on in your phone\'s Settings, under Notifications.'
        : 'Notifications stay off. Tap the button again when you want them.',
    );
  }
  const reg = (await registration()) ?? (await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('push');
  if (!publicKey) throw new Error("Notifications aren't set up on the server yet.");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api('push', { body: { action: 'subscribe', subscription: sub.toJSON(), device: deviceName() } });
}

export async function turnOff(): Promise<void> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await api('push', { body: { action: 'unsubscribe', endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

export const sendTest = () => api<{ sent: number }>('push', { body: { action: 'test' } });

/** Tapping a notification while the app is open: the service worker asks the app to go there. */
export function followNotifications(): void {
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null;
    if (d?.type === 'open' && typeof d.url === 'string') {
      const u = new URL(d.url, location.origin);
      if (u.pathname.startsWith('/app/')) location.hash = u.hash || '#/today';
    }
  });
}
