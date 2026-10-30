/**
 * Shelf island. Mounts on every jar shelf (home hero and product pages):
 * 1. wires the jars to the shared controller with the 2D renderer (works everywhere);
 * 2. on capable devices, loads the 3D shelf after first paint (on intent or idle), waits
 *    for its first frame, crossfades, and hands the jars over without losing state.
 * Product pages twist their jar open once it's on screen.
 */
import { ShelfController } from '../shelf-core/controller.ts';
import type { Aroma, CookieForm, JarInfo, ShelfRenderer } from '../shelf-core/types.ts';
import { Renderer2D } from './renderer2d.ts';
import { check3D } from './tier.ts';
import { reducedMotion } from '../../core/prefs.ts';

interface Shelf3DModule {
  createShelf3D(shelf: HTMLElement, jars: JarInfo[], opts: { dpr: number; lowPower: boolean; onSlow?: () => void }): Promise<ShelfRenderer & { ready: Promise<void> }>;
}

declare global {
  interface Window {
    __kukiShelves?: ShelfController[];
  }
}

function readJars(shelf: HTMLElement): JarInfo[] {
  return Array.from(shelf.querySelectorAll<HTMLElement>('[data-jar]')).map((el, index) => {
    const style = getComputedStyle(el);
    return {
      index,
      el,
      art: el.querySelector<HTMLElement>('.jar-art')!,
      handle: el.dataset.handle ?? '',
      form: (el.dataset.form || 'chunk') as CookieForm,
      aroma: (el.dataset.aroma || null) as Aroma | null,
      colour: style.getPropertyValue('--flavour').trim() || '#c89b68',
      accent: style.getPropertyValue('--accent').trim() || '#c89b68',
    };
  });
}

export function mount(island: HTMLElement) {
  const shelf = island.closest<HTMLElement>('[data-shelf]');
  if (!shelf) return;
  const jars = readJars(shelf).filter((j) => j.art);
  if (!jars.length) return;
  const source = shelf.closest('[data-pdp]') ? 'pdp' : 'shelf';
  const controller = new ShelfController(shelf, jars, new Renderer2D(jars), source);
  (window.__kukiShelves ??= []).push(controller);
  shelf.dataset.tier = '2d';

  let upgraded: (ShelfRenderer & { ready: Promise<void> }) | null = null;
  let destroyed = false;

  const upgrade = async () => {
    const tier = check3D(island.dataset.enable3d !== 'false');
    shelf.dataset.tierReason = tier.reason;
    if (!tier.ok || destroyed) return;
    try {
      const mod = (await import(/* @vite-ignore */ window.KUKI.assets.shelf3d!)) as Shelf3DModule;
      if (destroyed) return;
      const renderer = await mod.createShelf3D(shelf, jars, { dpr: tier.dpr, lowPower: tier.lowPower, onSlow: () => downgrade('slow frames') });
      await renderer.ready;
      if (destroyed) return renderer.destroy();
      // Never swap mid-gesture: wait until every jar is closed.
      while (controller.jars.some((j) => j.phase !== 'closed')) {
        await new Promise((r) => window.setTimeout(r, 400));
        if (destroyed) return renderer.destroy();
      }
      const old = controller.renderer;
      controller.setRenderer(renderer);
      shelf.dataset.tier = '3d';
      shelf.dataset.sweep = '';
      window.setTimeout(() => delete shelf.dataset.sweep, 1300);
      window.setTimeout(() => old.destroy(), 700);
      upgraded = renderer;
    } catch (err) {
      console.warn('[kuki] 3D shelf unavailable, staying 2D', err);
    }
  };

  /** Back to the 2D shelf (reduced motion switched on, or the device can't keep up). */
  const downgrade = (reason: string) => {
    if (!upgraded) return;
    const r = upgraded;
    upgraded = null;
    controller.setRenderer(new Renderer2D(jars));
    shelf.dataset.tier = '2d';
    shelf.dataset.tierReason = reason;
    window.setTimeout(() => r.destroy(), 600);
  };
  const onPrefs = (e: Event) => {
    if ((e as CustomEvent<{ reducedMotion: boolean }>).detail.reducedMotion) downgrade('reduced motion');
  };
  document.addEventListener('kuki:prefs', onPrefs);

  // Load the 3D after first paint: on intent, or when the browser is idle a little later.
  const intentEvents = ['pointerenter', 'touchstart', 'focusin'] as const;
  let scheduled = false;
  const go = () => {
    if (scheduled) return;
    scheduled = true;
    intentEvents.forEach((t) => shelf.removeEventListener(t, go));
    void upgrade();
  };
  intentEvents.forEach((t) => shelf.addEventListener(t, go, { passive: true, once: true }));
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const forced = new URLSearchParams(location.search).get('tier') === '3d';
  if (finePointer || forced) {
    const later = () => (window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 3000 }) : window.setTimeout(go, 1500));
    if (document.readyState === 'complete') window.setTimeout(later, forced ? 0 : 1200);
    else window.addEventListener('load', () => window.setTimeout(later, 1200), { once: true });
  }

  // Product pages: the jar twists open once it's on screen.
  if (shelf.hasAttribute('data-autotwist')) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          window.setTimeout(() => controller.open(0, 'auto'), reducedMotion() ? 0 : 450);
        }
      },
      { threshold: 0.5 },
    );
    io.observe(jars[0]!.el);
  }

  // Keep 3D jars glued to the DOM jars while the phone row scrolls or the window resizes.
  const row = shelf.querySelector<HTMLElement>('[data-shelf-row]');
  let pending = 0;
  const relayout = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      controller.renderer.layout();
    });
  };
  row?.addEventListener('scroll', relayout, { passive: true });
  window.addEventListener('resize', relayout);
  const ro = new ResizeObserver(relayout);
  ro.observe(shelf);

  // Mark the centred jar on phones (shows its "Twist" chip).
  const markCentre = () => {
    if (!row) return;
    const mid = row.getBoundingClientRect().left + row.clientWidth / 2;
    let best: HTMLElement | null = null;
    let dist = Infinity;
    for (const j of jars) {
      const r = j.el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < dist) {
        dist = d;
        best = j.el;
      }
    }
    for (const j of jars) j.el.toggleAttribute('data-centred', j.el === best);
  };
  row?.addEventListener('scroll', () => requestAnimationFrame(markCentre), { passive: true });
  markCentre();

  return () => {
    destroyed = true;
    controller.destroy();
    controller.renderer.destroy();
    upgraded?.destroy();
    ro.disconnect();
    window.removeEventListener('resize', relayout);
    document.removeEventListener('kuki:prefs', onPrefs);
    window.__kukiShelves = window.__kukiShelves?.filter((c) => c !== controller);
  };
}
