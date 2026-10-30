/**
 * Fill a dabba: tap flavours into a 3- or 6-compartment box, then add every pick to the
 * bag at once, each line carrying the same "Gift box" property (plus the box product, if
 * the shop sells one). Prices come from Liquid data attributes; JS only adds them up.
 */
import { addItems, CartError } from '../../core/cart.ts';
import { applyCartResponse, bagReceive } from '../../core/bag.ts';
import { announce, fill, playSound } from '../../core/feedback.ts';
import { track } from '../../core/analytics.ts';

interface Pick {
  variant: number;
  price: number;
  name: string;
  colour: string;
  form: string;
}

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function mount(island: HTMLElement) {
  const root = island.closest<HTMLElement>('[data-dabba]');
  if (!root) return;
  const box = root.querySelector<HTMLElement>('[data-dabba-box]')!;
  const slotsEl = root.querySelector<HTMLOListElement>('[data-dabba-slots]')!;
  const status = root.querySelector<HTMLElement>('[data-dabba-status]')!;
  const addBtn = root.querySelector<HTMLButtonElement>('[data-dabba-add]')!;
  const addLabel = root.querySelector<HTMLElement>('[data-dabba-add-label]')!;
  const strings = root.querySelector<HTMLTemplateElement>('[data-dabba-strings]')!.dataset;
  const flavours = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dabba-flavour]'));
  const boxVariant = Number(root.dataset.boxVariant || 0);
  const boxPrice = Number(root.dataset.boxPrice || 0);
  root.dataset.enhanced = '';

  let size = Number(root.querySelector<HTMLInputElement>('[data-dabba-size]:checked')?.value ?? 3);
  let slots: (Pick | null)[] = Array(size).fill(null);

  const pickOf = (b: HTMLButtonElement): Pick => ({
    variant: Number(b.dataset.variant),
    price: Number(b.dataset.price),
    name: b.dataset.name ?? '',
    colour: getComputedStyle(b).getPropertyValue('--flavour').trim(),
    form: b.dataset.form ?? 'chunk',
  });

  const render = () => {
    box.dataset.size = String(size);
    slotsEl.replaceChildren(
      ...slots.map((p, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dabba__slot';
        btn.dataset.index = String(i);
        if (p) {
          btn.style.setProperty('--flavour', p.colour);
          btn.dataset.filled = '';
          btn.innerHTML = `<img src="${(window.KUKI.assets.shelf2d ?? '').replace(/island-shelf2d\.js.*/, `cookie-${p.form}.svg`)}" alt="" width="64" height="64"><span class="dabba__slot-name"></span>`;
          btn.querySelector('.dabba__slot-name')!.textContent = p.name;
          btn.setAttribute('aria-label', fill(strings.slotFilled, { name: p.name }));
        } else {
          btn.textContent = String(i + 1);
          btn.setAttribute('aria-label', strings.slotEmpty ?? '');
        }
        li.append(btn);
        return li;
      }),
    );
    const filled = slots.filter(Boolean) as Pick[];
    const total = filled.reduce((s, p) => s + p.price, 0) + (filled.length ? boxPrice : 0);
    status.textContent = fill(strings.count, { filled: String(filled.length), size: String(size), total: rupees.format(total / 100) });
    addBtn.disabled = filled.length !== size;
    addLabel.textContent = filled.length === size ? fill(strings.addTotal, { total: rupees.format(total / 100) }) : addLabel.dataset.base ?? addLabel.textContent ?? '';
  };
  addLabel.dataset.base = addLabel.textContent ?? '';

  const put = (p: Pick) => {
    const i = slots.findIndex((s) => !s);
    if (i === -1) {
      announce(strings.full ?? '', status);
      return;
    }
    slots[i] = p;
    playSound('drop', { gain: 0.4 });
    render();
  };

  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const f = t.closest<HTMLButtonElement>('[data-dabba-flavour]');
    if (f) return put(pickOf(f));
    const slot = t.closest<HTMLButtonElement>('.dabba__slot[data-filled]');
    if (slot) {
      slots[Number(slot.dataset.index)] = null;
      render();
      return;
    }
    if (t.closest('[data-dabba-fill]')) {
      slots = Array.from({ length: size }, (_, i) => pickOf(flavours[i % flavours.length]!));
      render();
      return;
    }
    if (t.closest('[data-dabba-clear]')) {
      slots = Array(size).fill(null);
      render();
    }
  });

  root.addEventListener('change', (e) => {
    const r = (e.target as Element).closest<HTMLInputElement>('[data-dabba-size]');
    if (!r) return;
    size = Number(r.value);
    slots = Array.from({ length: size }, (_, i) => slots[i] ?? null);
    render();
  });

  addBtn.addEventListener('click', async () => {
    const filled = slots.filter(Boolean) as Pick[];
    if (filled.length !== size) return;
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();
    const label = `${root.dataset.boxLabel || 'Dabba'} of ${size} · #${id}`;
    const property = root.dataset.property || 'Gift box';
    const items = filled.map((p) => ({ id: p.variant, quantity: 1, properties: { [property]: label } }));
    if (boxVariant) items.push({ id: boxVariant, quantity: 1, properties: { [property]: label } });
    addBtn.dataset.state = 'adding';
    try {
      const res = await addItems(items);
      applyCartResponse(res);
      bagReceive(addBtn);
      addBtn.dataset.state = 'added';
      addBtn.querySelector('.btn__state')!.textContent = strings.added ?? '';
      announce(strings.added ?? '');
      track('kuki_dabba_built', { size, flavours: filled.map((p) => p.name), box_product: Boolean(boxVariant) });
      window.setTimeout(() => {
        delete addBtn.dataset.state;
        slots = Array(size).fill(null);
        render();
      }, 1800);
    } catch (err) {
      addBtn.dataset.state = 'error';
      addBtn.querySelector('.btn__state')!.textContent = err instanceof CartError ? err.message : '';
      window.setTimeout(() => delete addBtn.dataset.state, 2600);
    }
  });

  render();
}
