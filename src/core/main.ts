/**
 * kuki-core: the only script every page loads (deferred module, small).
 * Everything heavy is an island loaded later, on demand.
 */
import { defineIslands } from './islands.ts';
import { initPrefs } from './prefs.ts';
import { initDates } from './dated.ts';
import { initBag } from './bag.ts';
import { initAdd } from './add.ts';
import { primeSound } from './feedback.ts';

initPrefs();
initDates();
initBag();
initAdd();
defineIslands();

// Switching sound on is the user gesture browsers need before audio can start.
document.addEventListener('kuki:prefs', (event) => {
  if ((event as CustomEvent<{ sound: boolean }>).detail.sound) primeSound();
});

// Focus the contact form's status message after a submit so screen readers hear it.
document.querySelector<HTMLElement>('[data-autofocus]')?.focus();
