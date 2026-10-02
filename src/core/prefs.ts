/**
 * Visitor preferences: Sound (off by default), Reduce motion (follows the OS unless set),
 * Just the shelf. Saved in localStorage; applied to <html> data attributes so CSS and
 * islands react without coupling. Emits `kuki:prefs` on document.
 */

export interface Prefs {
  sound: boolean;
  motion: 'full' | 'reduced' | null;
  justShelf: boolean;
}

const KEY = 'kuki:prefs';
const html = document.documentElement;

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      sound: typeof raw.sound === 'boolean' ? raw.sound : Boolean(window.KUKI?.settings?.soundDefaultOn),
      motion: raw.motion === 'full' || raw.motion === 'reduced' ? raw.motion : null,
      justShelf: Boolean(raw.justShelf),
    };
  } catch {
    return { sound: false, motion: null, justShelf: false };
  }
}

let state: Prefs = read();

function osReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function reducedMotion(): boolean {
  return state.motion === 'reduced' || (state.motion !== 'full' && osReducedMotion());
}

export function getPrefs(): Readonly<Prefs> {
  return state;
}

function apply() {
  if (reducedMotion()) html.dataset.motion = 'reduced';
  else delete html.dataset.motion;
  if (state.justShelf) html.dataset.justShelf = 'true';
  else delete html.dataset.justShelf;
  html.dataset.sound = state.sound ? 'on' : 'off';
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  state = { ...state, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: preferences last for this page only */
  }
  apply();
  document.dispatchEvent(new CustomEvent('kuki:prefs', { detail: { ...state, reducedMotion: reducedMotion() } }));
  syncPills();
}

function syncPills() {
  document.querySelectorAll<HTMLButtonElement>('[data-pref]').forEach((btn) => {
    const key = btn.dataset.pref;
    const on = key === 'sound' ? state.sound : key === 'motion' ? reducedMotion() : key === 'justShelf' ? state.justShelf : false;
    btn.setAttribute('aria-pressed', String(on));
  });
}

export function initPrefs() {
  apply();
  syncPills();
  document.addEventListener('click', (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-pref]');
    if (!btn) return;
    const key = btn.dataset.pref;
    if (key === 'sound') setPref('sound', !state.sound);
    else if (key === 'motion') setPref('motion', reducedMotion() ? 'full' : 'reduced');
    else if (key === 'justShelf') setPref('justShelf', !state.justShelf);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.justShelf) setPref('justShelf', false);
  });
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => {
    apply();
    syncPills();
  });
  document.addEventListener('shopify:section:load', syncPills);
}
