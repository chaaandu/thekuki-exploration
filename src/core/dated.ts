/**
 * Browser-side date checks, so a cached page can never show stale content:
 * - Today's trays: visible only when data-date is today (India time).
 * - Offer banners: visible only between data-starts and data-ends.
 * - Time of day: re-checked every minute (the boot script set it before first paint).
 */
import { currentDaypart, todayISO } from '../shared/time.ts';

function compact(iso: string | undefined): number {
  return iso ? Number(iso.replaceAll('-', '')) || 0 : 0;
}

export function applyDates(root: ParentNode = document) {
  const today = todayISO();
  root.querySelectorAll<HTMLElement>('[data-trays]').forEach((el) => {
    el.hidden = el.dataset.date !== today;
  });
  const t = compact(today);
  root.querySelectorAll<HTMLElement>('[data-dated]').forEach((el) => {
    const starts = compact(el.dataset.starts);
    const ends = compact(el.dataset.ends);
    el.hidden = (starts > 0 && t < starts) || (ends > 0 && t > ends);
  });
}

export function initDates() {
  applyDates();
  const html = document.documentElement;
  const tick = () => {
    const part = currentDaypart();
    if (html.dataset.daypart !== part) {
      html.dataset.daypart = part;
      document.dispatchEvent(new CustomEvent('kuki:daypart', { detail: part }));
    }
    applyDates();
  };
  window.setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  document.addEventListener('shopify:section:load', (e) => applyDates(e.target as ParentNode));
}
