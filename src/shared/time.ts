/**
 * India time helpers. The shop runs on Asia/Kolkata whatever the visitor's device says.
 * `?now=<ISO>` (or Shopify.devNow from the local emulator) overrides the clock for previews.
 */

export type Daypart = 'morning' | 'day' | 'chai' | 'evening' | 'night';

const TZ = 'Asia/Kolkata';

export function now(): Date {
  const forced = new URLSearchParams(location.search).get('now') ?? (window as any).Shopify?.devNow;
  if (forced) {
    const d = new Date(forced);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function kolkataParts(date: Date = now()): { y: string; m: string; d: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return { y: get('year'), m: get('month'), d: get('day'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** YYYY-MM-DD in India time. */
export function todayISO(date: Date = now()): string {
  const p = kolkataParts(date);
  return `${p.y}-${p.m}-${p.d}`;
}

export function daypartFor(hour: number): Daypart {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 16) return 'day';
  if (hour < 19) return 'chai';
  if (hour < 21) return 'evening';
  return 'night';
}

export function currentDaypart(): Daypart {
  const forced = new URLSearchParams(location.search).get('daypart') as Daypart | null;
  if (forced && ['morning', 'day', 'chai', 'evening', 'night'].includes(forced)) return forced;
  return daypartFor(kolkataParts().hour);
}
