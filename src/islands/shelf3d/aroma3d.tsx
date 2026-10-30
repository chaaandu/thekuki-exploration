/**
 * 3D aroma bursts. Uses the same particle paths as the 2D shelf (so both tiers and the
 * Twist & send video agree), lifted into 3D with a little depth. Instance transforms are
 * computed from the burst time each frame; particles fade by shrinking.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  ShapeGeometry,
  Shape,
  TubeGeometry,
  Vector3,
} from 'three';
import { berryGeometry, crumbGeometry, leafGeometry, seedGeometry, JAR_SPECS } from './geometry.ts';
import { particlesFor } from '../shelf2d/aroma2d.ts';
import type { Aroma } from '../shelf-core/types.ts';
import type { JarAnim } from './Jar.tsx';

function petalGeometry(): BufferGeometry {
  const s = new Shape();
  s.moveTo(0, -5);
  s.bezierCurveTo(4.4, -3, 4.4, 3, 0, 5);
  s.bezierCurveTo(-4.4, 3, -4.4, -3, 0, -5);
  const g = new ShapeGeometry(s, 10);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.18 * pos.getX(i) * pos.getX(i));
  g.computeVertexNormals();
  return g;
}

const SHAPE_GEO: Record<string, () => BufferGeometry> = {
  leaf: () => {
    const g = leafGeometry();
    g.rotateX(Math.PI / 2);
    g.scale(1.5, 1.5, 1.5);
    return g;
  },
  seed: () => {
    const g = seedGeometry();
    g.scale(1.4, 1.4, 1.4);
    return g;
  },
  petal: petalGeometry,
  crumb: () => {
    const g = crumbGeometry();
    g.scale(1.2, 1.2, 1.2);
    return g;
  },
  berry: berryGeometry,
  dust: () => new IcosahedronGeometry(1.1, 0),
};

const SHAPE_MAT: Record<string, () => MeshStandardMaterial | MeshPhysicalMaterial> = {
  leaf: () => new MeshStandardMaterial({ color: '#2f5323', roughness: 0.6, side: 2 }),
  seed: () => new MeshStandardMaterial({ color: '#7a6a3a', roughness: 0.7 }),
  petal: () => new MeshStandardMaterial({ color: '#e58aa5', roughness: 0.55, side: 2 }),
  crumb: () => new MeshStandardMaterial({ color: '#8fae4a', roughness: 0.7 }),
  berry: () => new MeshPhysicalMaterial({ color: '#2b2654', roughness: 0.4, clearcoat: 0.5, sheen: 0.6, sheenColor: new Color('#8a85c6') }),
  dust: () => new MeshStandardMaterial({ color: '#8a5a36', roughness: 0.9 }),
};

export function AromaBurst({ aroma, anim, seed, size }: { aroma: Aroma; anim: JarAnim & { aroma: number }; seed: number; size: () => number }) {
  const particles = useMemo(() => particlesFor(aroma, seed), [aroma, seed]);
  const groups = useMemo(() => {
    const byShape = new Map<string, number[]>();
    particles.forEach((p, i) => {
      if (p.shape === 'ribbon') return;
      const list = byShape.get(p.shape) ?? [];
      list.push(i);
      byShape.set(p.shape, list);
    });
    return [...byShape.entries()].map(([shape, idx]) => ({ shape, idx, geo: SHAPE_GEO[shape]!(), mat: SHAPE_MAT[shape]!() }));
  }, [particles]);
  const depth = useMemo(() => particles.map((_, i) => Math.sin(i * 12.9898 + seed) * 22), [particles, seed]);
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const ribbon = useRef<Mesh>(null);
  const tmp = useMemo(() => new Object3D(), []);

  const ribbonGeo = useMemo(() => {
    if (aroma !== 'hazelnut_ribbon') return null;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const k = i / 40;
      const a = k * Math.PI * 3.2;
      pts.push(new Vector3(Math.cos(a) * (18 - 10 * k), k * 120, Math.sin(a) * (18 - 10 * k)));
    }
    return new TubeGeometry(new CatmullRomCurve3(pts), 160, 3.4, 10, false);
  }, [aroma]);
  const ribbonMat = useMemo(
    () => new MeshPhysicalMaterial({ color: '#5b3018', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new Color('#b07a52') }),
    [],
  );

  useFrame(() => {
    const t = anim.aroma;
    const rim = JAR_SPECS[0].rimY + (JAR_SPECS[1].rimY - JAR_SPECS[0].rimY) * size();
    groups.forEach((g, gi) => {
      const mesh = refs.current[gi];
      if (!mesh) return;
      mesh.visible = t >= 0;
      if (t < 0) return;
      g.idx.forEach((pi, k) => {
        const p = particles[pi]!;
        const [x, y, rot, o] = p.at(t);
        tmp.position.set(x, rim + 6 + y, depth[pi]! + (p.shape === 'berry' ? 30 : 0));
        tmp.rotation.set(rot * 0.017 * 0.6, rot * 0.017, rot * 0.017 * 0.3);
        tmp.scale.setScalar(Math.max(0.0001, o) * (p.size / 9));
        tmp.updateMatrix();
        mesh.setMatrixAt(k, tmp.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (ribbon.current && ribbonGeo) {
      const on = t >= 0 && t < 1.4;
      ribbon.current.visible = on;
      if (on) {
        const grow = Math.min(1, t / 0.7);
        const fade = t > 1.0 ? 1 - (t - 1.0) / 0.4 : 1;
        ribbonGeo.setDrawRange(0, Math.floor((ribbonGeo.index?.count ?? 0) * grow));
        ribbon.current.position.set(0, rim - 4, 6);
        ribbon.current.rotation.y = t * 1.8;
        ribbon.current.scale.setScalar(Math.max(0.0001, fade));
      }
    }
  });

  return (
    <group>
      {groups.map((g, gi) => (
        <instancedMesh key={g.shape} ref={(m) => void (refs.current[gi] = m)} args={[g.geo, g.mat, g.idx.length]} frustumCulled={false} visible={false} />
      ))}
      {ribbonGeo && <mesh ref={ribbon} geometry={ribbonGeo} material={ribbonMat} visible={false} />}
    </group>
  );
}
