/**
 * Procedural geometry for the 3D shelf: thick glass jars, knurled screw lids, neck threads,
 * and one cookie generator per flavour form. Units are "jar units": the 2D jar art box is
 * 140 × 190 and a jar stands on y = 0, so 3D jars can sit exactly where the DOM jars are.
 * Everything is seeded, so every visit (and every pre-rendered sprite) looks the same.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  Curve,
  Euler,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  ShapeGeometry,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';

export type CookieForm = 'thumbprint' | 'malt_round' | 'leaf_crust' | 'chunk' | 'stick' | 'nut_crust';
export type SizeIndex = 0 | 1;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- jars */

export interface JarSpec {
  bodyR: number;
  neckR: number;
  shoulderY: number;
  neckY: number;
  rimY: number;
  lidR: number;
  lidH: number;
  lidY: number;
  wall: number;
  base: number;
  fill: number;
}

/** 100g matches the 2D art box (140 × 190); 250g is a bigger jar for the size switch. */
export const JAR_SPECS: Record<SizeIndex, JarSpec> = {
  0: { bodyR: 54, neckR: 34, shoulderY: 112, neckY: 134, rimY: 150, lidR: 42, lidH: 30, lidY: 141, wall: 3.4, base: 10, fill: 0.78 },
  1: { bodyR: 62, neckR: 38, shoulderY: 152, neckY: 176, rimY: 193, lidR: 46, lidH: 32, lidY: 183, wall: 3.8, base: 11, fill: 0.86 },
};

function shoulder(from: [number, number], to: [number, number], steps: number): [number, number][] {
  // Quadratic curve from the body wall in to the neck.
  const c: [number, number] = [from[0], to[1] - (to[1] - from[1]) * 0.15];
  const pts: [number, number][] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * c[0] + t * t * to[0];
    const y = (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * c[1] + t * t * to[1];
    pts.push([x, y]);
  }
  return pts;
}

/** A closed lathe: outer wall up, rolled rim, inner wall down, thick base. */
export function jarGeometry(spec: JarSpec, radial = 96): BufferGeometry {
  const s = spec;
  const w = s.wall;
  const outer: [number, number][] = [
    [0, 0],
    [s.bodyR - 7, 0],
    [s.bodyR - 1.6, 1.1],
    [s.bodyR, 5],
    [s.bodyR, s.shoulderY],
    ...shoulder([s.bodyR, s.shoulderY], [s.neckR, s.neckY], 9),
    [s.neckR, s.neckY],
    [s.neckR, s.rimY - 2.4],
    [s.neckR + 1.1, s.rimY - 1.2],
    [s.neckR + 0.4, s.rimY],
    [s.neckR - w * 0.5, s.rimY + 0.4],
  ];
  const inner: [number, number][] = [
    [s.neckR - w, s.rimY - 0.4],
    [s.neckR - w, s.neckY],
    ...shoulder([s.bodyR - w, s.shoulderY], [s.neckR - w, s.neckY], 9).reverse(),
    [s.bodyR - w, s.shoulderY],
    [s.bodyR - w, s.base + 2.5],
    [s.bodyR - w - 2.5, s.base],
    [0, s.base],
  ];
  const pts = [...outer, ...inner].map(([x, y]) => new Vector2(x, y));
  const g = new LatheGeometry(pts, radial);
  g.computeVertexNormals();
  return g;
}

/** Inner cavity radius at a height (used to keep cookies inside the glass). */
export function innerRadiusAt(spec: JarSpec, y: number): number {
  if (y <= spec.shoulderY) return spec.bodyR - spec.wall;
  if (y >= spec.neckY) return spec.neckR - spec.wall;
  const t = (y - spec.shoulderY) / (spec.neckY - spec.shoulderY);
  return spec.bodyR - spec.wall - (spec.bodyR - spec.neckR) * t * t;
}

/** A painted screw lid with a knurled band (48 grooves) and a rolled top edge. */
export function lidGeometry(spec: JarSpec, grooves = 48): BufferGeometry {
  const R = spec.lidR;
  const H = spec.lidH;
  const profile: [number, number][] = [
    [0, H],
    [R - 5, H],
    [R - 1.6, H - 0.7],
    [R - 0.2, H - 2.8],
    [R, H - 5],
    [R, 4.5],
    [R - 0.2, 2],
    [R - 1.4, 0.4],
    [R - 3, 0],
    [R - 3.6, 0],
    [R - 3.6, H - 3.5],
    [0, H - 3.5],
  ];
  const g = new LatheGeometry(
    profile.map(([x, y]) => new Vector2(x, y)),
    grooves * 6,
  );
  const pos = g.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r > R - 0.05 && v.y > 5 && v.y < H - 5.5) {
      const theta = Math.atan2(v.z, v.x);
      const k = 0.5 + 0.5 * Math.cos(theta * grooves);
      const depth = 0.95 * Math.pow(k, 4);
      const scale = (r - depth) / r;
      pos.setXYZ(i, v.x * scale, v.y, v.z * scale);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

class Helix extends Curve<Vector3> {
  constructor(
    private r: number,
    private y0: number,
    private y1: number,
    private turns: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, this.y0 + (this.y1 - this.y0) * t, Math.sin(a) * this.r);
  }
}

