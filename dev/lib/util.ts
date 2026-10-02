// Small shared helpers for the local Shopify emulator.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Ruby CGI.escapeHTML semantics (what Shopify's `escape` filter uses). */
export function escapeHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Escape-once: escape everything except already-escaped entities. */
export function escapeHtmlOnce(input: unknown): string {
  return String(input ?? '').replace(/["><']|&(?!([a-zA-Z]+|(#\d+));)/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Stable numeric id (FNV-1a 64 bit folded into 14 decimal digits), used for ids Shopify
 * would assign server-side (section ids, collection/page ids missing from the snapshot).
 */
export function stableId(input: string, digits = 14): number {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of Buffer.from(input, 'utf8')) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  const min = 10n ** BigInt(digits - 1);
  const span = 9n * min;
  return Number(min + (hash % span));
}

export function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

export function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}

/**
 * Parse JSON that may contain comments. Shopify writes a block comment at the top of
 * theme-editor-generated JSON templates; the platform accepts `/* *\/` and `//` comments.
 */
export function parseJsonc(text: string, file = '<json>'): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  try {
    return JSON.parse(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const match = /position (\d+)/.exec(message);
    let where = '';
    if (match) {
      const pos = Number(match[1]);
      const line = out.slice(0, pos).split('\n').length;
      where = ` (line ${line})`;
    }
    throw new Error(`Invalid JSON in ${file}${where}: ${message}`);
  }
}

export function readJsonFile(path: string): unknown {
  return parseJsonc(readFileSync(path, 'utf8'), path);
}

export function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return readJsonFile(path);
}

export function fileMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Today's date (YYYY-MM-DD) in an IANA zone. */
export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const match = /^\s*([-+]?\d+)/.exec(value);
    if (match) return Number.parseInt(match[1] as string, 10);
  }
  if (value !== null && typeof value === 'object') {
    const prim = Number(value);
    if (Number.isFinite(prim)) return Math.trunc(prim);
  }
  return fallback;
}

/** Shopify handleize: lower-case, strip quotes/brackets, collapse non-word runs to "-". */
export function handleize(input: unknown): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['"()[\]]/g, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function centsFromPriceString(price: unknown): number | null {
  if (price === null || price === undefined || price === '') return null;
  const num = Number(price);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

/** Convert a `shopify://` URL (from url settings / menus) into a storefront path. */
export function resolveShopifyUrl(raw: string): string {
  const match = /^shopify:\/\/([a-z_]+)(?:\/(.*))?$/.exec(raw.trim());
  if (!match) return raw;
  const kind = match[1];
  const rest = match[2] ?? '';
  switch (kind) {
    case 'collections':
      return `/collections/${rest}`;
    case 'products':
      return `/products/${rest}`;
    case 'pages':
      return `/pages/${rest}`;
    case 'blogs':
      return `/blogs/${rest}`;
    case 'policies':
      return `/policies/${rest}`;
    case 'search':
      return '/search';
    case 'cart':
      return '/cart';
    case 'account':
      return '/account';
    default:
      return raw;
  }
}

export function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}
