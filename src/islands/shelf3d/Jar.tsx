/**
 * One 3D jar. Animation values live in a mutable JarAnim object (driven by the shelf
 * controller) and are applied in useFrame, so twisting never re-renders React.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type Material } from 'three';
import {
  berryGeometry,
  chunkGeometry,
  cookieExtras,
  cookieGeometry,
  cookieLayout,
  crumbGeometry,
  JAR_SPECS,
  jarGeometry,
  jamGeometry,
  leafGeometry,
  lidGeometry,
  revealPath,
  rng,
  seedGeometry,
  threadGeometry,
  type CookieForm,
  type ExtraSet,
} from './geometry.ts';
import { doughMaterial, extraMaterial, glassMaterial, lidMaterial, shadowTexture } from './materials.ts';

export interface JarAnim {
  /** Lid rotation in radians (positive = unscrewing). */
  twist: number;
  /** 0..1: lid popped up off the threads. */
  pop: number;
  /** 0..1: lid tipped back on its rear edge. */
  tilt: number;
  /** 0..1: hero cookie rising out and turning to camera. */
  reveal: number;
  /** 0..1: 100g → 250g jar. */
  size: number;
  /** Slow turn of the revealed cookie (radians). */
  spin: number;
  /** 0..1: hover/focus nudge. */
  hover: number;
}

export const newAnim = (): JarAnim => ({ twist: 0, pop: 0, tilt: 0, reveal: 0, size: 0, spin: 0, hover: 0 });

/** The lid rises this much per full turn as it unscrews. */
export const THREAD_PITCH = 4.6;

/* -------- caches: geometry is shared between jars of the same form -------- */

const geoCache = new Map<string, BufferGeometry>();
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** 100g geometry carrying the 250g shape as a morph target (identical vertex counts by construction). */
function morphed(key: string, make: (size: 0 | 1) => BufferGeometry): BufferGeometry {
  return cached(key, () => {
    const a = make(0);
    const b = make(1);
    a.morphAttributes.position = [new BufferAttribute((b.attributes.position!.array as Float32Array).slice(), 3)];
    a.morphAttributes.normal = [new BufferAttribute((b.attributes.normal!.array as Float32Array).slice(), 3)];
    a.morphTargetsRelative = false;
    return a;
  });
}

const extraGeo: Record<ExtraSet['kind'], () => BufferGeometry> = {
  jam: jamGeometry,
  berry: berryGeometry,
  chunk: chunkGeometry,
  leaf: leafGeometry,
  crumb: crumbGeometry,
  seed: seedGeometry,
  fleck: () => {
    const g = crumbGeometry();
    g.scale(0.75, 0.3, 0.75);
    return g;
  },
};

const DEFAULT_EXTRA_COLOUR: Partial<Record<ExtraSet['kind'], string>> = { leaf: '#2f5323', crumb: '#8fae4a', fleck: '#8d5c37' };

let shadowMat: MeshBasicMaterial | null = null;
function shadowMaterial() {
  shadowMat ??= new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false });
  return shadowMat;
}

export interface JarProps {
  form: CookieForm;
  colour: string;
  anim: JarAnim;
  seed?: number;
  lowPower?: boolean;
  showShadow?: boolean;
  /** For sprite rendering: hide parts of the jar. */
  parts?: { glass?: boolean; lid?: boolean; cookies?: boolean; hero?: boolean };
}

