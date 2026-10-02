/**
 * The paper bag: opens as a native <dialog> (focus trap, Esc, inert page), re-renders from
 * Shopify's Section Rendering HTML after every change, keeps focus where it was, and makes
 * reaching free delivery feel like something: the twine ties, a stamp lands on the bag.
 */
import { BAG_SECTION, changeLine, updateNote, type CartResponse } from './cart.ts';
import { announce, buzz, fill, i18n, playSound } from './feedback.ts';
import { trackOnce } from './analytics.ts';
import { reducedMotion } from './prefs.ts';

export interface BagState {
  count: number;
  total: number;
  reached: boolean;
  percent: number;
  totalLabel: string;
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);

const rootEl = () => $<HTMLElement>('[data-bag-root]');
const sheetEl = () => $<HTMLDialogElement>('[data-bag-sheet]');

export function readState(root: HTMLElement | null = rootEl()): BagState {
  const d = root?.dataset ?? {};
  return {
    count: Number(d.count ?? 0),
    total: Number(d.total ?? 0),
    reached: d.reached === 'true',
    percent: Number(d.percent ?? 0),
    totalLabel: d.totalLabel ?? '',
  };
}

/* ---------- Open / close ---------- */

let lastTrigger: HTMLElement | null = null;

export function openBag(trigger?: HTMLElement | null) {
  const dlg = sheetEl();
  if (!dlg || dlg.open) return;
  lastTrigger = trigger ?? (document.activeElement as HTMLElement | null);
  dlg.showModal();
  document.documentElement.dataset.bagState = 'open';
  if (!reducedMotion()) {
    $('.bag-sheet__paper', dlg)?.animate(
      [
        { opacity: 0, transform: 'translateY(22px) scale(0.97)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 280, easing: 'cubic-bezier(.22,.8,.24,1)' },
    );
  }
  playSound('rustle');
}

export async function closeBag() {
  const dlg = sheetEl();
  if (!dlg?.open) return;
  if (!reducedMotion()) {
    const anim = $('.bag-sheet__paper', dlg)?.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(16px) scale(0.98)' },
      ],
      { duration: 170, easing: 'ease-in' },
    );
    await anim?.finished.catch(() => undefined);
  }
  dlg.close();
}

/* ---------- Re-render from Section Rendering HTML ---------- */

interface FocusSnapshot {
  key?: string;
  qty?: string;
  slot?: string;
  selector?: string;
}

function snapshotFocus(root: HTMLElement): FocusSnapshot | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !root.contains(el)) return null;
  const line = el.closest<HTMLElement>('[data-line-key]');
  if (line && el.dataset.lineChange !== undefined) {
    const delta = Number(el.dataset.qty) - Number(line.querySelector('.stepper__value')?.textContent ?? 0);
    return { key: line.dataset.lineKey, qty: delta > 0 ? 'up' : delta < 0 ? 'down' : 'remove' };
  }
  if (el.matches('[data-bag-note]')) return { selector: '[data-bag-note]' };
  return { slot: el.closest<HTMLElement>('[data-bag-slot]')?.dataset.bagSlot };
}

function restoreFocus(root: HTMLElement, snap: FocusSnapshot | null) {
  if (!snap) return;
  if (snap.key) {
    const line = root.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(snap.key)}"]`);
    if (line) {
      const buttons = line.querySelectorAll<HTMLElement>('.stepper__btn');
      const target = snap.qty === 'up' ? buttons[1] : snap.qty === 'down' ? buttons[0] : line.querySelector<HTMLElement>('.bag-line__remove');
      (target ?? buttons[0])?.focus();
      return;
    }
    // The line is gone: go to the first remaining line, or the bag's title.
    (root.querySelector<HTMLElement>('.bag-line .stepper__btn') ?? root.querySelector<HTMLElement>('#bag-sheet-title'))?.focus();
    return;
  }
  if (snap.selector) root.querySelector<HTMLElement>(snap.selector)?.focus();
}

export function renderBag(html: string | null | undefined): { before: BagState; after: BagState } | null {
  const current = rootEl();
  if (!html || !current) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const fresh = doc.querySelector<HTMLElement>('[data-bag-root]');
  if (!fresh) return null;

  const before = readState(current);
  const focus = snapshotFocus(current);

  for (const attr of ['data-count', 'data-total', 'data-total-label', 'data-reached', 'data-percent', 'data-empty']) {
    const value = fresh.getAttribute(attr);
    if (value !== null) current.setAttribute(attr, value);
  }
  current.querySelectorAll<HTMLElement>('[data-bag-slot]').forEach((slot) => {
    const next = fresh.querySelector<HTMLElement>(`[data-bag-slot="${slot.dataset.bagSlot}"]`);
    if (next) slot.replaceChildren(...Array.from(next.childNodes).map((n) => document.importNode(n, true)));
  });

  restoreFocus(current, focus);
  const after = readState(current);
  if (!before.reached && after.reached && after.count > 0) celebrateFreeDelivery(after);
  return { before, after };
}

export function applyCartResponse(res: CartResponse) {
  return renderBag(res.sections?.[BAG_SECTION]);
}

/* ---------- Moments ---------- */

