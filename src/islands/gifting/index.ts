/**
 * Corporate gifting studio: logo → box preview (3D where the device can, flat otherwise),
 * PNG mockup download, and a prefilled WhatsApp enquiry. The logo is processed on the
 * device only; nothing is uploaded anywhere.
 */
import { check3D } from '../shelf2d/tier.ts';
import { reducedMotion } from '../../core/prefs.ts';
import { announce, fill, playSound } from '../../core/feedback.ts';
import { track } from '../../core/analytics.ts';
import { now, todayISO } from '../../shared/time.ts';
import { MAX_BYTES, prepareLogo, type BoxLook } from './art.ts';
import { drawFlatBox } from './flat.ts';
import type { Box3D } from './box3d.ts';

const longDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return longDate.format(new Date(`${iso}T00:00:00Z`));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'your-company';

export function mount(island: HTMLElement) {
  const root = island.closest<HTMLElement>('[data-gifting]');
  if (!root) return;
  const ds = root.dataset;
  const stage = root.querySelector<HTMLElement>('[data-gift-stage]')!;
  const form = root.querySelector<HTMLFormElement>('[data-gift-form]')!;
  const file = root.querySelector<HTMLInputElement>('[data-gift-file]')!;
  const knockout = root.querySelector<HTMLInputElement>('[data-gift-knockout]')!;
  const logoStatus = root.querySelector<HTMLElement>('[data-gift-logo-status]')!;
  const download = root.querySelector<HTMLButtonElement>('[data-gift-download]')!;
  const reminder = root.querySelector<HTMLElement>('[data-gift-reminder]')!;
  const strings = root.querySelector<HTMLTemplateElement>('[data-gift-strings]')?.dataset ?? {};
  const field = (name: string) => root.querySelector<HTMLInputElement>(`[data-gift-field="${name}"]`)!;

  const look: BoxLook = {
    box: ds.boxColour || '#c89b68',
    sleeve: ds.sleeveColour || '#fbf4e6',
    sleeveInk: ds.sleeveInk || '#3b1a0c',
    sleeveText: ds.sleeveText ?? '',
    boxText: ds.boxText ?? '',
  };
  const label = (strings.boxLabel ?? '');

  // Earliest date = today in India + the notice the bakery needs (if the team set one).
  const lead = Number(ds.leadDays);
  const today = todayISO(now());
  field('date').min = addDays(today, Number.isFinite(lead) && ds.leadDays !== '' ? lead : 0);

  let logo: HTMLCanvasElement | null = null;
  let downloaded = false;
  let box3d: Box3D | null = null;

  // Flat preview canvas: shown until (and unless) the 3D box takes over.
  const flat = document.createElement('canvas');
  flat.className = 'gift__canvas';
  flat.setAttribute('role', 'img');
  flat.setAttribute('aria-label', label);
  const drawFlat = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    flat.width = Math.round(r.width * dpr);
    flat.height = Math.round(r.height * dpr);
    const ctx = flat.getContext('2d')!;
    ctx.clearRect(0, 0, flat.width, flat.height);
    drawFlatBox(ctx, flat.width, flat.height, look, logo);
  };
  stage.querySelector('[data-gift-flat]')?.remove();
  stage.append(flat);
  drawFlat();
  document.fonts?.ready.then(() => !box3d && drawFlat());
  const ro = new ResizeObserver(() => !box3d && drawFlat());
  ro.observe(stage);

  const tier = check3D(true);
  stage.dataset.tier = tier.ok ? '3d' : '2d';
  if (tier.ok) {
    import('./box3d.ts')
      .then(({ createBox3D }) => {
        box3d = createBox3D(stage, look, { reducedMotion: reducedMotion(), label });
        box3d.setLogo(logo);
        flat.remove();
        stage.dataset.ready = '';
      })
      .catch(() => {
        stage.dataset.tier = '2d';
      });
  }

  const refresh = () => {
    if (box3d) box3d.setLogo(logo);
    else drawFlat();
  };

  let pending: File | null = null;
  const loadLogo = async () => {
    const f = pending;
    if (!f) return;
    if (f.size > MAX_BYTES) {
      logoStatus.textContent = (strings.logoTooBig ?? '');
      return;
    }
    try {
      logo = await prepareLogo(f, knockout.checked);
      downloaded = false;
      download.hidden = false;
      logoStatus.textContent = (strings.logoReady ?? '');
      playSound('stamp', { gain: 0.5 });
      refresh();
    } catch {
      logoStatus.textContent = (strings.logoError ?? '');
    }
  };
  file.addEventListener('change', () => {
    pending = file.files?.[0] ?? null;
    loadLogo();
  });
  knockout.addEventListener('change', loadLogo);

  const values = () => {
    const all = Array.from(root.querySelectorAll<HTMLInputElement>('[data-gift-flavour]'));
    const picked = all.filter((c) => c.checked).map((c) => c.value);
    return {
      company: field('company').value.trim(),
      quantity: field('quantity').value.trim(),
      date: prettyDate(field('date').value),
      city: field('city').value.trim(),
      flavours: picked.length === all.length && all.length > 1 ? (strings.allFlavours ?? '') : picked.join(', '),
      picked,
    };
  };

  /** The mockup PNG: the box, who it's for, the order line and the Kuki footer. */
  const mockup = (): HTMLCanvasElement => {
    const W = 1080;
    const H = 1350;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    ctx.fillStyle = v('--paper', '#fbf4e6');
    ctx.fillRect(0, 0, W, H);

    const art = box3d ? box3d.still(W, 900) : (() => {
      const a = document.createElement('canvas');
      a.width = W;
      a.height = 900;
      drawFlatBox(a.getContext('2d')!, W, 900, look, logo);
      return a;
    })();
    ctx.drawImage(art, 0, 190);

    const val = values();
    const ink = v('--ink', '#3b1a0c');
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 64px ${v('--font-hand', 'cursive')}`;
    ctx.fillText(fill((strings.mockupFor ?? ''), { company: val.company || '…' }), W / 2, 150);

    const line = [
      val.quantity && fill(strings.mockupBoxes, { quantity: val.quantity }),
      val.date && fill(strings.mockupBy, { date: val.date }),
      val.city,
    ]
      .filter(Boolean)
      .join(' · ');
    ctx.font = `600 38px ${v('--font-ui', 'sans-serif')}`;
    ctx.fillText(line, W / 2, 1140);
    if (val.flavours) {
      ctx.font = `400 32px ${v('--font-ui', 'sans-serif')}`;
      ctx.fillStyle = v('--ink-2', '#5e3a26');
      ctx.fillText(val.flavours, W / 2, 1192, W - 120);
    }
    ctx.fillStyle = v('--ink-2', '#5e3a26');
    ctx.font = `400 26px ${v('--font-ui', 'sans-serif')}`;
    if (ds.note) ctx.fillText(ds.note, W / 2, 1262, W - 120);
    ctx.fillStyle = ink;
    ctx.font = `400 34px ${v('--font-display', 'serif')}`;
    if (ds.brand) ctx.fillText(ds.brand, W / 2, 1312, W - 120);
    return c;
  };

  const save = () => {
    const url = mockup().toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `kuki-gift-box-${slug(field('company').value)}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    downloaded = true;
    announce((strings.downloaded ?? ''), logoStatus);
  };
  download.addEventListener('click', save);

  // Native validation runs first; submit only fires once company and quantity are filled.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = values();
    const message = (ds.template ?? '')
      .replaceAll('[company]', val.company)
      .replaceAll('[quantity]', val.quantity)
      .replaceAll('[date]', val.date || '—')
      .replaceAll('[city]', val.city || '—')
      .replaceAll('[flavours]', val.flavours || '—');
    // Open WhatsApp inside the click, before anything async, so it isn't blocked as a popup.
    const href = `https://wa.me/${ds.wa}?text=${encodeURIComponent(message)}`;
    const opened = window.open(href, '_blank');
    if (opened) opened.opener = null;
    else location.href = href;
    if (logo && !downloaded) save();
    reminder.hidden = false;
    announce(reminder.textContent ?? '');
    track('kuki_gifting_enquiry', {
      quantity: Number(val.quantity) || null,
      city: val.city,
      flavours: val.picked,
      has_logo: Boolean(logo),
      needed_by: field('date').value || null,
    });
  });

  root.dataset.enhanced = '';
  return () => {
    ro.disconnect();
    box3d?.dispose();
  };
}
