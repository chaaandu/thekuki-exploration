// Colour parsing, Shopify's colour drop and colour filters.
import { BaseDrop } from './drop-base.ts';
import { LiquidFloat, rubyFloatToString } from './numbers.ts';

export interface Rgba {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

type ColorFormat = 'hex' | 'rgb' | 'hsl';

interface ParsedColor extends Rgba {
  format: ColorFormat;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  transparent: '#00000000',
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseNumberToken(token: string, scale: number): number {
  const t = token.trim();
  if (t.endsWith('%')) return (Number.parseFloat(t) / 100) * scale;
  return Number.parseFloat(t);
}

export function parseColor(input: unknown): ParsedColor | null {
  if (input instanceof ColorDrop) return { ...input.rgbaValue(), format: 'hex' };
  if (input === null || input === undefined) return null;
  let str = String(input).trim().toLowerCase();
  if (str === '') return null;
  const named = NAMED[str];
  if (named) str = named;
  let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(str);
  if (m && (str.startsWith('#') || named)) {
    let hex = m[1] as string;
    if (hex.length <= 4) hex = hex.split('').map((c) => c + c).join('');
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a: Math.round(a * 1000) / 1000, format: 'hex' };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(str);
  if (m) {
    const body = (m[1] as string).replace('/', ',');
    const parts = body.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const r = clamp(Math.round(parseNumberToken(parts[0] as string, 255)), 0, 255);
    const g = clamp(Math.round(parseNumberToken(parts[1] as string, 255)), 0, 255);
    const b = clamp(Math.round(parseNumberToken(parts[2] as string, 255)), 0, 255);
    const a = parts[3] !== undefined ? clamp(parseNumberToken(parts[3], 1), 0, 1) : 1;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a, format: 'rgb' };
  }
  m = /^hsla?\(([^)]*)\)$/.exec(str);
  if (m) {
    const body = (m[1] as string).replace('/', ',');
    const parts = body.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = Number.parseFloat(parts[0] as string);
    const s = Number.parseFloat(parts[1] as string);
    const l = Number.parseFloat(parts[2] as string);
    const a = parts[3] !== undefined ? clamp(parseNumberToken(parts[3], 1), 0, 1) : 1;
    if ([h, s, l, a].some((n) => Number.isNaN(n))) return null;
    return { ...hslToRgb(h, s, l), a, format: 'hsl' };
  }
  return null;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hn + 1 / 3) * 255),
    g: Math.round(hue(hn) * 255),
    b: Math.round(hue(hn - 1 / 3) * 255),
  };
}

