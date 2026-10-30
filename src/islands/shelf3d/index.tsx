/**
 * The 3D shelf. A transparent canvas sits inside the shelf stage; its camera maps one world
 * unit to one CSS pixel on the z = 0 plane, and each 3D jar is placed exactly where its DOM
 * jar is (the DOM stays the source of truth for layout, input, tags and accessibility).
 * Renders on demand only: while something moves, or the layout changes.
 */
import { createRoot, extend, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  BoxGeometry,
  CircleGeometry,
  Color,
  CubeCamera,
  DirectionalLight,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Scene as ThreeScene,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';

// createRoot (unlike <Canvas>) doesn't register three's classes; register only what we use.
extend({ Points, AmbientLight, BoxGeometry, CircleGeometry, Color, CubeCamera, DirectionalLight, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, RingGeometry, Scene: ThreeScene });
import type { JarPose } from '../shelf-core/timeline.ts';
import type { JarInfo, ShelfRenderer } from '../shelf-core/types.ts';
import type { Daypart } from '../../shared/time.ts';
import { Jar, newAnim, type JarAnim } from './Jar.tsx';
import { Lights } from './Lights.tsx';
import { AromaBurst } from './aroma3d.tsx';

type Anim = JarAnim & { aroma: number; sizeTarget: number; hoverTarget: number };

interface Store {
  onSlow: () => void;
  jars: JarInfo[];
  anims: Anim[];
  canvas: HTMLCanvasElement;
  version: number;
  invalidate: () => void;
  daypart: Daypart;
  lowPower: boolean;
}

const FOV = 30;
const ART_W = 140;
const ART_BASE = 180 / 190; // the glass bottom sits at 180 of the 190-unit art box

/** Camera so that the z = 0 plane maps 1:1 onto the canvas in CSS pixels. */
function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.fov = FOV;
    cam.aspect = size.width / size.height;
    cam.near = 10;
    cam.far = 8000;
    cam.position.set(0, 0, size.height / 2 / Math.tan((FOV * Math.PI) / 360));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/** Each 3D jar follows its DOM jar (position + scale) every frame it renders. */
function PlacedJar({ store, i }: { store: Store; i: number }) {
  const ref = useRef<Group>(null);
  const info = store.jars[i]!;
  const anim = store.anims[i]!;
  const { size } = useThree();
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const c = store.canvas.getBoundingClientRect();
    const r = info.art.getBoundingClientRect();
    const s = r.width / ART_W;
    g.position.set(r.left + r.width / 2 - c.left - size.width / 2, size.height / 2 - (r.top + r.height * ART_BASE - c.top), 0);
    g.scale.setScalar(s);
    // Ease size and hover toward their targets.
    const k = 1 - Math.exp(-dt * 9);
    const before = anim.size + anim.hover;
    anim.size += (anim.sizeTarget - anim.size) * k;
    anim.hover += (anim.hoverTarget - anim.hover) * k;
    if (Math.abs(anim.size + anim.hover - before) > 1e-4) store.invalidate();
  });
  return (
    <group ref={ref}>
      <Jar form={info.form} colour={info.colour} anim={anim} seed={i * 13 + 7} lowPower={store.lowPower} />
      {info.aroma && <AromaBurst aroma={info.aroma} anim={anim} seed={101 + i * 17} size={() => anim.size} />}
    </group>
  );
}

/**
 * A plane in the colour of the wall that only the glass can see: it's drawn into the
 * transmission (refraction) buffer but not onto the transparent canvas, so jars refract the
 * real wall colour while the DOM wall shows through everywhere else.
 */
function WallCard({ store }: { store: Store }) {
  const mesh = useRef<Mesh>(null);
  const mat = useMemo(() => new MeshBasicMaterial({ color: '#f3e8d4', toneMapped: false }), []);
  const { size } = useThree();
  useEffect(() => {
    const read = () => {
      const wall = getComputedStyle(store.canvas.closest('.shelf, .pdp') ?? document.body).getPropertyValue('--wall').trim();
      if (wall) mat.color.set(wall);
      store.invalidate();
    };
    read();
    document.addEventListener('kuki:daypart', read);
    return () => document.removeEventListener('kuki:daypart', read);
  }, [mat, store]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.onBeforeRender = (renderer: WebGLRenderer) => {
      const transmissionPass = renderer.getRenderTarget() !== null;
      mat.colorWrite = transmissionPass;
      mat.depthWrite = transmissionPass;
    };
  }, [mat]);
  return (
    <mesh ref={mesh} position={[0, 0, -260]} material={mat} renderOrder={-10}>
      <planeGeometry args={[size.width * 2, size.height * 2]} />
    </mesh>
  );
}

function Ready({ onReady }: { onReady: () => void }) {
  const { gl, scene, camera, invalidate } = useThree();
  useEffect(() => {
    let cancelled = false;
    const compile = (gl as WebGLRenderer).compileAsync?.(scene, camera) ?? Promise.resolve();
    compile.then(() => {
      if (cancelled) return;
      invalidate();
      requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && onReady()));
    });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, invalidate, onReady]);
  return null;
}

