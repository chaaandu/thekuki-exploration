/**
 * 2D aroma bursts (DOM + inline SVG), positioned as a pure function of time so they can be
 * seeked frame by frame. Transform/opacity only. Coordinates are in "jar units": the jar
 * art box is 140 × 190 and the jar mouth is at (70, 36).
 */
import type { Aroma } from '../shelf-core/types.ts';

const SHAPES = {
  leaf: '<svg viewBox="-6 -3 12 6"><path d="M-6 0Q0-3.6 6 0Q0 3.6-6 0Z" fill="#2f5323"/><path d="M-5 0H5" stroke="#5a8a3c" stroke-width=".6"/></svg>',
  seed: '<svg viewBox="-2 -1.2 4 2.4"><ellipse rx="1.9" ry="1" fill="#7a6a3a"/></svg>',
  petal: '<svg viewBox="-5 -5 10 10"><path d="M0-5C4.2-3 4.2 3 0 5C-4.2 3-4.2-3 0-5Z" fill="#e58aa5"/><path d="M0-3.5V3.5" stroke="#f3b9ca" stroke-width=".6"/></svg>',
  crumb: '<svg viewBox="-2 -2 4 4"><path d="M-1.6-.4L-.2-1.7 1.6-.8 1.2 1.4-1 1.5Z" fill="#8fae4a"/></svg>',
  berry: '<svg viewBox="-4 -4 8 8"><circle r="3.6" fill="#2b2654"/><circle cx="-1.2" cy="-1.3" r="1" fill="#8a85c6" opacity=".7"/></svg>',
  dust: '<svg viewBox="-2 -2 4 4"><circle r="1.3" fill="#8a5a36"/></svg>',
  ribbon: '<svg viewBox="0 0 40 90"><path d="M20 90C2 72 38 60 20 44S4 18 22 4" fill="none" stroke="#5a3218" stroke-width="7" stroke-linecap="round"/><path d="M20 90C2 72 38 60 20 44S4 18 22 4" fill="none" stroke="#a8724a" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>',
} as const;

type ShapeName = keyof typeof SHAPES;

interface Particle {
  shape: ShapeName;
  size: number;
  /** returns x, y (jar units, y up from the mouth), rotation (deg), opacity for time t (s) */
  at(t: number): [number, number, number, number];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t: number, life: number) => (t < 0 ? 0 : t < 0.12 ? t / 0.12 : t > life ? 0 : 1 - Math.max(0, (t - life * 0.6) / (life * 0.4)));

