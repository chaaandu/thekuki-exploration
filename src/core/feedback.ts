/**
 * Feedback without toasts: screen-reader announcements, synthesized sound (off by
 * default, loaded only when switched on) and a short vibration on Android.
 */
import { getPrefs } from './prefs.ts';

export function announce(message: string, region?: Element | null) {
  const el = region ?? document.getElementById('kuki-announcer');
  if (!el || !message) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

export type SoundName = 'click' | 'pop' | 'rustle' | 'drop' | 'whoosh' | 'stamp' | 'unscrew';

let soundModule: Promise<typeof import('../shared/sound.ts')> | null = null;

export function playSound(name: SoundName, options?: { gain?: number; at?: number }) {
  if (!getPrefs().sound) return;
  soundModule ??= import('../shared/sound.ts');
  soundModule.then((m) => m.play(name, options)).catch(() => {});
}

/** Warm the audio engine on the gesture that switches sound on (browsers require a gesture). */
export function primeSound() {
  soundModule ??= import('../shared/sound.ts');
  soundModule.then((m) => m.prime()).catch(() => {});
}

export function buzz(ms = 8) {
  if (!window.KUKI?.settings?.haptics) return;
  // Only after the visitor has tapped (an auto-twist on page load shouldn't buzz, and
  // Chrome logs an error for it).
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported (iOS): silently skip */
  }
}

/** Fill a locale template like "%title% added. Bag total %total%." */
export function fill(template: string | undefined, values: Record<string, string>): string {
  if (!template) return '';
  return template.replace(/%(\w+)%/g, (_, key: string) => values[key] ?? '');
}

export function i18n(key: string): string {
  return window.KUKI?.i18n?.[key] ?? '';
}