function celebrateFreeDelivery(state: BagState) {
  trackOnce('kuki_free_delivery_reached', { total: state.total });
  playSound('stamp');
  buzz(18);
  announce(i18n('freeReached'));
  if (reducedMotion()) return;
  const stamp = [
    { opacity: 0, transform: 'rotate(-14deg) scale(1.9)' },
    { opacity: 1, transform: 'rotate(-14deg) scale(0.92)', offset: 0.7 },
    { opacity: 1, transform: 'rotate(-14deg) scale(1)' },
  ];
  $('.bag__seal')?.animate(stamp, { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  $('[data-bag-sheet] .meter__seal')?.animate(
    [
      { opacity: 0, transform: 'rotate(-3deg) scale(1.8)' },
      { opacity: 1, transform: 'rotate(-3deg) scale(1)' },
    ],
    { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
  );
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** A cookie drops into the bag (from the button that was tapped), then the bag rustles. */
export function bagReceive(from?: Element | null) {
  const bag = $<HTMLElement>('.bag');
  playSound('drop');
  buzz(10);
  if (!bag || reducedMotion()) return;
  const squash = () => {
    bag.animate(
      [
        { transform: 'none' },
        { transform: 'translateY(3px) scale(1.07, 0.93)' },
        { transform: 'translateY(-1px) scale(0.97, 1.04)' },
        { transform: 'none' },
      ],
      { duration: 440, easing: 'ease-out' },
    );
    playSound('rustle', { gain: 0.6 });
  };
  if (!from || !visible(bag) || !visible(from)) return squash();

  const a = from.getBoundingClientRect();
  const target = $('.bag__art', bag) ?? bag;
  const b = target.getBoundingClientRect();
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const dx = b.left + b.width / 2 - x0;
  const dy = b.top + b.height * 0.25 - y0;
  const cookie = document.createElement('span');
  cookie.className = 'flying-cookie';
  cookie.style.left = `${x0}px`;
  cookie.style.top = `${y0}px`;
  document.body.append(cookie);
  const lift = Math.min(160, Math.max(60, Math.abs(dx) * 0.25));
  cookie
    .animate(
      [
        { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - lift}px) scale(0.9) rotate(200deg)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5) rotate(340deg)` },
      ],
      { duration: 620, easing: 'cubic-bezier(.4,0,.5,1)' },
    )
    .finished.then(squash)
    .catch(() => undefined)
    .finally(() => cookie.remove());
}

/* ---------- Wiring ---------- */

export function initBag() {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const opener = target?.closest<HTMLElement>('[data-bag-open]');
    if (opener && sheetEl()) {
      event.preventDefault();
      openBag(opener);
      return;
    }
    if (target?.closest('[data-bag-close]')) {
      closeBag();
      return;
    }
    const change = target?.closest<HTMLElement>('[data-line-change]');
    if (change && change.closest('[data-bag-sheet]')) onLineChange(change);
  });

  document.addEventListener('click', (event) => {
    const dlg = sheetEl();
    if (dlg && event.target === dlg) closeBag(); // a click on the backdrop
  });

  document.addEventListener(
    'cancel',
    (event) => {
      if (event.target === sheetEl()) {
        event.preventDefault();
        closeBag();
      }
    },
    true,
  );

  document.addEventListener(
    'close',
    (event) => {
      if (event.target !== sheetEl()) return;
      delete document.documentElement.dataset.bagState;
      const back = lastTrigger?.isConnected ? lastTrigger : $<HTMLElement>('[data-bag-open]');
      back?.focus();
    },
    true,
  );

  // Gift note: saved as the cart note while typing (and again by the checkout POST itself).
  let noteTimer = 0;
  document.addEventListener('input', (event) => {
    const field = (event.target as Element | null)?.closest<HTMLTextAreaElement>('[data-bag-note]');
    if (!field) return;
    const status = $<HTMLElement>('[data-note-status]');
    if (status) delete status.dataset.state;
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(async () => {
      try {
        await updateNote(field.value);
        if (status) {
          status.dataset.state = 'saved';
          status.dataset.default ??= status.textContent ?? '';
          status.textContent = i18n('noteSaved');
        }
      } catch {
        /* the checkout form posts the note too */
      }
    }, 650);
  });

  document.addEventListener('submit', (event) => {
    const form = (event.target as Element | null)?.closest<HTMLFormElement>('[data-bag-checkout]');
    if (!form) return;
    const btn = form.querySelector<HTMLButtonElement>('[data-bag-checkout-btn]');
    if (btn?.dataset.state === 'busy') {
      event.preventDefault();
      return;
    }
    if (btn) {
      btn.dataset.state = 'busy';
      btn.setAttribute('aria-busy', 'true');
      const label = i18n('checkoutWait');
      if (label) btn.firstChild && (btn.firstChild.textContent = `${label} `);
    }
  });

  // Back/forward cache: refresh the bag so it never shows a stale count.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    fetch(`${location.pathname}?sections=${BAG_SECTION}`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((json) => renderBag(json?.[BAG_SECTION]))
      .catch(() => undefined);
  });
}

async function onLineChange(button: HTMLElement) {
  const key = button.dataset.lineChange;
  if (!key) return;
  const qty = Number(button.dataset.qty);
  const line = button.closest<HTMLElement>('.bag-line');
  line?.classList.add('is-busy');
  try {
    const res = await changeLine(key, qty);
    const result = applyCartResponse(res);
    playSound(qty === 0 ? 'whoosh' : 'click', { gain: 0.5 });
    if (result) announce(fill(i18n('updated'), { total: result.after.totalLabel }), $('[data-bag-live]'));
  } catch {
    line?.classList.remove('is-busy');
    announce(i18n('error'), $('[data-bag-live]'));
  }
}
