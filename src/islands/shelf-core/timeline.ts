/**
 * The jar choreography as a pure function of time, so the 2D shelf, the 3D shelf, the
 * frame strips and the Twist & send video all show exactly the same moment for the same t.
 *
 * Open (tap / Enter / "Twist"):            Close (screw back on):
 *   0.00–0.72  lid unscrews 1.5 turns        0.00–0.35  cookie sinks back
 *   0.72–0.86  lid pops free                 0.20–0.50  lid tips back down
 *   0.80–1.20  lid tips back on its rim      0.45–0.60  lid drops onto the thread
 *   0.82–2.22  aroma burst                   0.55–1.05  lid screws on 1.5 turns
 *   0.95–1.75  one cookie lifts out and turns to face you
 */

export interface JarPose {
  /** lid rotation, radians (0 → 3π = 1.5 turns) */
  twist: number;
  pop: number;
  tilt: number;
  reveal: number;
  /** seconds since the aroma burst began, or -1 */
  aroma: number;
  /** slow turn of the revealed cookie, radians */
  spin: number;
}

export const FULL_TWIST = Math.PI * 3;
export const QUARTER = Math.PI / 2;

export const OPEN = {
  twistEnd: 0.72,
  popStart: 0.72,
  popEnd: 0.86,
  tiltStart: 0.8,
  tiltEnd: 1.2,
  aromaStart: 0.82,
  aromaLength: 1.4,
  revealStart: 0.95,
  revealEnd: 1.75,
  /** after this the jar is simply "open" (the cookie keeps turning slowly) */
  settled: 1.75,
} as const;

export const CLOSE = {
  revealEnd: 0.35,
  tiltStart: 0.2,
  tiltEnd: 0.5,
  popStart: 0.45,
  popEnd: 0.6,
  twistStart: 0.55,
  twistEnd: 1.05,
  settled: 1.05,
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInCubic = (x: number) => x * x * x;
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export const CLOSED: JarPose = { twist: 0, pop: 0, tilt: 0, reveal: 0, aroma: -1, spin: 0 };

/** Pose at time t (seconds) into the open choreography. `fromTwist` lets a manual twist hand over. */
export function openPose(t: number, fromTwist = 0): JarPose {
  const twistT = span(t, 0, OPEN.twistEnd);
  const twist = fromTwist + (FULL_TWIST - fromTwist) * easeInOutSine(twistT);
  const pop = easeOutBack(span(t, OPEN.popStart, OPEN.popEnd));
  const tilt = easeOutBack(span(t, OPEN.tiltStart, OPEN.tiltEnd));
  const reveal = easeOutCubic(span(t, OPEN.revealStart, OPEN.revealEnd));
  const aroma = t >= OPEN.aromaStart && t <= OPEN.aromaStart + OPEN.aromaLength ? t - OPEN.aromaStart : -1;
  const spin = t > OPEN.revealEnd ? (t - OPEN.revealEnd) * 0.55 : 0;
  return { twist, pop, tilt, reveal, aroma, spin };
}

/** Pose at time t into closing, starting from an open pose. */
export function closePose(t: number, from: JarPose): JarPose {
  const reveal = from.reveal * (1 - easeInCubic(span(t, 0, CLOSE.revealEnd)));
  const tilt = from.tilt * (1 - easeOutCubic(span(t, CLOSE.tiltStart, CLOSE.tiltEnd)));
  const pop = from.pop * (1 - easeOutCubic(span(t, CLOSE.popStart, CLOSE.popEnd)));
  const twist = from.twist * (1 - easeInOutSine(span(t, CLOSE.twistStart, CLOSE.twistEnd)));
  return { twist, pop, tilt, reveal, aroma: -1, spin: from.spin };
}

/** Which quarter turn (0..6) a twist angle has passed — for clicks and haptics. */
export const quarters = (twist: number) => Math.floor((twist + 1e-6) / QUARTER);
