/**
 * Runs the jars: input (tap, circular drag on the lid, ←/→ quarter turns, Enter/Space,
 * Esc), the open/close timelines, sound + haptics on each quarter turn, exclusivity
 * (opening one jar screws the open one shut), analytics, and the native <details> state
 * (so the tag back is reachable and announced). Rendering is delegated to a ShelfRenderer,
 * which can be swapped from 2D to 3D at any moment without losing state.
 */
import { announce, buzz, fill, i18n, playSound } from '../../core/feedback.ts';
import { reducedMotion } from '../../core/prefs.ts';
import { track } from '../../core/analytics.ts';
import { CLOSE, CLOSED, closePose, FULL_TWIST, OPEN, openPose, QUARTER, quarters, type JarPose } from './timeline.ts';
import type { JarInfo, ShelfRenderer } from './types.ts';

type Phase = 'closed' | 'twisting' | 'opening' | 'open' | 'closing';
type Method = 'tap' | 'drag' | 'keys' | 'auto';

export interface Jar {
  info: JarInfo;
  details: HTMLDetailsElement | null;
  summary: HTMLElement;
  phase: Phase;
  pose: JarPose;
  t0: number;
  fromTwist: number;
  closeFrom: JarPose;
  method: Method;
  quarter: number;
  panelShown: boolean;
  tracked: boolean;
}

const now = () => performance.now();

export class ShelfController {
  readonly jars: Jar[];
  readonly source: string;
  renderer: ShelfRenderer;
  #raf = 0;
  #cleanup: (() => void)[] = [];
  #swallowClick = new WeakSet<HTMLElement>();

