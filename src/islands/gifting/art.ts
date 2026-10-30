/**
 * Everything drawn for the gift box lives here, shared by the 3D box, the flat fallback and
 * the PNG mockup: logo clean-up (in the browser only; the file never leaves the device) and
 * the lid / sleeve face textures.
 */

export interface BoxLook {
  box: string;
  sleeve: string;
  sleeveInk: string;
  sleeveText: string;
  boxText: string;
}

/** Box proportions in mm-ish units: width (x), base height (y), depth (z). */
export const BOX = { w: 240, h: 80, d: 160, lid: 28, sleeve: 46 };

const MAX_LOGO = 1024;
export const MAX_BYTES = 10 * 1024 * 1024;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // A decoded image stays drawable after its object URL is revoked.
    URL.revokeObjectURL(url);
  }
}

/**
 * Draw the logo onto a canvas (max 1024px), optionally knock out a near-white background
 * with a soft edge, then trim empty margins so it centres properly on the box.
 */
export async function prepareLogo(file: File, knockout: boolean): Promise<HTMLCanvasElement> {
  const img = await decode(file);
  const iw = img.naturalWidth || 512;
  const ih = img.naturalHeight || 512;
  const scale = Math.min(1, MAX_LOGO / Math.max(iw, ih));
  const c = canvas(iw * scale, ih * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);

  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  let minX = c.width,
    minY = c.height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (knockout) {
        const lightest = Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
        if (lightest > 214) {
          // 215 → keep, 240+ → gone; in between fades so edges stay smooth.
          const keep = Math.max(0, Math.min(1, (240 - lightest) / 25));
          px[i + 3] = Math.round(px[i + 3]! * keep);
        }
      }
      if (px[i + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('empty');
  ctx.putImageData(data, 0, 0);
  const pad = 2;
  const tw = maxX - minX + 1 + pad * 2;
  const th = maxY - minY + 1 + pad * 2;
  const out = canvas(tw, th);
  out.getContext('2d')!.drawImage(c, minX - pad, minY - pad, tw, th, 0, 0, tw, th);
  return out;
}

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** A little paper grain so a flat colour reads as card, not plastic. Deterministic. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.save();
  for (let i = 0; i < (w * h) / 900; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(40,18,6,0.06)';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.restore();
}

function fit(logo: HTMLCanvasElement, maxW: number, maxH: number) {
  const s = Math.min(maxW / logo.width, maxH / logo.height);
  return { w: logo.width * s, h: logo.height * s };
}

/** Lid top: box colour, logo centred (or the "your logo here" note before one is added). */
export function lidTexture(look: BoxLook, logo: HTMLCanvasElement | null, px = 1024): HTMLCanvasElement {
  const c = canvas(px, (px * BOX.d) / BOX.w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = look.box;
  ctx.fillRect(0, 0, c.width, c.height);
  grain(ctx, c.width, c.height);
  // A pressed border, like a printed keyline.
  ctx.strokeStyle = 'rgba(40,18,6,0.18)';
  ctx.lineWidth = c.width * 0.006;
  const inset = c.width * 0.04;
  ctx.strokeRect(inset, inset, c.width - inset * 2, c.height - inset * 2);
  if (logo) {
    const { w, h } = fit(logo, c.width * 0.62, c.height * 0.62);
    ctx.drawImage(logo, (c.width - w) / 2, (c.height - h) / 2, w, h);
  } else {
    ctx.setLineDash([c.width * 0.02, c.width * 0.014]);
    ctx.strokeStyle = 'rgba(40,18,6,0.45)';
    ctx.lineWidth = c.width * 0.004;
    const bw = c.width * 0.5;
    const bh = c.height * 0.42;
    ctx.strokeRect((c.width - bw) / 2, (c.height - bh) / 2, bw, bh);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(40,18,6,0.7)';
    ctx.font = `700 ${Math.round(c.width * 0.05)}px ${cssVar('--font-hand', 'cursive')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(look.boxText, c.width / 2, c.height / 2);
  }
  return c;
}

/** Sleeve front/back: sleeve colour, logo on the left, the sleeve line on the right. */
export function sleeveTexture(look: BoxLook, logo: HTMLCanvasElement | null, length: number, px = 1024): HTMLCanvasElement {
  const c = canvas(px, (px * BOX.sleeve) / length);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = look.sleeve;
  ctx.fillRect(0, 0, c.width, c.height);
  grain(ctx, c.width, c.height);
  const pad = c.height * 0.16;
  if (logo) {
    const { w, h } = fit(logo, c.width * 0.36, c.height - pad * 2);
    ctx.drawImage(logo, c.width * 0.06, (c.height - h) / 2, w, h);
  }
  if (look.sleeveText) {
    ctx.fillStyle = look.sleeveInk;
    ctx.font = `400 ${Math.round(c.height * 0.3)}px ${cssVar('--font-display', 'serif')}`;
    ctx.textAlign = logo ? 'right' : 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(look.sleeveText, logo ? c.width * 0.94 : c.width / 2, c.height / 2 + c.height * 0.03);
  }
  return c;
}

export function plainTexture(colour: string, w = 64, h = 64): HTMLCanvasElement {
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/** Darken/lighten a hex colour for the flat drawing's shaded faces. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r} ${g} ${b})`;
}
