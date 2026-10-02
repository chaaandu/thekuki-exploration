// Dates in the shop's timezone (Asia/Kolkata) with Ruby strftime semantics.

export const SHOP_TIMEZONE = 'Asia/Kolkata';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  weekday: number; // 0 = Sunday
  offsetMinutes: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function wallTime(date: Date, tz: string = SHOP_TIMEZONE): WallTime {
  const parts = formatterFor(tz).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const ms = ((date.getTime() % 1000) + 1000) % 1000;
  const weekdayName = get('weekday');
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offsetMinutes = Math.round((asUtc - date.getTime()) / 60000);
  return { year, month, day, hour, minute, second, ms, weekday, offsetMinutes };
}

/** The UTC instant for a wall-clock time in `tz`. */
export function fromWallTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  tz: string = SHOP_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let offset = wallTime(new Date(guess), tz).offsetMinutes;
  let result = guess - offset * 60000;
  const check = wallTime(new Date(result), tz).offsetMinutes;
  if (check !== offset) {
    offset = check;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

function zoneAbbreviation(tz: string, date: Date): string {
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IST';
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * A point in time as Shopify Liquid exposes it (Ruby Time in the shop's zone):
 * prints like "2026-09-28 17:20:31 +0530", serialises to ISO 8601 in JSON.
 */
export class LiquidTime {
  readonly date: Date;
  readonly tz: string;

  constructor(date: Date, tz: string = SHOP_TIMEZONE) {
    this.date = date;
    this.tz = tz;
  }

  toString(): string {
    return strftime(this.date, '%Y-%m-%d %H:%M:%S %z', this.tz);
  }

  toJSON(): string {
    return strftime(this.date, '%Y-%m-%dT%H:%M:%S%:z', this.tz);
  }

  valueOf(): number {
    return this.date.getTime();
  }

  equals(other: unknown): boolean {
    return other instanceof LiquidTime && other.date.getTime() === this.date.getTime();
  }

  gt(other: unknown): boolean {
    return other instanceof LiquidTime ? this.date.getTime() > other.date.getTime() : false;
  }

  geq(other: unknown): boolean {
    return other instanceof LiquidTime ? this.date.getTime() >= other.date.getTime() : false;
  }

  lt(other: unknown): boolean {
    return other instanceof LiquidTime ? this.date.getTime() < other.date.getTime() : false;
  }

  leq(other: unknown): boolean {
    return other instanceof LiquidTime ? this.date.getTime() <= other.date.getTime() : false;
  }
}

export function liquidTimeFromIso(iso: string | null | undefined): LiquidTime | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new LiquidTime(d);
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|z|UTC|GMT|[+-]\d{2}:?\d{2})?$/;

/** Liquid::Utils.to_date with the shop zone for zone-less strings. Returns null when unparseable. */
export function parseLiquidDate(input: unknown, now: Date, tz: string = SHOP_TIMEZONE): Date | null {
  if (input instanceof LiquidTime) return input.date;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) return null;
    return new Date(input * 1000);
  }
  if (typeof input !== 'string') return null;
  const str = input.trim();
  if (str === '') return null;
  const lower = str.toLowerCase();
  if (lower === 'now' || lower === 'today') return new Date(now.getTime());
  if (/^\d+$/.test(str)) return new Date(Number.parseInt(str, 10) * 1000);
  const m = ISO_RE.exec(str);
  if (m) {
    const [, y, mo, d, h, mi, s, frac, zone] = m;
    const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
    if (zone) {
      let offset = 0;
      if (!/^(z|utc|gmt)$/i.test(zone)) {
        const zm = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
        if (zm) offset = (zm[1] === '-' ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3]));
      }
      const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), ms);
      return new Date(utc - offset * 60000);
    }
    return fromWallTime(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), ms, tz);
  }
  const parsed = Date.parse(str);
  if (Number.isNaN(parsed)) return null;
  const hasZone = /(?:\bZ\b|GMT|UTC|[+-]\d{2}:?\d{2}\b)/.test(str);
  if (hasZone) return new Date(parsed);
  const local = new Date(parsed);
  return fromWallTime(
    local.getFullYear(),
    local.getMonth() + 1,
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds(),
    tz,
  );
}

function dayOfYear(w: WallTime): number {
  const start = Date.UTC(w.year, 0, 1);
  const cur = Date.UTC(w.year, w.month - 1, w.day);
  return Math.floor((cur - start) / 86400000) + 1;
}

function weekNumber(w: WallTime, startDay: number): number {
  const doy = dayOfYear(w) - 1;
  const wd = (w.weekday - startDay + 7) % 7;
  return Math.floor((doy - wd + 7) / 7);
}

function isoWeek(w: WallTime): { year: number; week: number } {
  const date = new Date(Date.UTC(w.year, w.month - 1, w.day));
  const dayNum = (w.weekday + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: isoYear, week };
}

function formatOffset(offsetMinutes: number, colons: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  if (colons === 1) return `${sign}${hh}:${mm}`;
  if (colons >= 2) return `${sign}${hh}:${mm}:00`;
  return `${sign}${hh}${mm}`;
}

