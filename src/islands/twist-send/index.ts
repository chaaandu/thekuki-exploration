/**
 * Twist & send: a short video of this flavour's jar twisting open, with a "For ___" tag,
 * to share on WhatsApp or Stories. Preview plays in the dialog; the encoder (mediabunny)
 * only loads when someone taps "Make the video".
 */
import { getPrefs, reducedMotion } from '../../core/prefs.ts';
import { announce, fill } from '../../core/feedback.ts';
import { track } from '../../core/analytics.ts';
import { DURATION, drawFrame, loadAssets, type Assets, type Flavour, type SceneText } from './scene.ts';

const SIZES = { story: [1080, 1920], square: [1080, 1080] } as const;
type Format = keyof typeof SIZES;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

export function mount(island: HTMLElement) {
  const root = island.closest<HTMLElement>('[data-twist-send-root]');
  const dialog = root?.querySelector<HTMLDialogElement>('dialog[data-twist-send]');
  const opener = root?.querySelector<HTMLButtonElement>('[data-twist-send-open]');
  if (!root || !dialog || !opener || typeof dialog.showModal !== 'function') return;

  const flavours = JSON.parse(document.querySelector('script[data-kuki-flavours]')?.textContent ?? '[]') as Flavour[];
  const flavour = flavours.find((f) => f.handle === root.dataset.handle) ?? flavours[0];
  if (!flavour) return;

  const ds = dialog.dataset;
  const preview = dialog.querySelector<HTMLCanvasElement>('[data-send-canvas]')!;
  const frame = dialog.querySelector<HTMLElement>('[data-send-frame]')!;
  const nameInput = dialog.querySelector<HTMLInputElement>('[data-send-name]')!;
  const status = dialog.querySelector<HTMLElement>('[data-send-status]')!;
  const make = dialog.querySelector<HTMLButtonElement>('[data-send-make]')!;
  const share = dialog.querySelector<HTMLButtonElement>('[data-send-share]')!;
  const save = dialog.querySelector<HTMLAnchorElement>('[data-send-save]')!;
  const bar = dialog.querySelector<HTMLElement>('[data-send-progress]')!;

  let assets: Assets | null = null;
  let raf = 0;
  let started = 0;
  let file: File | null = null;
  let url = '';

  const format = (): Format => (dialog.querySelector<HTMLInputElement>('[data-send-format]:checked')?.value as Format) ?? 'story';
  const text = (): SceneText => {
    const name = nameInput.value.trim();
    return {
      forLine: fill(ds.forTemplate, { name: name || ds.defaultName || '' }),
      endLine: ds.endLine ?? '',
      strap: ds.strap ?? '',
    };
  };

  const sizePreview = () => {
    const [w, h] = SIZES[format()];
    frame.style.aspectRatio = `${w} / ${h}`;
    frame.style.setProperty('--ar', String(w / h));
    const box = frame.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    preview.width = Math.round(box.width * dpr);
    preview.height = Math.round(box.width * dpr * (h / w));
  };

  const paint = (t: number) => {
    if (!assets) return;
    drawFrame(preview.getContext('2d')!, preview.width, preview.height, t, flavour, assets, text());
  };

  const loop = (now: number) => {
    if (!started) started = now;
    const t = ((now - started) / 1000) % (DURATION + 0.6);
    paint(Math.min(t, DURATION));
    raf = requestAnimationFrame(loop);
  };

  const play = () => {
    cancelAnimationFrame(raf);
    sizePreview();
    started = 0;
    // Reduced motion: show the opened jar with the tag, still.
    if (reducedMotion()) paint(3.4);
    else raf = requestAnimationFrame(loop);
  };

  const resetResult = () => {
    file = null;
    share.hidden = true;
    save.hidden = true;
    if (url) URL.revokeObjectURL(url);
    url = '';
  };

  opener.hidden = false;
  opener.addEventListener('click', async () => {
    dialog.showModal();
    status.textContent = '';
    if (!assets) {
      status.textContent = ds.loading ?? '';
      try {
        assets = await loadAssets(flavour);
        status.textContent = '';
      } catch {
        status.textContent = ds.error ?? '';
        return;
      }
    }
    play();
  });

  dialog.addEventListener('close', () => cancelAnimationFrame(raf));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // tap on the backdrop
  });
  nameInput.addEventListener('input', () => {
    resetResult();
    if (reducedMotion()) paint(3.4);
  });
  dialog.querySelectorAll('[data-send-format]').forEach((r) =>
    r.addEventListener('change', () => {
      resetResult();
      play();
    }),
  );

  make.addEventListener('click', async () => {
    if (!assets || make.disabled) return;
    make.disabled = true;
    resetResult();
    bar.hidden = false;
    bar.style.setProperty('--p', '0');
    const fmt = format();
    const [w, h] = SIZES[fmt];
    const t0 = performance.now();
    try {
      const { makeVideo } = await import('./encode.ts');
      const textNow = text();
      const made = await makeVideo(
        w,
        h,
        (ctx, t) => drawFrame(ctx, w, h, t, flavour, assets!, textNow),
        getPrefs().sound,
        (p) => {
          bar.style.setProperty('--p', p.toFixed(3));
          status.textContent = fill(ds.making, { percent: String(Math.round(p * 100)) });
        },
      );
      const name = slug(nameInput.value) || 'you';
      file = new File([made.blob], `kuki-${flavour.handle}-for-${name}.${made.ext}`, { type: made.blob.type });
      url = URL.createObjectURL(made.blob);
      save.href = url;
      save.download = file.name;
      save.hidden = false;
      share.hidden = !(navigator.canShare?.({ files: [file] }) ?? false);
      status.textContent = ds.ready ?? '';
      announce(ds.ready ?? '');
      track('kuki_twist_send', {
        flavour: flavour.handle,
        format: fmt,
        container: made.ext,
        has_name: Boolean(nameInput.value.trim()),
        sound: getPrefs().sound,
        seconds_to_make: Math.round((performance.now() - t0) / 100) / 10,
      });
    } catch (err) {
      console.warn('[kuki] twist & send', err);
      status.textContent = ds.error ?? '';
    } finally {
      make.disabled = false;
      bar.hidden = true;
    }
  });

  share.addEventListener('click', async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text: ds.shareText ?? '' });
    } catch {
      /* cancelled */
    }
  });

  return () => {
    cancelAnimationFrame(raf);
    if (url) URL.revokeObjectURL(url);
  };
}
