/**
 * One Twist & send frame as a pure function of time: the flavour's jar on the bakery shelf
 * twists open (the same choreography as the shelf, from shelf-core/timeline), its aroma
 * bursts, a cookie lifts out, a paper tag swings with "For ___", then the Kuki end card.
 */
import { FULL_TWIST, openPose, OPEN, quarters } from '../shelf-core/timeline.ts';
import type { Aroma } from '../shelf-core/types.ts';
import { particlesFor, SHAPES, type Particle, type ShapeName } from '../shelf2d/aroma2d.ts';

export interface Flavour {
  handle: string;
  tag: string;
  colour: string | null;
  form: string | null;
  aroma: Aroma | null;
  memory: string | null;
}

export interface SceneText {
  forLine: string;
  endLine: string;
  strap: string;
}

export interface Assets {
  body: HTMLImageElement;
  cookie: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  shapes: Partial<Record<ShapeName, HTMLImageElement>>;
  particles: Particle[];
}

export const FPS = 30;
const INTRO = 0.45;
const END_FADE = 3.9;
export const DURATION = 5.4;

/** Sound cues (seconds) for the offline mix: the same moments the shelf clicks and pops. */
export function cues(): { name: 'click' | 'pop' | 'whoosh' | 'stamp'; at: number }[] {
  const out: { name: 'click' | 'pop' | 'whoosh' | 'stamp'; at: number }[] = [];
  let last = 0;
  for (let t = 0; t < OPEN.twistEnd; t += 1 / 240) {
    const q = quarters(openPose(t).twist);
    if (q > last && q * (Math.PI / 2) < FULL_TWIST) out.push({ name: 'click', at: INTRO + t });
    last = q;
  }
  out.push({ name: 'pop', at: INTRO + OPEN.popStart }, { name: 'whoosh', at: INTRO + OPEN.aromaStart }, { name: 'stamp', at: END_FADE + 0.35 });
  return out;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${src}`));
    img.src = src;
  });
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" '))}`;

/** Theme asset URL next to a known built asset (asset_url keeps every file in one folder). */
export function asset(name: string): string {
  const known = window.KUKI?.assets?.shelf2d ?? '';
  return known.replace(/island-shelf2d\.js(\?.*)?$/, (_m, q: string | undefined) => `${name}${q ?? ''}`);
}

export async function loadAssets(f: Flavour): Promise<Assets> {
  const form = f.form ?? 'empty';
  const particles = f.aroma ? particlesFor(f.aroma, 211) : [];
  const used = [...new Set(particles.map((p) => p.shape))];
  const [body, cookie, logo, ...shapeImgs] = await Promise.all([
    load(asset(`jar-${form}.svg`)),
    form === 'empty' ? Promise.resolve(null) : load(asset(`cookie-${form}.svg`)).catch(() => null),
    load(asset('kuki-logo-280.webp')).catch(() => null),
    ...used.map((s) => load(svgUrl(SHAPES[s]))),
  ]);
  const shapes: Assets['shapes'] = {};
  used.forEach((s, i) => (shapes[s] = shapeImgs[i]));
  await Promise.all(
    ['400 64px "Rozha One"', '700 64px Kalam', '400 40px Mukta', '600 40px Mukta'].map((font) => document.fonts?.load(font).catch(() => [])),
  );
  return { body, cookie, logo, shapes, particles };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

const PAPER = '#fbf4e6';
const INK = '#3b1a0c';
const INK_2 = '#5e3a26';
const WOOD = '#b98a5c';
const WOOD_EDGE = '#8f6439';

const FONT = {
  display: '"Rozha One", Georgia, serif',
  hand: 'Kalam, "Bradley Hand", cursive',
  ui: 'Mukta, system-ui, sans-serif',
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    lines[maxLines - 1] = lines[maxLines - 1]!.replace(/\s*\S*$/, '…');
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The lid in jar units (140 × 190 art box), as the 2D shelf's SVG lid draws it. */
function drawLid(ctx: CanvasRenderingContext2D, colour: string, twist: number) {
  roundRect(ctx, 28, 8, 84, 30, 6);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const offset = -(((twist / ((Math.PI * 2) / 48)) * 4) % 8);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 28 + offset; x < 116; x += 4) ctx.fillRect(x, 8, 1.6, 30);
  ctx.restore();
  roundRect(ctx, 28, 8, 84, 30, 6);
  ctx.strokeStyle = 'rgba(42,18,7,0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  roundRect(ctx, 28, 31, 84, 7, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();
  roundRect(ctx, 32, 11, 76, 5, 2.5);
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fill();
}

export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, f: Flavour, a: Assets, text: SceneText) {
  const story = H / W > 1.3;
  const u = W / 1080; // layout unit
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Afternoon light on the back wall, falling from the window at top left.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const light = ctx.createLinearGradient(0, 0, W, H * 0.7);
  light.addColorStop(0, 'rgba(255,236,200,0.75)');
  light.addColorStop(0.55, 'rgba(255,236,200,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  // Wooden shelf.
  const shelfY = story ? H * 0.775 : H * 0.8;
  ctx.fillStyle = WOOD;
  ctx.fillRect(0, shelfY, W, H - shelfY);
  ctx.fillStyle = WOOD_EDGE;
  ctx.fillRect(0, shelfY + 26 * u, W, 8 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, shelfY, W, 4 * u);

  // Flavour name + (story format) its memory line.
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${Math.round((story ? 112 : 96) * u)}px ${FONT.display}`;
  const titleY = story ? H * 0.13 : H * 0.11;
  ctx.fillText(f.tag, W / 2, titleY, W - 120 * u);
  if (story && f.memory) {
    ctx.fillStyle = INK_2;
    ctx.font = `400 ${Math.round(52 * u)}px ${FONT.ui}`;
    wrap(ctx, f.memory, W - 180 * u, 3).forEach((line, i) => ctx.fillText(line, W / 2, titleY + (84 + i * 64) * u));
  }

  // The jar, standing on the shelf.
  const k = (story ? H * 0.42 : H * 0.44) / 190;
  const jx = W / 2 - 70 * k;
  const jy = shelfY - 180 * k;
  const pose = t < INTRO ? openPose(0) : openPose(t - INTRO);

  // Contact shadow.
  ctx.save();
  ctx.fillStyle = 'rgba(42,18,7,0.25)';
  ctx.filter = `blur(${8 * u}px)`;
  ctx.beginPath();
  ctx.ellipse(W / 2, shelfY + 4 * u, 62 * k, 7 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(jx, jy);
  ctx.scale(k, k);
  ctx.drawImage(a.body, 0, 0, 140, 190);

  // Cookie lifting out (behind the lid, in front of the jar).
  if (a.cookie && pose.reveal > 0.001) {
    const r = pose.reveal;
    const cw = 140 * 0.52;
    const ch = cw * (a.cookie.naturalHeight / a.cookie.naturalWidth || 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, r * 3);
    ctx.translate(70, 190 * 0.06 + ch - 0.8 * ch * r);
    const s = 0.62 + 0.5 * r;
    ctx.scale(s * Math.cos(Math.sin(pose.spin) * 0.31), s * Math.cos((1 - r) * 1.26));
    ctx.shadowColor = 'rgba(59,26,12,0.35)';
    ctx.shadowBlur = 10 * k;
    ctx.shadowOffsetY = 8 * k;
    ctx.drawImage(a.cookie, -cw / 2, -ch, cw, ch);
    ctx.restore();
  }

  // Lid: rises along the thread, pops, tips back onto its rim (origin 32,34 like the SVG).
  const turns = Math.min(pose.twist / (Math.PI * 2), 1.5);
  const rise = turns * 2.6 + pose.pop * 11;
  ctx.save();
  ctx.translate(32, 34);
  ctx.translate(-30 * pose.tilt, -(rise + 12 * pose.tilt));
  ctx.rotate((-28 * pose.tilt * Math.PI) / 180);
  ctx.translate(-32, -34);
  drawLid(ctx, f.colour ?? '#c89b68', pose.twist);
  ctx.restore();

  // Aroma, from the jar mouth (70, 36).
  if (pose.aroma >= 0) {
    for (const p of a.particles) {
      const img = a.shapes[p.shape];
      if (!img) continue;
      const [x, y, rot, o] = p.at(pose.aroma);
      if (o <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, o);
      ctx.translate(70 + x, 36 - y);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, -p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }
  ctx.restore();

  // Paper tag on a string from the jar neck, swinging gently: "For ___".
  if (text.forLine) {
    const swing = Math.sin(t * 2.2) * 0.05 * Math.max(0.2, 1 - t / 4);
    const ax = jx + 116 * k;
    const ay = jy + 46 * k;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(0.12 + swing);
    ctx.font = `700 ${Math.round(58 * u)}px ${FONT.hand}`;
    const tw = Math.max(220 * u, ctx.measureText(text.forLine).width + 80 * u);
    const th = 112 * u;
    const drop = 70 * u;
    ctx.strokeStyle = '#7a5a46';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(30 * u, drop);
    ctx.stroke();
    ctx.shadowColor = 'rgba(59,26,12,0.25)';
    ctx.shadowBlur = 14 * u;
    ctx.shadowOffsetY = 6 * u;
    ctx.fillStyle = '#fffaf1';
    ctx.beginPath();
    // Tag with clipped top corners and a punched hole.
    const x0 = 30 * u - 40 * u;
    const y0 = drop;
    ctx.moveTo(x0 + 26 * u, y0);
    ctx.lineTo(x0 + tw, y0);
    ctx.lineTo(x0 + tw, y0 + th);
    ctx.lineTo(x0, y0 + th);
    ctx.lineTo(x0, y0 + 26 * u);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(30 * u, drop + 18 * u, 7 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText(text.forLine, x0 + 34 * u, y0 + th * 0.7);
    ctx.restore();
  }

  if (text.strap) {
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = `400 ${Math.round(56 * u)}px ${FONT.display}`;
    ctx.fillText(text.strap, W / 2, story ? H * 0.885 : H * 0.93);
  }

  // End card.
  const e = ease(clamp01((t - END_FADE) / 0.45));
  if (e > 0) {
    ctx.globalAlpha = e;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(0, (1 - e) * 24 * u);
    if (a.logo) {
      const lw = 460 * u;
      const lh = lw * (a.logo.naturalHeight / a.logo.naturalWidth);
      ctx.drawImage(a.logo, (W - lw) / 2, H / 2 - lh - 30 * u, lw, lh);
    }
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = `400 ${Math.round(60 * u)}px ${FONT.display}`;
    ctx.fillText(text.endLine, W / 2, H / 2 + 80 * u, W - 120 * u);
    if (text.forLine) {
      ctx.font = `700 ${Math.round(50 * u)}px ${FONT.hand}`;
      ctx.fillStyle = INK_2;
      ctx.fillText(text.forLine, W / 2, H / 2 + 170 * u, W - 120 * u);
    }
  }
  ctx.restore();
}