const DIRECTIVE = /%([-_0^#]*)(\d*)(:{0,2})([a-zA-Z%+])/g;

/** Ruby Time#strftime, evaluated in `tz`. */
export function strftime(date: Date, format: string, tz: string = SHOP_TIMEZONE): string {
  const w = wallTime(date, tz);
  return format.replace(DIRECTIVE, (whole, flagStr: string, widthStr: string, colonStr: string, conv: string) => {
    const flags = new Set(flagStr.split(''));
    let value: string;
    let numeric = true;
    let defaultWidth = 0;
    let defaultPad = '0';
    switch (conv) {
      case 'Y':
        value = String(w.year);
        defaultWidth = w.year < 0 ? 5 : 4;
        break;
      case 'C':
        value = String(Math.floor(w.year / 100));
        defaultWidth = 2;
        break;
      case 'y':
        value = String(((w.year % 100) + 100) % 100);
        defaultWidth = 2;
        break;
      case 'm':
        value = String(w.month);
        defaultWidth = 2;
        break;
      case 'B':
        value = MONTHS[w.month - 1] ?? '';
        numeric = false;
        break;
      case 'b':
      case 'h':
        value = (MONTHS[w.month - 1] ?? '').slice(0, 3);
        numeric = false;
        break;
      case 'd':
        value = String(w.day);
        defaultWidth = 2;
        break;
      case 'e':
        value = String(w.day);
        defaultWidth = 2;
        defaultPad = ' ';
        break;
      case 'j':
        value = String(dayOfYear(w));
        defaultWidth = 3;
        break;
      case 'H':
        value = String(w.hour);
        defaultWidth = 2;
        break;
      case 'k':
        value = String(w.hour);
        defaultWidth = 2;
        defaultPad = ' ';
        break;
      case 'I':
        value = String(w.hour % 12 || 12);
        defaultWidth = 2;
        break;
      case 'l':
        value = String(w.hour % 12 || 12);
        defaultWidth = 2;
        defaultPad = ' ';
        break;
      case 'P':
        value = w.hour < 12 ? 'am' : 'pm';
        numeric = false;
        break;
      case 'p':
        value = w.hour < 12 ? 'AM' : 'PM';
        numeric = false;
        if (flags.has('#')) {
          value = value.toLowerCase();
          flags.delete('#');
        }
        break;
      case 'M':
        value = String(w.minute);
        defaultWidth = 2;
        break;
      case 'S':
        value = String(w.second);
        defaultWidth = 2;
        break;
      case 'L':
        value = String(w.ms).padStart(3, '0');
        if (widthStr) value = value.padEnd(Number(widthStr), '0').slice(0, Number(widthStr));
        widthStr = '';
        break;
      case 'N': {
        const digits = widthStr ? Number(widthStr) : 9;
        value = (String(w.ms).padStart(3, '0') + '000000000').slice(0, digits);
        widthStr = '';
        break;
      }
      case 'z':
        value = formatOffset(w.offsetMinutes, colonStr.length);
        numeric = false;
        break;
      case 'Z':
        value = zoneAbbreviation(tz, date);
        numeric = false;
        break;
      case 'A':
        value = DAYS[w.weekday] ?? '';
        numeric = false;
        break;
      case 'a':
        value = (DAYS[w.weekday] ?? '').slice(0, 3);
        numeric = false;
        break;
      case 'u':
        value = String(w.weekday === 0 ? 7 : w.weekday);
        break;
      case 'w':
        value = String(w.weekday);
        break;
      case 'U':
        value = String(weekNumber(w, 0));
        defaultWidth = 2;
        break;
      case 'W':
        value = String(weekNumber(w, 1));
        defaultWidth = 2;
        break;
      case 'V':
        value = String(isoWeek(w).week);
        defaultWidth = 2;
        break;
      case 'G':
        value = String(isoWeek(w).year);
        defaultWidth = 4;
        break;
      case 'g':
        value = String(isoWeek(w).year % 100);
        defaultWidth = 2;
        break;
      case 's':
        value = String(Math.floor(date.getTime() / 1000));
        break;
      case 'n':
        value = '\n';
        numeric = false;
        break;
      case 't':
        value = '\t';
        numeric = false;
        break;
      case '%':
        value = '%';
        numeric = false;
        break;
      case 'c':
        value = strftime(date, '%a %b %e %H:%M:%S %Y', tz);
        numeric = false;
        break;
      case 'D':
      case 'x':
        value = strftime(date, '%m/%d/%y', tz);
        numeric = false;
        break;
      case 'F':
        value = strftime(date, '%Y-%m-%d', tz);
        numeric = false;
        break;
      case 'T':
      case 'X':
        value = strftime(date, '%H:%M:%S', tz);
        numeric = false;
        break;
      case 'R':
        value = strftime(date, '%H:%M', tz);
        numeric = false;
        break;
      case 'r':
        value = strftime(date, '%I:%M:%S %p', tz);
        numeric = false;
        break;
      case 'v':
        value = strftime(date, '%e-%^b-%Y', tz);
        numeric = false;
        break;
      case '+':
        value = strftime(date, '%a %b %e %H:%M:%S %Z %Y', tz);
        numeric = false;
        break;
      default:
        return whole;
    }
    let width = widthStr ? Number(widthStr) : defaultWidth;
    let pad = numeric ? defaultPad : ' ';
    if (flags.has('-')) width = 0;
    if (flags.has('_')) pad = ' ';
    if (flags.has('0')) pad = '0';
    if (flags.has('^')) value = value.toUpperCase();
    if (flags.has('#')) value = /[a-z]/.test(value) ? value.toUpperCase() : value.toLowerCase();
    if (width > value.length) {
      if (pad === '0' && value.startsWith('-')) value = '-' + value.slice(1).padStart(width - 1, '0');
      else value = value.padStart(width, pad);
    }
    return value;
  });
}

/** Shopify's built-in named date formats (overridable by locale `date_formats`). */
export const SHOPIFY_DATE_FORMATS: Record<string, string> = {
  abbreviated_date: '%b %d, %Y',
  basic: '%m/%d/%Y',
  date: '%B %d, %Y',
  date_at_time: '%B %d, %Y at %-l:%M %P',
  default: '%a, %b %d, %Y, %-l:%M %P %z',
  on_date: 'on %b %d, %Y',
  short: '%d %b %H:%M',
  long: '%B %d, %Y %H:%M',
};
