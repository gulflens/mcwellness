/**
 * This phone's side of the practice's notifications (the push memo's decision
 * 2): whether the browser can receive them at all, whether it has been asked
 * already, and subscribing or letting go — through the service worker the
 * whole app already registers (app/shell/main.tsx, app/shell/sw.ts).
 *
 * Nothing here talks to the API. The screen (NotificationsStep.tsx) hands the
 * subscription to the server and back; this is the browser's half only, kept
 * apart so a test can stand a phone up without one.
 */

export type DeviceState =
  /** Every browser that has no web push at all. */
  | 'unsupported'
  /** An iPhone or iPad in Safari's own tab: it works once on the home screen. */
  | 'home-screen-first'
  /** The person, or the phone's settings, said no. */
  | 'blocked'
  | 'off'
  | 'on';

type Standalone = Navigator & { standalone?: boolean };

/** An iPhone or iPad, including an iPad that calls itself a Mac. */
function isAppleMobile(): boolean {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent)) return true;
  return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1;
}

/** Opened from the home screen, as an app rather than as a tab. */
function isStandalone(): boolean {
  if ((navigator as Standalone).standalone === true) return true;
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches
    : false;
}

function hasWebPush(): boolean {
  return (
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

/** Where this phone stands, without asking the person anything. */
export async function deviceState(): Promise<DeviceState> {
  if (!hasWebPush()) {
    return isAppleMobile() && !isStandalone() ? 'home-screen-first' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registration();
  if (reg === null) return 'unsupported';
  return (await reg.pushManager.getSubscription()) === null ? 'off' : 'on';
}

/** The practice's public key, as the bytes `applicationServerKey` takes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

export type Subscribed = { endpoint: string; keys: { p256dh: string; auth: string } };

/**
 * Asks the person, then the phone's push service. Answers what the server
 * keeps, or why there is nothing to keep.
 */
export async function subscribeDevice(
  publicKey: string,
): Promise<Subscribed | 'blocked' | 'unsupported'> {
  if (!hasWebPush()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'blocked';
  const reg = await registration();
  if (reg === null) return 'unsupported';
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return 'unsupported';
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/** Lets this phone go. Answers the address the server should forget, if any. */
export async function unsubscribeDevice(): Promise<string | null> {
  const reg = await registration();
  const subscription = reg === null ? null : await reg.pushManager.getSubscription();
  if (subscription === null) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}
