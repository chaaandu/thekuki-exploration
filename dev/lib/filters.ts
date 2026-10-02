// Shopify Liquid filters on top of LiquidJS. Named filter arguments arrive from LiquidJS as
// [key, value] pairs; `named()` splits them out.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toValue, type Context, type Liquid } from 'liquidjs';
import { colorFilters } from './colors.ts';
import { parseLiquidDate, strftime, SHOPIFY_DATE_FORMATS } from './dates.ts';
import { BaseDrop } from './drop-base.ts';
import { ImageDrop } from './drops.ts';
import { formatMoney, formatMoneyWithoutCurrency } from './money.ts';
import { applyOperation, liquidAbs, liquidAtLeast, liquidAtMost, liquidCeil, liquidFloor, liquidRound, liquidSum, LiquidFloat } from './numbers.ts';
import { getState } from './state.ts';
import { escapeHtml, handleize } from './util.ts';

type Args = unknown[];

function named(args: Args): { pos: unknown[]; opts: Record<string, unknown> } {
  const pos: unknown[] = [];
  const opts: Record<string, unknown> = {};
  for (const a of args) {
    if (Array.isArray(a) && a.length === 2 && typeof a[0] === 'string') opts[a[0]] = toValue(a[1]);
    else pos.push(toValue(a));
  }
  return { pos, opts };
}

function str(v: unknown): string {
  const x = toValue(v);
  return x === null || x === undefined ? '' : String(x);
}