function hex2(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

function alphaString(a: number): string {
  return rubyFloatToString(Math.round(a * 1000) / 1000).replace(/\.0$/, '');
}

export function toHex(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

export function toRgbString(c: Rgba): string {
  if (c.a < 1) return `rgba(${c.r}, ${c.g}, ${c.b}, ${alphaString(c.a)})`;
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

export function toHslString(c: Rgba): string {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  if (c.a < 1) return `hsla(${h}, ${s}%, ${l}%, ${alphaString(c.a)})`;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function formatLike(c: Rgba, format: ColorFormat): string {
  if (c.a < 1) return format === 'hsl' ? toHslString(c) : toRgbString(c);
  if (format === 'rgb') return toRgbString(c);
  if (format === 'hsl') return toHslString(c);
  return toHex(c);
}

function requireColor(input: unknown, filter: string): ParsedColor {
  const c = parseColor(input);
  if (!c) throw new Error(`${filter}: invalid color ${JSON.stringify(String(input ?? ''))}`);
  return c;
}

/** Shopify colour drop: `{{ settings.colour }}` prints `#rrggbb`. */
export class ColorDrop extends BaseDrop {
  #c: Rgba;

  constructor(c: Rgba) {
    super();
    this.#c = c;
  }

  static from(value: unknown): ColorDrop | null {
    const c = parseColor(value);
    return c ? new ColorDrop(c) : null;
  }

  rgbaValue(): Rgba {
    return { ...this.#c };
  }

  get red(): number {
    return this.#c.r;
  }

  get green(): number {
    return this.#c.g;
  }

  get blue(): number {
    return this.#c.b;
  }

  get alpha(): LiquidFloat {
    return new LiquidFloat(this.#c.a);
  }

  get hue(): number {
    return rgbToHsl(this.#c.r, this.#c.g, this.#c.b).h;
  }

  get saturation(): number {
    return rgbToHsl(this.#c.r, this.#c.g, this.#c.b).s;
  }

  get lightness(): number {
    return rgbToHsl(this.#c.r, this.#c.g, this.#c.b).l;
  }

  get rgb(): string {
    return `${this.#c.r} ${this.#c.g} ${this.#c.b}`;
  }

  get rgba(): string {
    return `${this.#c.r} ${this.#c.g} ${this.#c.b} / ${rubyFloatToString(this.#c.a)}`;
  }

  override toString(): string {
    if (this.#c.a < 1) return toRgbString(this.#c);
    return toHex(this.#c);
  }

  override toJSON(): string {
    return this.toString();
  }

  override identity(): unknown {
    return `color:${this.toString()}`;
  }

  override equals(other: unknown): boolean {
    if (typeof other === 'string') {
      const c = parseColor(other);
      return c !== null && toRgbString(c) === toRgbString(this.#c);
    }
    return super.equals(other);
  }
}

// ---- filters ----------------------------------------------------------------------------

function luminance(c: Rgba): number {
  const ch = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function brightness(c: Rgba): number {
  return (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export const colorFilters = {
  color_to_rgb(input: unknown): string {
    return toRgbString(requireColor(input, 'color_to_rgb'));
  },
  color_to_hsl(input: unknown): string {
    return toHslString(requireColor(input, 'color_to_hsl'));
  },
  color_to_hex(input: unknown): string {
    return toHex(requireColor(input, 'color_to_hex'));
  },
  color_extract(input: unknown, component: unknown): number | LiquidFloat {
    const c = requireColor(input, 'color_extract');
    const hsl = rgbToHsl(c.r, c.g, c.b);
    switch (String(component)) {
      case 'red':
        return c.r;
      case 'green':
        return c.g;
      case 'blue':
        return c.b;
      case 'alpha':
        return new LiquidFloat(c.a);
      case 'hue':
        return hsl.h;
      case 'saturation':
        return hsl.s;
      case 'lightness':
        return hsl.l;
      default:
        throw new Error(`color_extract: unknown component ${JSON.stringify(component)}`);
    }
  },
  color_modify(input: unknown, component: unknown, value: unknown): string {
    const c = requireColor(input, 'color_modify');
    const v = Number(value);
    if (!Number.isFinite(v)) throw new Error('color_modify: value must be a number');
    const out: Rgba = { r: c.r, g: c.g, b: c.b, a: c.a };
    const hsl = rgbToHsl(c.r, c.g, c.b);
    switch (String(component)) {
      case 'red':
        out.r = clamp(Math.round(v), 0, 255);
        break;
      case 'green':
        out.g = clamp(Math.round(v), 0, 255);
        break;
      case 'blue':
        out.b = clamp(Math.round(v), 0, 255);
        break;
      case 'alpha':
        out.a = clamp(v, 0, 1);
        break;
      case 'hue':
        Object.assign(out, hslToRgb(clamp(v, 0, 360), hsl.s, hsl.l));
        break;
      case 'saturation':
        Object.assign(out, hslToRgb(hsl.h, clamp(v, 0, 100), hsl.l));
        break;
      case 'lightness':
        Object.assign(out, hslToRgb(hsl.h, hsl.s, clamp(v, 0, 100)));
        break;
      default:
        throw new Error(`color_modify: unknown component ${JSON.stringify(component)}`);
    }
    return formatLike(out, c.format);
  },
  color_lighten(input: unknown, amount: unknown): string {
    const c = requireColor(input, 'color_lighten');
    const hsl = rgbToHsl(c.r, c.g, c.b);
    return formatLike({ ...hslToRgb(hsl.h, hsl.s, clamp(hsl.l + Number(amount), 0, 100)), a: c.a }, c.format);
  },
  color_darken(input: unknown, amount: unknown): string {
    const c = requireColor(input, 'color_darken');
    const hsl = rgbToHsl(c.r, c.g, c.b);
    return formatLike({ ...hslToRgb(hsl.h, hsl.s, clamp(hsl.l - Number(amount), 0, 100)), a: c.a }, c.format);
  },
  color_saturate(input: unknown, amount: unknown): string {
    const c = requireColor(input, 'color_saturate');
    const hsl = rgbToHsl(c.r, c.g, c.b);
    return formatLike({ ...hslToRgb(hsl.h, clamp(hsl.s + Number(amount), 0, 100), hsl.l), a: c.a }, c.format);
  },
  color_desaturate(input: unknown, amount: unknown): string {
    const c = requireColor(input, 'color_desaturate');
    const hsl = rgbToHsl(c.r, c.g, c.b);
    return formatLike({ ...hslToRgb(hsl.h, clamp(hsl.s - Number(amount), 0, 100), hsl.l), a: c.a }, c.format);
  },
  color_mix(input: unknown, other: unknown, weight: unknown): string {
    const a = requireColor(input, 'color_mix');
    const b = requireColor(other, 'color_mix');
    const w = clamp(Number(weight ?? 50), 0, 100) / 100;
    const mixed: Rgba = {
      r: Math.round(a.r * w + b.r * (1 - w)),
      g: Math.round(a.g * w + b.g * (1 - w)),
      b: Math.round(a.b * w + b.b * (1 - w)),
      a: round(a.a * w + b.a * (1 - w), 3),
    };
    return formatLike(mixed, a.format);
  },
  color_brightness(input: unknown): LiquidFloat {
    return new LiquidFloat(round(brightness(requireColor(input, 'color_brightness')), 2));
  },
  color_contrast(input: unknown, other: unknown): LiquidFloat {
    const l1 = luminance(requireColor(input, 'color_contrast'));
    const l2 = luminance(requireColor(other, 'color_contrast'));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return new LiquidFloat(round(ratio, 1));
  },
  color_difference(input: unknown, other: unknown): number {
    const a = requireColor(input, 'color_difference');
    const b = requireColor(other, 'color_difference');
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  },
  brightness_difference(input: unknown, other: unknown): number {
    const a = requireColor(input, 'brightness_difference');
    const b = requireColor(other, 'brightness_difference');
    return Math.round(Math.abs(brightness(a) - brightness(b)));
  },
  hex_to_rgba(input: unknown, alpha: unknown): string {
    const c = requireColor(input, 'hex_to_rgba');
    const a = alpha === undefined || alpha === null ? c.a : clamp(Number(alpha), 0, 1);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alphaString(a)})`;
  },
};