export function Jar({ form, colour, anim, seed = 7, lowPower = false, showShadow = true, parts = {} }: JarProps) {
  const show = { glass: true, lid: true, cookies: true, hero: true, ...parts };
  const glassGeo = useMemo(() => morphed('jar', (s) => jarGeometry(JAR_SPECS[s])), []);
  const threadGeo = useMemo(() => morphed('thread', (s) => threadGeometry(JAR_SPECS[s])), []);
  const lidGeo = useMemo(() => morphed('lid', (s) => lidGeometry(JAR_SPECS[s])), []);
  const glass = useMemo(() => glassMaterial(lowPower), [lowPower]);
  const lidMat = useMemo(() => lidMaterial(colour), [colour]);
  const dough = useMemo(() => doughMaterial(form), [form]);
  const cookieGeo = useMemo(() => cached(`cookie-${form}`, () => cookieGeometry(form)), [form]);
  const heroGeo = useMemo(() => cached(`hero-${form}`, () => cookieGeometry(form, 'high')), [form]);
  const layouts = useMemo(() => [cookieLayout(form, JAR_SPECS[0], seed), cookieLayout(form, JAR_SPECS[1], seed + 1)] as const, [form, seed]);
  const paths = useMemo(() => [revealPath(JAR_SPECS[0]), revealPath(JAR_SPECS[1])] as const, []);

  const lidPivot = useRef<Group>(null);
  const lidSpin = useRef<Group>(null);
  const glassMesh = useRef<Mesh>(null);
  const threadMesh = useRef<Mesh>(null);
  const lidMesh = useRef<Mesh>(null);
  const cookies = useRef<(InstancedMesh | null)[]>([null, null]);
  const hero = useRef<Group>(null);

  useLayoutEffect(() => {
    const base = new Color(dough.color);
    const c = new Color();
    layouts.forEach((layout, i) => {
      const mesh = cookies.current[i];
      if (!mesh) return;
      layout.cookies.forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c.copy(base).offsetHSL(0, 0, ((k * 37) % 11) / 120 - 0.04));
      });
      mesh.count = layout.cookies.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [layouts, dough]);

  useFrame(() => {
    const a = anim;
    const s = a.size;
    const s0 = JAR_SPECS[0];
    const s1 = JAR_SPECS[1];
    const lidY = s0.lidY + (s1.lidY - s0.lidY) * s;
    const lidR = s0.lidR + (s1.lidR - s0.lidR) * s;
    for (const mesh of [glassMesh.current, threadMesh.current, lidMesh.current]) {
      if (mesh?.morphTargetInfluences) mesh.morphTargetInfluences[0] = s;
    }
    // Lid: unscrews up the thread, pops free, then tips back on its rear edge.
    if (lidPivot.current && lidSpin.current) {
      const turns = Math.min(a.twist / (Math.PI * 2), 1.5);
      const rise = turns * THREAD_PITCH + a.pop * 18 + a.hover * 1.2;
      lidPivot.current.position.set(0, lidY + rise, -lidR);
      lidPivot.current.rotation.x = -a.tilt * 1.08;
      lidSpin.current.position.set(0, 0, lidR);
      lidSpin.current.rotation.y = -a.twist;
    }
    // Cookies: 100g and 250g layouts crossfade by scale while the glass morphs.
    cookies.current.forEach((mesh, i) => {
      if (!mesh) return;
      const vis = i === 0 ? 1 - s : s;
      mesh.visible = vis > 0.01;
      mesh.scale.setScalar(Math.max(0.001, vis));
    });
    // Hero cookie: rises out along a curve, stands up, faces the camera and turns slowly.
    const h = hero.current;
    if (h) {
      const r = Math.min(1, a.reveal);
      h.visible = r > 0.001 && show.hero;
      if (h.visible) {
        h.position.copy(paths[s > 0.5 ? 1 : 0].getPointAt(r));
        const stand = Math.min(1, r * 1.25);
        h.rotation.set((Math.PI / 2) * stand - 0.12 * stand, a.spin, 0);
        h.scale.setScalar(1 + 0.6 * r);
      }
    }
  });

  return (
    <group>
      {showShadow && (
        <mesh rotation-x={-Math.PI / 2} position={[8, 0.3, 6]} material={shadowMaterial()} renderOrder={-1}>
          <planeGeometry args={[160, 96]} />
        </mesh>
      )}
      {show.cookies && (
        <>
          <instancedMesh ref={(m) => void (cookies.current[0] = m)} args={[cookieGeo, dough, 48]} frustumCulled={false} />
          <instancedMesh ref={(m) => void (cookies.current[1] = m)} args={[cookieGeo, dough, 72]} frustumCulled={false} />
          {layouts[0].extras.map((set) => (
            <ExtraMesh key={`0-${set.kind}`} set={set} parentRef={cookies} index={0} />
          ))}
          {layouts[1].extras.map((set) => (
            <ExtraMesh key={`1-${set.kind}`} set={set} parentRef={cookies} index={1} />
          ))}
        </>
      )}
      {show.glass && (
        <>
          <mesh ref={glassMesh} args={[glassGeo, glass]} renderOrder={2} />
          <mesh ref={threadMesh} args={[threadGeo, glass]} renderOrder={2} />
        </>
      )}
      {show.lid && (
        <group ref={lidPivot}>
          <group ref={lidSpin}>
            <mesh ref={lidMesh} args={[lidGeo, lidMat]} />
          </group>
        </group>
      )}
      <group ref={hero} visible={false}>
        <HeroCookie form={form} geometry={heroGeo} material={dough} seed={seed} />
      </group>
    </group>
  );
}

