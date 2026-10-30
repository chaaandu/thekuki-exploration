/**
 * The 2D shelf: animates the DOM jar art (inline SVG lid over the cached jar body).
 * Twisting = the lid rises along the thread while its ridges slide (reads as rotation);
 * then it pops, tips back, the aroma bursts and one cookie lifts out. Transform/opacity only.
 */
import type { JarPose } from '../shelf-core/timeline.ts';
import type { JarInfo, ShelfRenderer } from '../shelf-core/types.ts';
import { AromaLayer } from './aroma2d.ts';

interface Parts {
  lid: SVGGElement | null;
  ridges: SVGElement | null;
  cookie: HTMLImageElement | null;
  aroma: AromaLayer;
  art: HTMLElement;
}

const GROOVE = (Math.PI * 2) / 48; // one ridge per groove
const RIDGE_PERIOD = 4; // svg units between ridges

export class Renderer2D implements ShelfRenderer {
  readonly kind = '2d' as const;
  #jars: JarInfo[];
  #parts: Parts[];

  constructor(jars: JarInfo[]) {
    this.#jars = jars;
    this.#parts = jars.map((j, i) => ({
      lid: j.art.querySelector<SVGGElement>('.jar-art__lid-group'),
      ridges: j.art.querySelector<SVGElement>('.jar-art__ridges'),
      cookie: null,
      aroma: new AromaLayer(j.art, j.aroma, 101 + i * 17),
      art: j.art,
    }));
  }

  #cookie(i: number): HTMLImageElement | null {
    const p = this.#parts[i]!;
    if (p.cookie) return p.cookie;
    const body = p.art.querySelector<HTMLImageElement>('.jar-art__body');
    if (!body) return null;
    const img = document.createElement('img');
    img.className = 'jar__cookie';
    img.alt = '';
    img.decoding = 'async';
    img.src = body.src.replace(/jar-([a-z_]+)\.svg/, 'cookie-$1.svg');
    img.setAttribute('aria-hidden', 'true');
    p.art.append(img);
    p.cookie = img;
    return img;
  }

  apply(i: number, pose: JarPose) {
    const p = this.#parts[i];
    if (!p) return;
    const turns = Math.min(pose.twist / (Math.PI * 2), 1.5);
    const rise = turns * 2.6 + pose.pop * 11;
    if (p.lid) {
      const tilt = pose.tilt;
      p.lid.style.transform = `translate(${-30 * tilt}px, ${-(rise + 12 * tilt)}px) rotate(${-28 * tilt}deg)`;
    }
    if (p.ridges) {
      const x = -(((pose.twist / GROOVE) * RIDGE_PERIOD) % (RIDGE_PERIOD * 2));
      p.ridges.style.transform = `translateX(${x}px)`;
    }
    p.art.dataset.open = pose.pop > 0.5 ? 'true' : 'false';
    if (pose.reveal > 0.001) {
      const c = this.#cookie(i);
      if (c) {
        const r = pose.reveal;
        c.style.opacity = String(Math.min(1, r * 3));
        c.style.transform = `translate(-50%, ${-80 * r}%) rotateX(${(1 - r) * 72}deg) rotateY(${Math.sin(pose.spin) * 18}deg) scale(${0.62 + 0.5 * r})`;
      }
    } else if (p.cookie) {
      p.cookie.style.opacity = '0';
    }
    p.aroma.render(pose.aroma);
  }

  setSize(i: number, size: 0 | 1) {
    this.#jars[i]?.el.style.setProperty('--jar-scale', size ? '1.12' : '1');
  }

  hover() {}

  layout() {}

  destroy() {
    this.#parts.forEach((p) => {
      p.aroma.destroy();
      p.cookie?.remove();
      if (p.lid) p.lid.style.transform = '';
      if (p.ridges) p.ridges.style.transform = '';
    });
  }
}
