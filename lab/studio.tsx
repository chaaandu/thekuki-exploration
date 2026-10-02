/**
 * Jar studio (development only, not shipped). Renders one jar or a row of six with
 * URL-controlled animation values so states can be screenshotted exactly.
 *
 *   /?form=leaf_crust&colour=%233d6b2c&twist=0&pop=0&tilt=0&reveal=0&size=0&daypart=day
 *   /?row=1&daypart=chai
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { createRoot } from 'react-dom/client';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import { Jar, newAnim } from '../src/islands/shelf3d/Jar.tsx';
import { Lights } from '../src/islands/shelf3d/Lights.tsx';
import type { CookieForm } from '../src/islands/shelf3d/geometry.ts';
import type { Daypart } from '../src/shared/time.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d = 0) => Number(q.get(k) ?? d);
const daypart = (q.get('daypart') ?? 'day') as Daypart;

const FLAVOURS: { form: CookieForm; colour: string }[] = [
  { form: 'nut_crust', colour: '#e48fa8' },
  { form: 'malt_round', colour: '#6b3e22' },
  { form: 'leaf_crust', colour: '#3d6b2c' },
  { form: 'thumbprint', colour: '#3e3a8c' },
  { form: 'stick', colour: '#9c8b5a' },
  { form: 'chunk', colour: '#8a5a33' },
];

function anim() {
  const a = newAnim();
  a.twist = num('twist');
  a.pop = num('pop');
  a.tilt = num('tilt');
  a.reveal = num('reveal');
  a.size = num('size');
  a.spin = num('spin');
  return a;
}

function App() {
  const row = q.get('row') === '1';
  const bg = q.get('bg') ?? '#f3e8d4';
  return (
    <Canvas
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      dpr={[1, 2]}
      camera={{ position: row ? [0, 420, 1560] : [0, 300, 760], fov: 30, near: 10, far: 8000 }}
      style={{ width: '100vw', height: '100vh', background: bg }}
    >
      <color attach="background" args={[bg]} />
      <Lights daypart={daypart} width={0} />
      {row ? (
        FLAVOURS.map((f, i) => (
          <group key={f.form} position={[(i - 2.5) * 175, 0, 0]}>
            <Jar form={f.form} colour={f.colour} anim={anim()} seed={i * 13 + 7} />
          </group>
        ))
      ) : (
        <Jar form={(q.get('form') ?? 'leaf_crust') as CookieForm} colour={q.get('colour') ?? '#3d6b2c'} anim={anim()} />
      )}
      <mesh position={[0, -12, 0]}>
        <boxGeometry args={[2400, 24, 260]} />
        <meshStandardMaterial color="#8a5a33" roughness={0.7} />
      </mesh>
      <OrbitControls target={[0, row ? 330 : 190, 0]} />
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
