/**
 * Light for the bakery counter, per time of day (India time). Window light rakes in from
 * the left; reflections come from procedural light panels (no HDR download).
 */
import { Environment, Lightformer } from '@react-three/drei';
import type { Daypart } from '../../shared/time.ts';

interface Rig {
  room: string;
  envIntensity: number;
  key: string;
  keyIntensity: number;
  keyPos: [number, number, number];
  fill: string;
  fillIntensity: number;
  window: string;
  windowIntensity: number;
  ambient: number;
  bulb?: number;
}

export const RIGS: Record<Daypart, Rig> = {
  morning: { room: '#2c3036', envIntensity: 1, key: '#f2f6ff', keyIntensity: 2.4, keyPos: [-420, 560, 380], fill: '#e8f0ff', fillIntensity: 0.9, window: '#f4f8ff', windowIntensity: 3.2, ambient: 0.55 },
  day: { room: '#2e2620', envIntensity: 1, key: '#fff2de', keyIntensity: 2.6, keyPos: [-520, 460, 380], fill: '#ffe9d2', fillIntensity: 0.8, window: '#fff4e2', windowIntensity: 3.4, ambient: 0.45 },
  chai: { room: '#33251a', envIntensity: 1, key: '#ffc27a', keyIntensity: 3.1, keyPos: [-700, 260, 320], fill: '#ffd7a8', fillIntensity: 0.6, window: '#ffcf8f', windowIntensity: 3.8, ambient: 0.35 },
  evening: { room: '#251c16', envIntensity: 0.8, key: '#ffd2a0', keyIntensity: 1.8, keyPos: [-620, 300, 300], fill: '#e7c9ad', fillIntensity: 0.5, window: '#ffdcb5', windowIntensity: 2.2, ambient: 0.3 },
  night: { room: '#1a120c', envIntensity: 0.55, key: '#ffcf8a', keyIntensity: 0.25, keyPos: [-500, 300, 300], fill: '#5a3d28', fillIntensity: 0.35, window: '#ffb866', windowIntensity: 0.9, ambient: 0.22, bulb: 3.2 },
};

/** World units are CSS pixels, so the bulb uses a gentle 1/d falloff scaled to pixel distances. */
export function Lights({ daypart, width = 1200, bulbX = 0.28, height = 800 }: { daypart: Daypart; width?: number; bulbX?: number; height?: number }) {
  const rig = RIGS[daypart];
  return (
    <>
      <ambientLight intensity={rig.ambient} color={rig.fill} />
      <directionalLight position={rig.keyPos} intensity={rig.keyIntensity} color={rig.key} />
      <directionalLight position={[480, 220, 420]} intensity={rig.fillIntensity} color={rig.fill} />
      {rig.bulb !== undefined && (
        <>
          <pointLight position={[bulbX * width, height * 0.32, 220]} intensity={rig.bulb * 420} distance={0} decay={1} color="#ffc979" />
          <pointLight position={[bulbX * width, height * 0.1, 520]} intensity={rig.bulb * 90} distance={0} decay={1} color="#ffb867" />
        </>
      )}
      <Environment resolution={256} frames={1} environmentIntensity={rig.envIntensity}>
        <color attach="background" args={[rig.room]} />
        {/* the window: tall, bright, to the left; it's what the glass reflects */}
        <Lightformer form="rect" intensity={rig.windowIntensity} color={rig.window} position={[-700, 260, 260]} rotation-y={Math.PI / 2.3} scale={[260, 620, 1]} />
        <Lightformer form="rect" intensity={rig.windowIntensity * 0.6} color={rig.window} position={[-640, 260, -120]} rotation-y={Math.PI / 2} scale={[180, 560, 1]} />
        {/* a soft bounce from the counter and the far wall */}
        <Lightformer form="rect" intensity={0.5} color="#e6c59c" position={[0, -400, 200]} rotation-x={-Math.PI / 2} scale={[1400, 500, 1]} />
        <Lightformer form="rect" intensity={rig.fillIntensity * 0.6} color={rig.fill} position={[800, 200, 300]} rotation-y={-Math.PI / 2.4} scale={[300, 500, 1]} />
      </Environment>
    </>
  );
}