/** Instanced toppings that follow their cookie set's visibility and scale. */
function ExtraMesh({ set, parentRef, index }: { set: ExtraSet; parentRef: RefObject<(InstancedMesh | null)[]>; index: 0 | 1 }) {
  const geo = useMemo(() => cached(`extra-${set.kind}`, extraGeo[set.kind]), [set.kind]);
  const mat = useMemo(() => extraMaterial(set.kind) as Material, [set.kind]);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new Color();
    set.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      const col = set.colors?.[i];
      mesh.setColorAt(i, c.set(col && col !== '#ffffff' ? col : (DEFAULT_EXTRA_COLOUR[set.kind] ?? '#ffffff')));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [set]);
  useFrame(() => {
    const parent = parentRef.current?.[index];
    if (ref.current && parent) {
      ref.current.visible = parent.visible;
      ref.current.scale.copy(parent.scale);
    }
  });
  return <instancedMesh ref={ref} args={[geo, mat, set.matrices.length]} frustumCulled={false} />;
}

/** The single, detailed cookie that lifts out on reveal, with its own toppings. */
function HeroCookie({ form, geometry, material, seed }: { form: CookieForm; geometry: BufferGeometry; material: Material; seed: number }) {
  const sets = useMemo(() => {
    const byKind = new Map<ExtraSet['kind'], { matrices: Matrix4[]; colors: string[] }>();
    for (const e of cookieExtras(form, rng(seed + 501))) {
      const set = byKind.get(e.kind) ?? { matrices: [], colors: [] };
      set.matrices.push(e.m);
      set.colors.push(e.color ?? '#ffffff');
      byKind.set(e.kind, set);
    }
    return [...byKind.entries()].map(([kind, v]) => ({ kind, matrices: v.matrices, colors: v.colors }) satisfies ExtraSet);
  }, [form, seed]);
  // Centre the cookie on its own middle so it turns in place.
  const offsetY = form === 'stick' ? -35 : -3.5;
  return (
    <group position={[0, offsetY, 0]}>
      <mesh geometry={geometry} material={material} />
      {sets.map((set) => (
        <StaticExtra key={set.kind} set={set} />
      ))}
    </group>
  );
}

function StaticExtra({ set }: { set: ExtraSet }) {
  const geo = useMemo(() => cached(`extra-${set.kind}`, extraGeo[set.kind]), [set.kind]);
  const mat = useMemo(() => extraMaterial(set.kind) as Material, [set.kind]);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new Color();
    set.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      const col = set.colors?.[i];
      mesh.setColorAt(i, c.set(col && col !== '#ffffff' ? col : (DEFAULT_EXTRA_COLOUR[set.kind] ?? '#ffffff')));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [set]);
  return <instancedMesh ref={ref} args={[geo, mat, set.matrices.length]} />;
}