  constructor(root: HTMLElement, infos: JarInfo[], renderer: ShelfRenderer, source: string) {
    this.renderer = renderer;
    this.source = source;
    this.jars = infos.map((info) => ({
      info,
      details: info.el.querySelector<HTMLDetailsElement>('[data-jar-details]'),
      summary: info.el.querySelector<HTMLElement>('[data-jar-summary]')!,
      phase: 'closed',
      pose: { ...CLOSED },
      t0: 0,
      fromTwist: 0,
      closeFrom: { ...CLOSED },
      method: 'tap',
      quarter: 0,
      panelShown: false,
      tracked: false,
    }));
    this.jars.forEach((jar, i) => this.#wire(jar, i));
    // Jars rendered open by Liquid (or opened before JS) start open.
    this.jars.forEach((jar, i) => {
      if (jar.details?.open) this.#settleOpen(i);
    });
    const onAdded = (e: Event) => {
      const i = this.jars.findIndex((j) => j.info.el.contains(e.target as Node));
      if (i > -1) window.setTimeout(() => this.close(i), 650);
    };
    const onSize = (e: Event) => {
      const i = this.jars.findIndex((j) => j.info.el.contains(e.target as Node));
      const detail = (e as CustomEvent<{ index: number }>).detail;
      if (i > -1) this.renderer.setSize(i, detail.index >= 2 ? 1 : 0);
    };
    root.addEventListener('kuki:added', onAdded);
    root.addEventListener('kuki:size', onSize);
    this.#cleanup.push(() => root.removeEventListener('kuki:added', onAdded), () => root.removeEventListener('kuki:size', onSize));
  }

  setRenderer(renderer: ShelfRenderer) {
    this.renderer = renderer;
    this.jars.forEach((jar, i) => renderer.apply(i, jar.pose));
  }

  /* ------------------------------------------------------------ actions */

  open(i: number, method: Method) {
    const jar = this.jars[i];
    if (!jar || jar.phase === 'open' || jar.phase === 'opening') return;
    this.jars.forEach((other, j) => {
      if (j !== i && (other.phase === 'open' || other.phase === 'opening' || other.phase === 'twisting')) this.close(j);
    });
    jar.method = method;
    if (reducedMotion()) return this.#settleOpen(i);
    jar.phase = 'opening';
    jar.fromTwist = jar.pose.twist;
    jar.t0 = now() - (jar.pose.twist >= FULL_TWIST ? OPEN.twistEnd * 1000 : 0);
    this.#loop();
  }

  close(i: number) {
    const jar = this.jars[i];
    if (!jar || jar.phase === 'closed' || jar.phase === 'closing') return;
    this.#showPanel(jar, false);
    if (reducedMotion()) {
      jar.phase = 'closed';
      jar.pose = { ...CLOSED };
      jar.quarter = 0;
      this.renderer.apply(i, jar.pose);
      return;
    }
    jar.phase = 'closing';
    jar.closeFrom = { ...jar.pose };
    jar.t0 = now();
    this.#loop();
  }

  toggle(i: number, method: Method) {
    const jar = this.jars[i]!;
    if (jar.phase === 'open' || jar.phase === 'opening') this.close(i);
    else this.open(i, method);
  }

  /** Turn the lid by `delta` radians (drag / keys). Hands over to the open timeline at 1.5 turns. */
  twistBy(i: number, delta: number, method: Method) {
    const jar = this.jars[i];
    if (!jar || (jar.phase !== 'closed' && jar.phase !== 'twisting')) return;
    if (jar.phase === 'closed') {
      this.jars.forEach((other, j) => {
        if (j !== i && other.phase !== 'closed' && other.phase !== 'closing') this.close(j);
      });
    }
    jar.phase = 'twisting';
    jar.method = method;
    jar.pose = { ...jar.pose, twist: Math.min(FULL_TWIST, jar.pose.twist + Math.abs(delta)) };
    this.#quarterFeedback(jar);
    this.renderer.apply(i, jar.pose);
    if (jar.pose.twist >= FULL_TWIST - 1e-3) this.open(i, method);
  }

  /** For frame strips and Twist & send: put a jar at time t of a choreography. */
  seek(i: number, kind: 'open' | 'close', t: number) {
    const jar = this.jars[i]!;
    jar.pose = kind === 'open' ? openPose(t) : closePose(t, openPose(OPEN.settled));
    this.renderer.apply(i, jar.pose);
  }

  destroy() {
    cancelAnimationFrame(this.#raf);
    this.#cleanup.forEach((fn) => fn());
  }

  /* ------------------------------------------------------------ loop */

  #loop() {
    if (this.#raf) return;
    const frame = () => {
      this.#raf = 0;
      let active = false;
      const t = now();
      this.jars.forEach((jar, i) => {
        if (jar.phase === 'opening') {
          const s = (t - jar.t0) / 1000;
          const prev = jar.pose;
          jar.pose = openPose(s, jar.fromTwist);
          this.#quarterFeedback(jar);
          if (prev.pop < 0.01 && jar.pose.pop >= 0.01) this.#onPop(jar);
          if (prev.aroma < 0 && jar.pose.aroma >= 0) playSound('whoosh', { gain: 0.5 });
          if (!jar.panelShown && s >= OPEN.revealStart) this.#showPanel(jar, true);
          if (s >= OPEN.settled) this.#settleOpen(i, false);
          else active = true;
        } else if (jar.phase === 'closing') {
          const s = (t - jar.t0) / 1000;
          jar.pose = closePose(s, jar.closeFrom);
          this.#quarterFeedback(jar);
          if (s >= CLOSE.settled) {
            jar.phase = 'closed';
            jar.pose = { ...CLOSED };
            jar.quarter = 0;
          } else active = true;
        } else if (jar.phase === 'open') {
          // keep the revealed cookie turning slowly
          jar.pose = { ...jar.pose, spin: jar.pose.spin + 0.009 };
          active = this.renderer.kind === '3d' && !reducedMotion();
        }
        this.renderer.apply(i, jar.pose);
      });
      if (active) this.#raf = requestAnimationFrame(frame);
    };
    this.#raf = requestAnimationFrame(frame);
  }

  #quarterFeedback(jar: Jar) {
    const q = quarters(jar.pose.twist);
    if (q !== jar.quarter) {
      jar.quarter = q;
      playSound('click', { gain: 0.55 });
      buzz(8);
    }
  }

  #onPop(jar: Jar) {
    playSound('pop');
    buzz(14);
    if (!jar.tracked) {
      jar.tracked = true;
      track('kuki_twist', { handle: jar.info.handle, method: jar.method, source: this.source });
      window.setTimeout(() => (jar.tracked = false), 1500);
    }
  }

