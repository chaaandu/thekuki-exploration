/**
 * Add to bag, from any product form marked [data-add-form="<source>"].
 * Feedback lands on the button that was tapped ("Adding…" → "In the bag ✓") and on the
 * bag itself (a cookie drops in, it rustles and fills). No toasts.
 * With JavaScript off, the same forms post to /cart/add and Shopify takes over.
 */
import { addItems, CartError } from './cart.ts';
import { applyCartResponse, bagReceive } from './bag.ts';
import { announce, fill, i18n, playSound } from './feedback.ts';
import { track } from './analytics.ts';

const CHECK = '<svg class="icon" aria-hidden="true"><use href="#kuki-icon-check"/></svg>';
const timers = new WeakMap<HTMLElement, number>();

function setButtonState(btn: HTMLElement, state: 'adding' | 'added' | 'error' | null, label = '') {
  window.clearTimeout(timers.get(btn));
  const slot = btn.querySelector<HTMLElement>('.btn__state');
  if (!state) {
    delete btn.dataset.state;
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-disabled');
    if (slot) slot.textContent = '';
    return;
  }
  btn.dataset.state = state;
  btn.setAttribute('aria-busy', String(state === 'adding'));
  if (state === 'adding') btn.setAttribute('aria-disabled', 'true');
  else btn.removeAttribute('aria-disabled');
  if (slot) {
    slot.innerHTML = state === 'added' ? CHECK : '';
    slot.append(document.createTextNode(label));
  }
  if (state !== 'adding') timers.set(btn, window.setTimeout(() => setButtonState(btn, null), state === 'added' ? 1900 : 2800));
}

function readItem(form: HTMLFormElement) {
  const data = new FormData(form);
  const properties: Record<string, string> = {};
  for (const [name, value] of data) {
    const match = /^properties\[(.+)\]$/.exec(name);
    if (match?.[1] && typeof value === 'string' && value !== '') properties[match[1]] = value;
  }
  return {
    id: Number(data.get('id')),
    quantity: Math.max(1, Number(data.get('quantity') ?? 1)),
    properties,
  };
}

async function onSubmit(event: SubmitEvent) {
  const form = (event.target as Element | null)?.closest<HTMLFormElement>('form[data-add-form]');
  if (!form) return;
  event.preventDefault();
  const btn = (event.submitter as HTMLElement | null) ?? form.querySelector<HTMLElement>('button[type="submit"]');
  if (!btn || btn.dataset.state === 'adding') return;

  const item = readItem(form);
  if (!item.id) return;
  const source = form.dataset.addForm || 'unknown';
  const checked = form.querySelector<HTMLInputElement>('input[name="id"]:checked');
  const title = [form.dataset.title, checked?.dataset.sizeLabel].filter(Boolean).join(' ');

  setButtonState(btn, 'adding', i18n('adding'));
  playSound('click', { gain: 0.4 });
  try {
    const res = await addItems([item]);
    const result = applyCartResponse(res);
    setButtonState(btn, 'added', i18n('added'));
    bagReceive(btn);
    if (result) announce(fill(i18n('itemAdded'), { title, total: result.after.totalLabel }));
    track('kuki_add_to_bag', {
      variant_id: item.id,
      quantity: item.quantity,
      handle: form.dataset.handle,
      size: checked?.dataset.sizeLabel,
      source,
      gift_box: item.properties['Gift box'] ? true : undefined,
    });
    form.dispatchEvent(new CustomEvent('kuki:added', { bubbles: true, detail: { ...item, source, handle: form.dataset.handle } }));
  } catch (err) {
    const message = err instanceof CartError && err.message ? err.message : i18n('addFailed');
    setButtonState(btn, 'error', message);
    announce(message);
  }
}

function onSizeChange(event: Event) {
  const input = (event.target as Element | null)?.closest<HTMLInputElement>('.size-toggle__input');
  if (!input) return;
  const form = input.form;
  track('kuki_size_switch', {
    handle: form?.dataset.handle,
    size: input.dataset.sizeLabel,
    source: form?.dataset.addForm,
  });
  form?.dispatchEvent(
    new CustomEvent('kuki:size', {
      bubbles: true,
      detail: { variantId: Number(input.value), size: input.dataset.sizeLabel, index: Number(input.dataset.sizeIndex), handle: form?.dataset.handle },
    }),
  );
}

export function initAdd() {
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onSizeChange);
}
