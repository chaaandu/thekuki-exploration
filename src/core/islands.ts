/**
 * <kuki-island data-island="name" data-load="eager|idle|visible|intent">
 *
 * Loads an island module (URLs come from window.KUKI.assets, which Liquid fills with
 * cache-busted asset_url values) and calls its mount(element) → unmount function.
 * The markup inside/around an island is always complete and usable without it.
 * Re-mounts when the theme editor reloads a section.
 */

type Unmount = () => void;
interface IslandModule {
  mount(el: HTMLElement): Unmount | void | Promise<Unmount | void>;
}

const loaded = new Map<string, Promise<IslandModule>>();

function importIsland(name: string): Promise<IslandModule> {
  const url = window.KUKI?.assets?.[name];
  if (!url) return Promise.reject(new Error(`Unknown island: ${name}`));
  let p = loaded.get(url);
  if (!p) {
    p = import(/* @vite-ignore */ url) as Promise<IslandModule>;
    loaded.set(url, p);
  }
  return p;
}

const idle = (cb: () => void) =>
  typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 300);

export class KukiIsland extends HTMLElement {
  #unmount: Unmount | null = null;
  #started = false;
  #observer: IntersectionObserver | null = null;

  connectedCallback() {
    const strategy = this.dataset.load ?? 'idle';
    const start = () => this.#start();
    if (strategy === 'eager') start();
    else if (strategy === 'visible') this.#whenVisible(start);
    else if (strategy === 'intent') this.#whenIntent(start);
    else idle(start);
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#unmount?.();
    this.#unmount = null;
  }

  #whenVisible(cb: () => void) {
    const target = (this.closest('section, .shopify-section') as HTMLElement | null) ?? this;
    this.#observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.#observer?.disconnect();
          cb();
        }
      },
      { rootMargin: '200px 0px' },
    );
    this.#observer.observe(target);
  }

  #whenIntent(cb: () => void) {
    const target = (this.closest('section, .shopify-section') as HTMLElement | null) ?? this;
    const go = () => {
      ['pointerenter', 'touchstart', 'focusin'].forEach((t) => target.removeEventListener(t, go));
      cb();
    };
    ['pointerenter', 'touchstart', 'focusin'].forEach((t) => target.addEventListener(t, go, { once: true, passive: true }));
  }

  async #start() {
    if (this.#started || !this.isConnected) return;
    this.#started = true;
    const name = this.dataset.island;
    if (!name) return;
    try {
      const mod = await importIsland(name);
      if (!this.isConnected) return;
      const result = await mod.mount(this);
      if (typeof result === 'function') this.#unmount = result;
      this.dataset.ready = '';
    } catch (err) {
      // An island failing must never break shopping: the HTML underneath still works.
      console.warn(`[kuki] island "${name}" did not start`, err);
      this.dataset.failed = '';
    }
  }
}

export function defineIslands() {
  if (!customElements.get('kuki-island')) customElements.define('kuki-island', KukiIsland);
}