export function particlesFor(aroma: Aroma, seed: number): Particle[] {
  const r = rng(seed);
  const out: Particle[] = [];
  const delay = () => r() * 0.25;
  switch (aroma) {
    case 'curry_leaf':
      for (let i = 0; i < 16; i++) {
        const d = delay(), vx = (r() - 0.5) * 110, vy = 95 + r() * 80, sway = 10 + r() * 14, spin = (r() - 0.5) * 540, life = 1.15 + r() * 0.3;
        out.push({ shape: 'leaf', size: 20 + r() * 9, at: (t) => { const s = t - d; return [vx * s + Math.sin(s * 7) * sway, vy * s - 26 * s * s, spin * s, fade(s, life)]; } });
      }
      break;
    case 'carom_seed':
      for (let i = 0; i < 30; i++) {
        const d = delay() * 0.6, vx = (r() - 0.5) * 150, vy = 150 + r() * 130, spin = (r() - 0.5) * 900, life = 0.85 + r() * 0.4;
        out.push({ shape: 'seed', size: 8 + r() * 3, at: (t) => { const s = t - d; return [vx * s, vy * s - 240 * s * s, spin * s, fade(s, life)]; } });
      }
      break;
    case 'rose_petal':
      for (let i = 0; i < 12; i++) {
        const d = delay(), vx = (r() - 0.5) * 90, vy = 75 + r() * 55, sway = 16 + r() * 12, spin = (r() - 0.5) * 300, life = 1.25 + r() * 0.2;
        out.push({ shape: 'petal', size: 17 + r() * 7, at: (t) => { const s = t - d; return [vx * s + Math.sin(s * 4 + i) * sway, vy * s - 12 * s * s, spin * s, fade(s, life)]; } });
      }
      for (let i = 0; i < 16; i++) {
        const d = delay(), vx = (r() - 0.5) * 100, vy = 90 + r() * 60, spin = (r() - 0.5) * 600, life = 0.95;
        out.push({ shape: 'crumb', size: 8 + r() * 3, at: (t) => { const s = t - d; return [vx * s, vy * s - 200 * s * s, spin * s, fade(s, life)]; } });
      }
      break;
    case 'blueberry':
      for (let i = 0; i < 4; i++) {
        const d = i * 0.08, side = i % 2 ? 1 : -1, vx = side * (35 + r() * 30), vy = 110 + r() * 50, life = 1.3;
        out.push({
          shape: 'berry',
          size: 15 + r() * 3,
          at: (t) => {
            const s = t - d;
            let y = vy * s - 330 * s * s;
            // land on the shelf (jar mouth is ~150 units above it)
            if (y < -150) y = -150 + Math.abs(Math.sin(s * 9)) * 6 * Math.max(0, 1 - s);
            return [vx * s, y, s * 520 * side, fade(s, life)];
          },
        });
      }
      break;
    case 'malt_dust':
      for (let i = 0; i < 48; i++) {
        const d = r() * 0.4, a0 = r() * Math.PI * 2, rad = 12 + r() * 34, rise = 70 + r() * 70, life = 1.05 + r() * 0.3;
        out.push({ shape: 'dust', size: 5 + r() * 4, at: (t) => { const s = t - d; const a = a0 + s * 5; return [Math.cos(a) * rad * (0.6 + s), rise * s, 0, fade(s, life) * 0.8]; } });
      }
      break;
    case 'hazelnut_ribbon':
      out.push({ shape: 'ribbon', size: 44, at: (t) => [0, 30 + t * 10, Math.sin(t * 3) * 6, fade(t, 1.3)] });
      break;
  }
  return out;
}

export class AromaLayer {
  #el: HTMLElement;
  #nodes: HTMLElement[] = [];
  #particles: Particle[] = [];
  #aroma: Aroma | null;

  constructor(host: HTMLElement, aroma: Aroma | null, seed: number) {
    this.#aroma = aroma;
    this.#el = document.createElement('span');
    this.#el.className = 'jar__aroma';
    this.#el.setAttribute('aria-hidden', 'true');
    host.append(this.#el);
    if (aroma) this.#particles = particlesFor(aroma, seed);
  }

  #build() {
    if (this.#nodes.length || !this.#aroma) return;
    for (const p of this.#particles) {
      const n = document.createElement('span');
      n.className = `jar__particle jar__particle--${p.shape}`;
      n.style.width = n.style.height = `${(p.size / 140) * 100}cqi`;
      n.innerHTML = SHAPES[p.shape];
      this.#el.append(n);
      this.#nodes.push(n);
    }
  }

  /** t = seconds since the burst began, or < 0 to hide. */
  render(t: number) {
    if (t < 0) {
      if (this.#el.dataset.on) {
        delete this.#el.dataset.on;
        for (const n of this.#nodes) n.style.opacity = '0';
      }
      return;
    }
    this.#build();
    this.#el.dataset.on = '';
    this.#particles.forEach((p, i) => {
      const [x, y, rot, o] = p.at(t);
      const n = this.#nodes[i]!;
      // jar units → % of the jar width (cqi): 1 unit = 100/140 cqi
      n.style.transform = `translate(${(x / 140) * 100}cqi, ${(-y / 140) * 100}cqi) rotate(${rot}deg)`;
      n.style.opacity = String(Math.max(0, Math.min(1, o)));
    });
  }

  destroy() {
    this.#el.remove();
  }
}