  #settleOpen(i: number, fresh = true) {
    const jar = this.jars[i]!;
    jar.phase = 'open';
    jar.pose = { ...openPose(OPEN.settled), spin: jar.pose.spin, aroma: -1 };
    jar.quarter = quarters(jar.pose.twist);
    this.renderer.apply(i, jar.pose);
    this.#showPanel(jar, true);
    if (fresh) track('kuki_twist', { handle: jar.info.handle, method: jar.method, source: this.source });
    const name = jar.info.el.querySelector('.tag__name, .visually-hidden')?.textContent?.trim() ?? jar.info.handle;
    announce(fill(i18n('jarOpen'), { flavour: name }));
    this.#loop();
  }

  #showPanel(jar: Jar, show: boolean) {
    jar.panelShown = show;
    jar.info.el.dataset.state = show ? 'open' : 'closed';
    jar.summary.setAttribute('aria-pressed', String(show));
    if (jar.details && jar.details.open !== show) {
      this.#syncing = true;
      jar.details.open = show;
      this.#syncing = false;
    }
    // Reserve exactly the room the open tag needs under the shelf.
    const shelf = jar.info.el.closest<HTMLElement>('[data-shelf]');
    const panel = jar.info.el.querySelector<HTMLElement>('[data-jar-panel]');
    if (shelf && panel && show) {
      requestAnimationFrame(() => shelf.style.setProperty('--panel-room', `${panel.offsetHeight + 24}px`));
    }
  }

  #syncing = false;

  /* ------------------------------------------------------------ input */

  #wire(jar: Jar, i: number) {
    const { summary, details } = jar;

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      if (this.#swallowClick.has(summary)) {
        this.#swallowClick.delete(summary);
        return;
      }
      this.toggle(i, e.detail === 0 ? 'keys' : 'tap');
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (jar.phase === 'closed' || jar.phase === 'twisting') this.#nudge(i, QUARTER);
      } else if (e.key === 'Escape' && jar.phase !== 'closed') {
        e.preventDefault();
        this.close(i);
      }
    };

    // Native exclusivity (<details name>) can close a jar behind our back: follow it.
    const onToggle = () => {
      if (this.#syncing || !details) return;
      if (!details.open && (jar.phase === 'open' || jar.phase === 'opening')) this.close(i);
      else if (details.open && (jar.phase === 'closed' || jar.phase === 'twisting')) this.open(i, 'tap');
    };

    // Circular drag on the lid: a zone over the lid with touch-action: none.
    const zone = document.createElement('span');
    zone.className = 'jar__lid-zone';
    zone.setAttribute('aria-hidden', 'true');
    jar.info.art.append(zone);
    let drag: { id: number; cx: number; cy: number; last: number; moved: number; x0: number; y0: number } | null = null;
    const angleAt = (x: number, y: number, d: { cx: number; cy: number }) => Math.atan2(y - d.cy, x - d.cx);
    const onDown = (e: PointerEvent) => {
      if (jar.phase !== 'closed' && jar.phase !== 'twisting') return;
      const r = jar.info.art.getBoundingClientRect();
      const d = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height * (23 / 190), last: 0, moved: 0, x0: e.clientX, y0: e.clientY };
      d.last = angleAt(e.clientX, e.clientY, d);
      drag = d;
      zone.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const a = angleAt(e.clientX, e.clientY, drag);
      let delta = a - drag.last;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      drag.last = a;
      drag.moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      if (drag.moved > 6) this.twistBy(i, delta * 1.15, 'drag');
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved > 6) this.#swallowClick.add(summary);
      drag = null;
    };

    summary.addEventListener('click', onClick);
    summary.addEventListener('keydown', onKey);
    details?.addEventListener('toggle', onToggle);
    zone.addEventListener('pointerdown', onDown);
    zone.addEventListener('pointermove', onMove);
    zone.addEventListener('pointerup', onUp);
    zone.addEventListener('pointercancel', onUp);
    const enter = () => this.renderer.hover(i, true);
    const leave = () => this.renderer.hover(i, false);
    summary.addEventListener('pointerenter', enter);
    summary.addEventListener('pointerleave', leave);
    summary.addEventListener('focus', enter);
    summary.addEventListener('blur', leave);
    this.#cleanup.push(() => {
      summary.removeEventListener('click', onClick);
      summary.removeEventListener('keydown', onKey);
      details?.removeEventListener('toggle', onToggle);
      summary.removeEventListener('pointerenter', enter);
      summary.removeEventListener('pointerleave', leave);
      summary.removeEventListener('focus', enter);
      summary.removeEventListener('blur', leave);
      zone.remove();
    });
  }

  /** ←/→: a quick quarter turn. */
  #nudge(i: number, amount: number) {
    const jar = this.jars[i]!;
    const start = jar.pose.twist;
    const target = Math.min(FULL_TWIST, start + amount);
    const t0 = now();
    const step = () => {
      const k = Math.min(1, (now() - t0) / 140);
      const want = start + (target - start) * k;
      this.twistBy(i, want - jar.pose.twist, 'keys');
      if (k < 1 && jar.phase === 'twisting') requestAnimationFrame(step);
    };
    if (reducedMotion()) this.twistBy(i, target - start, 'keys');
    else requestAnimationFrame(step);
  }
}
