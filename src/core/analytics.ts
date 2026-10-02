/**
 * Shop events → Shopify customer events (Shopify.analytics.publish). Read them with a
 * custom pixel in Settings › Customer events, e.g. analytics.subscribe('kuki_twist', …).
 * Also mirrored as a DOM event (`kuki:track`) for tests and other islands.
 */

export type KukiEvent =
  | 'kuki_twist'
  | 'kuki_size_switch'
  | 'kuki_add_to_bag'
  | 'kuki_free_delivery_reached'
  | 'kuki_dabba_built'
  | 'kuki_gifting_enquiry'
  | 'kuki_twist_send';

export function track(name: KukiEvent, data: Record<string, unknown> = {}) {
  if (window.KUKI?.settings?.publishEvents === false) return;
  const payload = { ...data, page: location.pathname };
  try {
    window.Shopify?.analytics?.publish?.(name, payload);
  } catch {
    /* analytics must never break the shop */
  }
  document.dispatchEvent(new CustomEvent('kuki:track', { detail: { name, data: payload } }));
}

/** Fire an event at most once per browser session (e.g. reaching free delivery). */
export function trackOnce(name: KukiEvent, data: Record<string, unknown> = {}) {
  const key = `kuki:once:${name}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* no storage: fall through and track */
  }
  track(name, data);
}