/** Dust motes drifting in the window light (left), day and chai time only. */
function Motes({ store }: { store: Store }) {
  const { size, invalidate } = useThree();
  const count = 70;
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 0.45 - 0.5) * size.width;
      pos[i * 3 + 1] = (Math.random() * 0.8 - 0.1) * size.height * 0.5;
      pos[i * 3 + 2] = Math.random() * 300 - 150;
      seed[i] = Math.random() * 100;
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('seed', new BufferAttribute(seed, 1));
    return g;
  }, [size.width, size.height]);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#fff1d6') } },
        vertexShader: `attribute float seed; uniform float uTime; varying float vA;
          void main(){ vec3 p = position; float t = uTime * 0.06 + seed;
            p.x += sin(t * 1.3) * 18.0; p.y += sin(t * 0.9 + seed) * 24.0 + mod(uTime * 4.0 + seed * 7.0, 60.0) - 30.0;
            vA = 0.35 + 0.35 * sin(uTime * 0.8 + seed * 3.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 3.2 * (1000.0 / -mv.z); }`,
        fragmentShader: `uniform vec3 uColor; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.0, d)); }`,
      }),
    [],
  );
  useEffect(() => {
    // ~24 fps is plenty for motes, and only while the shelf is on screen and the tab visible.
    let visible = true;
    const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)));
    io.observe(store.canvas);
    const id = window.setInterval(() => {
      if (visible && document.visibilityState === 'visible') {
        mat.uniforms.uTime!.value = performance.now() / 1000;
        invalidate();
      }
    }, 42);
    return () => {
      window.clearInterval(id);
      io.disconnect();
    };
  }, [mat, invalidate, store]);
  return <points geometry={geo} material={mat} />;
}

/** If the device can't keep up while jars animate, tell the island to go back to 2D. */
function FrameMonitor({ store }: { store: Store }) {
  const samples = useRef<number[]>([]);
  const last = useRef(0);
  useFrame(() => {
    const t = performance.now();
    const dt = t - last.current;
    last.current = t;
    if (dt > 0 && dt < 250 && store.anims.some((a) => a.aroma >= 0 || (a.twist > 0 && a.reveal < 1))) {
      samples.current.push(dt);
      if (samples.current.length >= 40) {
        const sorted = [...samples.current].sort((x, y) => x - y);
        const median = sorted[20]!;
        samples.current = [];
        if (median > 38) store.onSlow();
      }
    }
  });
  return null;
}

function Scene({ store, onReady }: { store: Store; onReady: () => void }) {
  const { invalidate, size } = useThree();
  store.invalidate = invalidate;
  const bulbX = (parseFloat(getComputedStyle(store.canvas.closest('.shelf') ?? document.body).getPropertyValue('--bulb-x')) || 78) / 100 - 0.5;
  const showMotes = !store.lowPower && (store.daypart === 'day' || store.daypart === 'chai' || store.daypart === 'morning');
  return (
    <>
      <CameraRig />
      <Lights daypart={store.daypart} width={size.width} height={size.height} bulbX={bulbX} />
      {showMotes && <Motes store={store} />}
      <FrameMonitor store={store} />
      <WallCard store={store} />
      {store.jars.map((_, i) => (
        <PlacedJar key={i} store={store} i={i} />
      ))}
      <Ready onReady={onReady} />
    </>
  );
}

export async function createShelf3D(shelf: HTMLElement, jars: JarInfo[], opts: { dpr: number; lowPower: boolean; onSlow?: () => void }) {
  const stage = shelf.querySelector<HTMLElement>('[data-shelf-stage]') ?? shelf;
  const canvas = document.createElement('canvas');
  canvas.className = 'shelf__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);

  const store: Store = {
    onSlow: () => opts.onSlow?.(),
    jars,
    anims: jars.map(() => ({ ...newAnim(), aroma: -1, sizeTarget: 0, hoverTarget: 0 })),
    canvas,
    version: 0,
    invalidate: () => {},
    daypart: (document.documentElement.dataset.daypart as Daypart) ?? 'day',
    lowPower: opts.lowPower,
  };

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  const root = createRoot(canvas);
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height), top: r.top, left: r.left };
  };
  await root.configure({
    size: measure(),
    dpr: [1, opts.dpr],
    frameloop: 'demand',
    events: undefined,
    gl: {
      alpha: true,
      antialias: !opts.lowPower,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      toneMapping: ACESFilmicToneMapping,
      outputColorSpace: SRGBColorSpace,
    },
    onCreated: (state) => {
      state.gl.setClearColor(0x000000, 0);
      (state.gl as WebGLRenderer).transmissionResolutionScale = opts.lowPower ? 0.5 : 1;
    },
  });

  const render = () => root.render(<Scene store={store} onReady={resolveReady} />);
  render();

  const ro = new ResizeObserver(() => {
    void root.configure({ size: measure() });
    store.invalidate();
  });
  ro.observe(canvas);
  const onDaypart = (e: Event) => {
    store.daypart = (e as CustomEvent<Daypart>).detail;
    render();
  };
  document.addEventListener('kuki:daypart', onDaypart);

  const renderer: ShelfRenderer & { ready: Promise<void> } = {
    kind: '3d',
    ready,
    apply(i: number, pose: JarPose) {
      const a = store.anims[i];
      if (!a) return;
      a.twist = pose.twist;
      a.pop = pose.pop;
      a.tilt = pose.tilt;
      a.reveal = pose.reveal;
      a.spin = pose.spin;
      a.aroma = pose.aroma;
      store.invalidate();
    },
    setSize(i: number, size: 0 | 1) {
      const a = store.anims[i];
      if (a) a.sizeTarget = size;
      store.invalidate();
    },
    hover(i: number, on: boolean) {
      const a = store.anims[i];
      if (a) a.hoverTarget = on ? 1 : 0;
      store.invalidate();
    },
    layout() {
      store.invalidate();
    },
    destroy() {
      ro.disconnect();
      document.removeEventListener('kuki:daypart', onDaypart);
      root.unmount();
      canvas.remove();
    },
  };
  return renderer;
}