export function threadGeometry(spec: JarSpec): BufferGeometry {
  return new TubeGeometry(new Helix(spec.neckR + 0.55, spec.neckY + 3, spec.rimY - 4.5, 2.2), 240, 0.95, 8, false);
}

/* ------------------------------------------------------------- cookies */

const noise = new SimplexNoise({ random: rng(1234) });

export interface CookieDims {
  r: number;
  t: number;
}

export const COOKIE_DIMS: Record<CookieForm, CookieDims> = {
  thumbprint: { r: 16.5, t: 7.5 },
  malt_round: { r: 17, t: 6.2 },
  leaf_crust: { r: 16.5, t: 6.8 },
  chunk: { r: 17.5, t: 8.5 },
  stick: { r: 5, t: 70 },
  nut_crust: { r: 16, t: 6.6 },
};

function fbm(x: number, y: number, z: number, octaves = 3): number {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise.noise3d(x * f, y * f, z * f);
    f *= 2.1;
    a *= 0.5;
  }
  return sum;
}

/** Round cookie: a domed disc from a lathe profile, roughened with noise. */
export function cookieGeometry(form: CookieForm, detail: 'low' | 'high' = 'low'): BufferGeometry {
  if (form === 'stick') return stickGeometry(detail);
  const { r: R, t: T } = COOKIE_DIMS[form];
  const thumb = form === 'thumbprint';
  const profile: [number, number][] = thumb
    ? [
        [0, T * 0.5],
        [R * 0.22, T * 0.55],
        [R * 0.36, T * 0.82],
        [R * 0.48, T * 1.0],
        [R * 0.7, T * 0.97],
        [R * 0.88, T * 0.82],
        [R * 0.98, T * 0.58],
        [R, T * 0.36],
        [R * 0.96, T * 0.1],
        [R * 0.86, 0],
        [0, 0],
      ]
    : [
        [0, T],
        [R * 0.35, T * 0.99],
        [R * 0.62, T * 0.95],
        [R * 0.84, T * 0.84],
        [R * 0.96, T * 0.62],
        [R, T * 0.38],
        [R * 0.97, T * 0.12],
        [R * 0.88, 0],
        [0, 0],
      ];
  const g = new LatheGeometry(
    profile.map(([x, y]) => new Vector2(x, y)),
    detail === 'high' ? 96 : 40,
  );
  roughen(g, form, R, T);
  return g;
}

