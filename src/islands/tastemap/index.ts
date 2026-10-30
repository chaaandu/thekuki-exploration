/**
 * Taste map: drag (or arrow-key) the dot; the two nearest jars light up and their
 * buy cards appear. Positions come from the Flavour story metaobjects via Liquid.
 */
import { announce } from '../../core/feedback.ts';

export function mount(island: HTMLElement) {
  const root = island.closest<HTMLElement>('[data-taste-map]');
  const board = root?.querySelector<HTMLElement>('[data-taste-board]');
  const dot = root?.querySelector<HTMLButtonElement>('[data-taste-you]');
  if (!root || !board || !dot) return;
  const jars = Array.from(root.querySelectorAll<HTMLElement>('[data-taste-jar]')).map((el) => ({
    el,
    handle: el.dataset.handle!,
    // board coordinates: x left→right (sweet→savoury), y top→bottom (curious→comfort)
    x: Number(el.dataset.x),
    y: 100 - Number(el.dataset.y),
    name: el.querySelector('.taste__name')?.textContent?.trim() ?? '',
  }));
  const picks = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-taste-pick]')).map((el) => [el.dataset.tastePick!, el]));
  const live = root.querySelector<HTMLElement>('[data-taste-live]');
  const hint = root.querySelector<HTMLElement>('.taste__hint');
  let pos = { x: 45, y: 55 };
  let last = '';

  const update = (speak: boolean) => {
    dot.style.setProperty('--x', String(pos.x));
    dot.style.setProperty('--y', String(pos.y));
    const near = [...jars].sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y)).slice(0, 2);
    const key = near.map((n) => n.handle).join(',');
    for (const j of jars) j.el.toggleAttribute('data-near', near.includes(j));
    if (key !== last) {
      last = key;
      picks.forEach((el, handle) => (el.hidden = !near.some((n) => n.handle === handle)));
      // keep the closer one first
      near.forEach((n) => picks.get(n.handle)?.parentElement?.append(picks.get(n.handle)!));
      if (speak) announce(near.map((n) => n.name).join(', '), live);
    }
    dot.setAttribute('aria-valuetext', near.map((n) => n.name).join(', '));
  };

  dot.hidden = false;
  dot.setAttribute('role', 'slider');
  dot.setAttribute('aria-valuemin', '0');
  dot.setAttribute('aria-valuemax', '100');
  if (hint) hint.hidden = true;
  update(false);

  const moveTo = (clientX: number, clientY: number) => {
    const r = board.getBoundingClientRect();
    pos = {
      x: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)),
    };
    update(false);
  };
  let dragging = false;
  const down = (e: PointerEvent) => {
    if ((e.target as Element).closest('a')) return;
    dragging = true;
    board.setPointerCapture(e.pointerId);
    moveTo(e.clientX, e.clientY);
    dot.focus({ preventScroll: true });
  };
  const move = (e: PointerEvent) => dragging && moveTo(e.clientX, e.clientY);
  const up = () => {
    if (dragging) update(true);
    dragging = false;
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 5;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    pos = { x: Math.min(100, Math.max(0, pos.x + v[0])), y: Math.min(100, Math.max(0, pos.y + v[1])) };
    update(true);
  };
  board.addEventListener('pointerdown', down);
  board.addEventListener('pointermove', move);
  board.addEventListener('pointerup', up);
  board.addEventListener('pointercancel', up);
  dot.addEventListener('keydown', key);
  return () => {
    board.removeEventListener('pointerdown', down);
    board.removeEventListener('pointermove', move);
    board.removeEventListener('pointerup', up);
    board.removeEventListener('pointercancel', up);
    dot.removeEventListener('keydown', key);
  };
}