/** JSON that is safe inside <script>: drops use toJSON, `<>&` are escaped like Shopify does. */
export function shopifyJson(value: unknown): string {
  const seen = new WeakSet();
  const out = JSON.stringify(toValue(value), (_k, v) => {
    if (v instanceof LiquidFloat) return Number(v.valueOf());
    if (v && typeof v === 'object') {
      if (seen.has(v)) return null;
      seen.add(v);
      if (v instanceof BaseDrop) return v.toJSON();
    }
    return v;
  });
  return (out ?? 'null').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function imageBase(input: unknown): { url: string; width: number } | null {
  const v = toValue(input) as unknown;
  if (v instanceof ImageDrop) return { url: v.src, width: v.width };
  if (v && typeof v === 'object' && 'preview_image' in (v as object)) {
    const p = (v as { preview_image: unknown }).preview_image;
    if (p instanceof ImageDrop) return { url: p.src, width: p.width };
  }
  if (v && typeof v === 'object' && 'src' in (v as object)) return { url: String((v as { src: unknown }).src), width: 0 };
  if (typeof v === 'string' && v) {
    if (v.startsWith('/') || v.startsWith('http')) return { url: v, width: 0 };
    return { url: `/cdn/shop/files/${v}?v=1`, width: 0 };
  }
  return null;
}

function withParams(url: string, params: Record<string, unknown>): string {
  const [path, query = ''] = url.split('?');
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path!;
}

export function registerFilters(liquid: Liquid): void {
  const reg = (name: string, fn: (this: { context: Context }, input: unknown, ...args: Args) => unknown) => liquid.registerFilter(name, fn as never);

  /* -------- money -------- */
  reg('money', function (input) {
    return formatMoney(toValue(input), getState(this.context).view.model.shop.moneyFormat);
  });
  reg('money_with_currency', function (input) {
    return formatMoney(toValue(input), getState(this.context).view.model.shop.moneyWithCurrencyFormat);
  });
  reg('money_without_currency', function (input) {
    return formatMoneyWithoutCurrency(toValue(input), getState(this.context).view.model.shop.moneyFormat);
  });
  reg('money_without_trailing_zeros', function (input) {
    return formatMoney(toValue(input), getState(this.context).view.model.shop.moneyFormat, { stripZeros: true });
  });

  /* -------- translations -------- */
  reg('t', function (input, ...args) {
    return getState(this.context).theme.translate(str(input), named(args).opts);
  });

  /* -------- urls & assets -------- */
  reg('asset_url', function (input) {
    return getState(this.context).theme.assetUrl(str(input));
  });
  reg('asset_img_url', function (input) {
    return getState(this.context).theme.assetUrl(str(input));
  });
  reg('file_url', (input) => `/cdn/shop/files/${encodeURIComponent(str(input))}?v=1`);
  reg('file_img_url', (input) => `/cdn/shop/files/${encodeURIComponent(str(input))}?v=1`);
  reg('inline_asset_content', function (input) {
    const p = getState(this.context).theme.assetPath(str(input));
    if (!p) throw new Error(`inline_asset_content: asset "${str(input)}" not found`);
    return readFileSync(p, 'utf8');
  });
  reg('image_url', (input, ...args) => {
    const base = imageBase(input);
    if (!base) return '';
    const { opts } = named(args);
    return withParams(base.url, { width: opts.width, height: opts.height, crop: opts.crop, format: opts.format, pad_color: opts.pad_color });
  });
  reg('img_url', (input, size) => {
    const base = imageBase(input);
    if (!base) return '';
    const m = /^(\d*)x(\d*)$/.exec(str(size));
    return withParams(base.url, m ? { width: m[1] || undefined, height: m[2] || undefined } : {});
  });
  reg('image_tag', (input, ...args) => {
    const { opts } = named(args);
    const v = toValue(input);
    const url = typeof v === 'string' ? v : imageBase(v)?.url ?? '';
    const attrs = Object.entries(opts)
      .filter(([k]) => !['widths', 'preload'].includes(k))
      .map(([k, val]) => `${k}="${escapeHtml(str(val))}"`)
      .join(' ');
    return `<img src="${escapeHtml(url)}" ${attrs}>`;
  });
  reg('stylesheet_tag', (input) => `<link href="${escapeHtml(str(input))}" rel="stylesheet" type="text/css" media="all" />`);
  reg('script_tag', (input) => `<script src="${escapeHtml(str(input))}" type="text/javascript"></script>`);
  reg('preload_tag', (input, ...args) => {
    const { opts } = named(args);
    return `<link href="${escapeHtml(str(input))}" rel="preload" as="${escapeHtml(str(opts.as ?? 'script'))}">`;
  });
  reg('placeholder_svg_tag', (input, cls) => `<svg class="${escapeHtml(str(cls))}" data-placeholder="${escapeHtml(str(input))}" viewBox="0 0 525 525" xmlns="http://www.w3.org/2000/svg"><rect width="525" height="525" fill="#eadcc4"/></svg>`);
  reg('link_to', (input, url, title) => `<a href="${escapeHtml(str(url))}"${title ? ` title="${escapeHtml(str(title))}"` : ''}>${str(input)}</a>`);
  reg('within', (input, collection) => {
    const c = toValue(collection) as { url?: string } | null;
    return c?.url ? `${c.url}${str(input)}` : str(input);
  });
  reg('payment_type_svg_tag', () => '');
  reg('structured_data', () => '');
  reg('format_address', () => '');
  reg('format_code', (input) => str(input).replace(/(.{4})/g, '$1 ').trim());

  /* -------- strings -------- */
  reg('json', (input) => shopifyJson(input));
  reg('handle', (input) => handleize(str(input)));
  reg('handleize', (input) => handleize(str(input)));
  reg('camelize', (input) => str(input).replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase()));
  reg('pluralize', (input, singular, plural) => (Number(toValue(input)) === 1 ? str(singular) : str(plural)));
  reg('url_escape', (input) => encodeURI(str(input)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));
  reg('url_param_escape', (input) => encodeURIComponent(str(input)));
  reg('base64_encode', (input) => Buffer.from(str(input), 'utf8').toString('base64'));
  reg('base64_decode', (input) => Buffer.from(str(input), 'base64').toString('utf8'));
  reg('base64_url_safe_encode', (input) => Buffer.from(str(input), 'utf8').toString('base64url'));
  reg('md5', (input) => createHash('md5').update(str(input)).digest('hex'));
  reg('sha1', (input) => createHash('sha1').update(str(input)).digest('hex'));
  reg('sha256', (input) => createHash('sha256').update(str(input)).digest('hex'));
  reg('hmac_sha1', (input, secret) => createHmac('sha1', str(secret)).update(str(input)).digest('hex'));
  reg('hmac_sha256', (input, secret) => createHmac('sha256', str(secret)).update(str(input)).digest('hex'));
  reg('highlight', (input, terms) => {
    const t = str(terms).trim();
    if (!t) return str(input);
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return str(input).replace(re, '<strong class="highlight">$1</strong>');
  });
  reg('weight_with_unit', (input) => `${(Number(toValue(input)) / 1000).toFixed(2)} kg`);
  reg('default_errors', (input) => {
    const v = toValue(input) as { fullMessages?: () => string[] } | null;
    const msgs = v?.fullMessages?.() ?? [];
    return msgs.length ? `<ul>${msgs.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : '';
  });
  reg('metafield_text', (input) => {
    const v = toValue(input) as { value?: unknown } | null;
    return str(v && typeof v === 'object' && 'value' in v ? v.value : v);
  });
  reg('metafield_tag', (input) => {
    const v = toValue(input) as { value?: unknown } | null;
    return `<span class="metafield">${escapeHtml(str(v && typeof v === 'object' && 'value' in v ? v.value : v))}</span>`;
  });

  /* -------- dates -------- */
  reg('date', function (input, ...args) {
    const state = getState(this.context);
    const { pos, opts } = named(args);
    const d = parseLiquidDate(toValue(input), state.request.now);
    if (!d) return toValue(input);
    let format = pos[0] === undefined || pos[0] === null ? undefined : str(pos[0]);
    if (opts.format !== undefined) {
      const name = str(opts.format);
      format = state.theme.dateFormat(name) ?? SHOPIFY_DATE_FORMATS[name];
      if (!format) throw new Error(`date: unknown format "${name}" (add it to locales date_formats)`);
    }
    if (!format) return toValue(input);
    return strftime(d, format);
  });
  reg('time_tag', function (input, format) {
    const d = parseLiquidDate(toValue(input), getState(this.context).request.now);
    if (!d) return '';
    return `<time datetime="${d.toISOString()}">${escapeHtml(strftime(d, str(format) || '%a, %b %d, %Y'))}</time>`;
  });

  /* -------- maths (Shopify integer semantics) -------- */
  reg('plus', (a, b) => applyOperation(toValue(a), toValue(b), 'plus'));
  reg('minus', (a, b) => applyOperation(toValue(a), toValue(b), 'minus'));
  reg('times', (a, b) => applyOperation(toValue(a), toValue(b), 'times'));
  reg('divided_by', (a, b) => applyOperation(toValue(a), toValue(b), 'divided_by'));
  reg('modulo', (a, b) => applyOperation(toValue(a), toValue(b), 'modulo'));
  reg('round', (a, places) => liquidRound(toValue(a), toValue(places)));
  reg('ceil', (a) => liquidCeil(toValue(a)));
  reg('floor', (a) => liquidFloor(toValue(a)));
  reg('abs', (a) => liquidAbs(toValue(a)));
  reg('at_least', (a, b) => liquidAtLeast(toValue(a), toValue(b)));
  reg('at_most', (a, b) => liquidAtMost(toValue(a), toValue(b)));
  reg('sum', (input, prop) => {
    const arr = (toValue(input) as unknown[]) ?? [];
    const p = prop === undefined ? undefined : str(prop);
    return liquidSum(arr.map((x) => (p ? (toValue(x) as Record<string, unknown>)?.[p] : x)));
  });
  reg('default', (input, ...args) => {
    const { pos, opts } = named(args);
    const v = toValue(input);
    const fallback = pos[0];
    if (opts.allow_false === true && v === false) return v;
    const blank = v === null || v === undefined || v === false || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0) || (v instanceof BaseDrop && v.isBlankValue('blank'));
    return blank ? fallback : input;
  });

  /* -------- cart helpers -------- */
  reg('item_count_for_variant', (cart, variantId) => {
    const items = ((toValue(cart) as { items?: { variant_id: number; quantity: number }[] })?.items ?? []) as { variant_id: number; quantity: number }[];
    return items.filter((i) => Number(i.variant_id) === Number(toValue(variantId))).reduce((s, i) => s + i.quantity, 0);
  });
  reg('line_items_for', (cart, obj) => {
    const items = ((toValue(cart) as { items?: unknown[] })?.items ?? []) as { product_id: number; variant_id: number }[];
    const o = toValue(obj) as { id?: number; variants?: unknown } | null;
    if (!o) return [];
    return items.filter((i) => (o.variants ? i.product_id === o.id : i.variant_id === o.id));
  });

  /* -------- colours -------- */
  for (const [name, fn] of Object.entries(colorFilters)) reg(name, (input, ...args) => (fn as (...a: unknown[]) => unknown)(toValue(input), ...args.map((a) => toValue(a))));

  /* -------- loud failures for things the emulator doesn't do -------- */
  for (const name of ['font_face', 'font_url', 'font_modify', 'shopify_asset_url', 'global_asset_url', 'customer_login_link', 'avatar', 'login_button']) {
    reg(name, () => {
      throw new Error(`filter "${name}" is not supported by the local emulator`);
    });
  }
}