function roughen(g: BufferGeometry, form: CookieForm, R: number, T: number) {
  const pos = g.attributes.position!;
  const v = new Vector3();
  const amp = form === 'malt_round' ? 1.05 : form === 'chunk' ? 0.75 : form === 'leaf_crust' ? 0.6 : 0.45;
  const freq = form === 'malt_round' ? 0.34 : 0.18;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    const n = fbm(v.x * freq, v.y * freq, v.z * freq, 3);
    const top = v.y > T * 0.55 && r < R * 0.9;
    if (top) {
      v.y += n * amp;
      // Malt rounds crack across the top.
      if (form === 'malt_round') v.y -= Math.max(0, Math.abs(noise.noise3d(v.x * 0.09, 1.7, v.z * 0.09)) < 0.07 ? 1.1 : 0);
      // Nutella chunk rounds have pocks.
      if (form === 'chunk') v.y -= Math.max(0, noise.noise3d(v.x * 0.22, 3.1, v.z * 0.22) - 0.45) * 3.2;
    } else if (r > 0.01) {
      const s = (r + n * amp * 0.8) / r;
      v.x *= s;
      v.z *= s;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/** Omam: a crisp baked stick, rounded square in section, standing upright. */
function stickGeometry(detail: 'low' | 'high'): BufferGeometry {
  const g = new RoundedBoxGeometry(9.5, 70, 9.5, detail === 'high' ? 4 : 2, 3.6);
  g.translate(0, 35, 0);
  const pos = g.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 0.25, v.y * 0.25, v.z * 0.25, 2) * 0.45;
    const r = Math.hypot(v.x, v.z) || 1;
    pos.setXYZ(i, v.x * (1 + n / r), v.y, v.z * (1 + n / r));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/* -------------------------------------------------------------- extras */

export function jamGeometry(): BufferGeometry {
  const g = new SphereGeometry(5.6, 28, 14);
  g.scale(1, 0.34, 1);
  return g;
}

export function berryGeometry(): BufferGeometry {
  const g = new SphereGeometry(2.2, 14, 10);
  const pos = g.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise.noise3d(v.x * 1.4, v.y * 1.4, v.z * 1.4) * 0.28;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function chunkGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(3, 1);
  const pos = g.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + noise.noise3d(v.x * 0.7, v.y * 0.7, v.z * 0.7) * 0.35);
    pos.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function leafGeometry(): BufferGeometry {
  const s = new Shape();
  s.moveTo(-3.6, 0);
  s.quadraticCurveTo(0, 2.1, 3.6, 0);
  s.quadraticCurveTo(0, -2.1, -3.6, 0);
  const g = new ShapeGeometry(s, 8);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // curl the toasted leaf a little
    pos.setXYZ(i, x, y, 0.35 * Math.cos(x * 0.6) + 0.25 * y * y);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function crumbGeometry(): BufferGeometry {
  return new IcosahedronGeometry(1.15, 0);
}

export function seedGeometry(): BufferGeometry {
  const g = new SphereGeometry(0.75, 7, 5);
  g.scale(1.5, 0.75, 0.8);
  return g;
}

/* -------------------------------------------------------------- layout */

export interface ExtraSet {
  kind: 'jam' | 'berry' | 'chunk' | 'leaf' | 'crumb' | 'seed' | 'fleck';
  matrices: Matrix4[];
  colors?: string[];
}

export interface CookieLayout {
  cookies: Matrix4[];
  extras: ExtraSet[];
}

const up = new Vector3(0, 1, 0);

/** Extras (jam, berries, leaves, chunks, crumbs, seeds) on one cookie, in its local space. */
export function cookieExtras(form: CookieForm, rand: () => number): { kind: ExtraSet['kind']; m: Matrix4; color?: string }[] {
  const { r: R, t: T } = COOKIE_DIMS[form];
  const out: { kind: ExtraSet['kind']; m: Matrix4; color?: string }[] = [];
  const q = new Quaternion();
  const place = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
    new Matrix4().compose(new Vector3(x, y, z), q.setFromEuler(new Euler(rx, ry, rz)).clone(), new Vector3(s, s, s));

  if (form === 'thumbprint') {
    out.push({ kind: 'jam', m: place(0, T * 0.56, 0) });
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = 1.2 + rand() * 2;
      out.push({ kind: 'berry', m: place(Math.cos(a) * d, T * 0.7, Math.sin(a) * d, rand() * 3, rand() * 3, 0, 0.85 + rand() * 0.3) });
    }
  } else if (form === 'chunk') {
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * R * 0.7;
      out.push({ kind: 'chunk', m: place(Math.cos(a) * d, T * 0.92 - (d / R) * 1.5, Math.sin(a) * d, rand() * 3, rand() * 3, rand() * 3, 0.8 + rand() * 0.6) });
    }
  } else if (form === 'leaf_crust') {
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * R * 0.9;
      out.push({ kind: 'leaf', m: place(Math.cos(a) * d, T * 0.96 - (d / R) * 1.8, Math.sin(a) * d, (rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5, 0.9 + rand() * 0.6), color: ['#23401a', '#2f5323', '#3d6a2b', '#4b5f22'][Math.floor(rand() * 4)] });
    }
  } else if (form === 'nut_crust') {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + rand() * 0.18;
      const d = R * (0.86 + rand() * 0.14);
      const y = T * (0.25 + rand() * 0.55);
      out.push({ kind: 'crumb', m: place(Math.cos(a) * d, y, Math.sin(a) * d, rand() * 3, rand() * 3, rand() * 3, 0.7 + rand() * 0.6), color: ['#8fae4a', '#6f8f37', '#bcd07f', '#9fb85a'][Math.floor(rand() * 4)] });
    }
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * R * 0.55;
      out.push({ kind: 'fleck', m: place(Math.cos(a) * d, T * 1.0, Math.sin(a) * d, 0, rand() * 3, 0, 0.7 + rand() * 0.5), color: '#a8435f' });
    }
  } else if (form === 'malt_round') {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * R * 0.8;
      out.push({ kind: 'fleck', m: place(Math.cos(a) * d, T * 1.0, Math.sin(a) * d, 0, rand() * 3, 0, 0.6 + rand() * 0.5), color: rand() > 0.5 ? '#8d5c37' : '#2f1a0d' });
    }
  } else if (form === 'stick') {
    for (let i = 0; i < 22; i++) {
      const side = Math.floor(rand() * 4);
      const y = 3 + rand() * 64;
      const off = (rand() - 0.5) * 7;
      const p = side === 0 ? [4.9, y, off] : side === 1 ? [-4.9, y, off] : side === 2 ? [off, y, 4.9] : [off, y, -4.9];
      out.push({ kind: 'seed', m: place(p[0]!, p[1]!, p[2]!, rand() * 3, rand() * 3, rand() * 3, 0.8 + rand() * 0.4) });
    }
  }
  return out;
}

/**
 * Cookies settled in a jar: round cookies lean against the glass, faces outward (so you
 * see their texture through it), in layers up to the fill line; omam sticks stand upright.
 */
export function cookieLayout(form: CookieForm, spec: JarSpec, seed: number): CookieLayout {
  const rand = rng(seed);
  const cookies: Matrix4[] = [];
  const extrasByKind = new Map<ExtraSet['kind'], ExtraSet>();
  const pushExtras = (cookie: Matrix4) => {
    for (const e of cookieExtras(form, rand)) {
      let set = extrasByKind.get(e.kind);
      if (!set) {
        set = { kind: e.kind, matrices: [], colors: [] };
        extrasByKind.set(e.kind, set);
      }
      set.matrices.push(cookie.clone().multiply(e.m));
      set.colors!.push(e.color ?? '#ffffff');
    }
  };
  const q = new Quaternion();
  const fillTop = spec.base + (spec.shoulderY - spec.base) * spec.fill;

  if (form === 'stick') {
    // Packed upright like breadsticks in a glass: three rings and a centre.
    const wallR = spec.bodyR - spec.wall;
    const rings = [
      { n: 11, d: wallR - 6.5 },
      { n: 7, d: wallR - 19 },
      { n: 4, d: wallR - 31 },
      { n: 1, d: 0 },
    ];
    const tall = (spec.shoulderY - spec.base) * 0.95;
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + rand() * 0.3 + ring.d * 0.01;
        const lean = ring.d > 30 ? 0.06 + rand() * 0.05 : rand() * 0.06;
        const m = new Matrix4().compose(
          new Vector3(Math.cos(a) * ring.d, spec.base - 1 + rand() * 2, Math.sin(a) * ring.d),
          q.setFromEuler(new Euler(Math.sin(a) * lean, rand() * Math.PI, -Math.cos(a) * lean)).clone(),
          new Vector3(1, (tall / 70) * (0.82 + rand() * 0.2), 1),
        );
        cookies.push(m);
        pushExtras(m);
      }
    }
  } else {
    const { r: R, t: T } = COOKIE_DIMS[form];
    let y = spec.base + R * 0.55;
    let layer = 0;
    while (y < fillTop) {
      const inner = innerRadiusAt(spec, y);
      const perLayer = inner > 48 ? 5 : 4;
      const offset = layer * 0.7 + rand() * 0.5;
      for (let k = 0; k < perLayer; k++) {
        const a = offset + (k / perLayer) * Math.PI * 2 + (rand() - 0.5) * 0.35;
        const tilt = (40 + rand() * 32) * (Math.PI / 180); // from flat towards upright, leaning on the glass
        const d = inner - R * Math.cos(tilt) - T * 0.55 * Math.sin(tilt) - 0.8;
        const pos = new Vector3(Math.cos(a) * d, y + R * Math.sin(tilt) * 0.45, Math.sin(a) * d);
        // Face points outward and up: rotate the cookie's "up" towards the radial direction.
        const radial = new Vector3(Math.cos(a), 0, Math.sin(a));
        const normal = up.clone().multiplyScalar(Math.cos(tilt)).add(radial.multiplyScalar(Math.sin(tilt))).normalize();
        const orient = new Quaternion().setFromUnitVectors(up, normal);
        const spin = new Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2);
        const m = new Matrix4().compose(pos, orient.multiply(spin), new Vector3(1, 1, 1));
        cookies.push(m);
        pushExtras(m);
      }
      // One lying flat in the middle of the layer.
      if (inner > 40) {
        const m = new Matrix4().compose(
          new Vector3((rand() - 0.5) * 6, y - R * 0.2, (rand() - 0.5) * 6),
          q.setFromEuler(new Euler((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5)).clone(),
          new Vector3(1, 1, 1),
        );
        cookies.push(m);
        pushExtras(m);
      }
      y += R * 1.05;
      layer += 1;
    }
  }
  return { cookies, extras: [...extrasByKind.values()] };
}

/** A gentle path for the hero cookie: up out of the jar, then a little toward the camera. */
export function revealPath(spec: JarSpec): CatmullRomCurve3 {
  return new CatmullRomCurve3([
    new Vector3(0, spec.shoulderY * 0.7, 0),
    new Vector3(0, spec.rimY + 14, 10),
    new Vector3(6, spec.rimY + 44, 40),
    new Vector3(10, spec.rimY + 58, 64),
  ]);
}
