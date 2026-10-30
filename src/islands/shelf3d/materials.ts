/**
 * Materials for the 3D shelf. Textures are generated in a canvas at startup (noise for
 * dough grain, lid wear), so the 3D needs no image downloads.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { rng, type CookieForm } from './geometry.ts';

const noise = new SimplexNoise({ random: rng(98) });

function noiseCanvas(size: number, scale: number, octaves: number, contrast = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable: sample a torus.
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      let a = 0.5;
      let f = scale;
      let n = 0;
      for (let o = 0; o < octaves; o++) {
        n += a * noise.noise4d(Math.cos(u) * f, Math.sin(u) * f, Math.cos(v) * f, Math.sin(v) * f);
        f *= 2;
        a *= 0.5;
      }
      const g = Math.max(0, Math.min(255, 128 + n * 128 * contrast));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let cached: { grain: Texture; speck: Texture; wear: Texture } | null = null;

export function textures() {
  if (cached) return cached;
  const mk = (canvas: HTMLCanvasElement, repeat: number) => {
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  };
  cached = {
    grain: mk(noiseCanvas(256, 1.4, 4, 1.6), 3),
    speck: mk(noiseCanvas(256, 4, 2, 2.2), 2),
    wear: mk(noiseCanvas(128, 0.8, 3, 1), 1),
  };
  return cached;
}

/* ---------------------------------------------------------------- glass */

export function glassMaterial(lowPower: boolean): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color('#ffffff'),
    metalness: 0,
    roughness: 0.0,
    transmission: 1,
    thickness: 9,
    ior: 1.52,
    attenuationColor: new Color('#d6e6d2'),
    attenuationDistance: 140,
    specularIntensity: 1,
    specularColor: new Color('#ffffff'),
    envMapIntensity: 1,
    clearcoat: 0,
    dispersion: lowPower ? 0 : 0.6,
  });
}

/* ---------------------------------------------------------------- lids */

export function lidMaterial(colour: string): MeshPhysicalMaterial {
  const t = textures();
  return new MeshPhysicalMaterial({
    color: new Color(colour).convertSRGBToLinear().multiplyScalar(0.92).convertLinearToSRGB(),
    roughness: 0.5,
    roughnessMap: t.wear,
    metalness: 0.02,
    clearcoat: 0.45,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.7,
  });
}

/* ---------------------------------------------------------------- dough */

const DOUGH: Record<CookieForm, string> = {
  thumbprint: '#c49a66',
  malt_round: '#8d5a36',
  leaf_crust: '#c39a5a',
  chunk: '#c4955f',
  stick: '#cfa86d',
  nut_crust: '#e2aab6',
};

export function doughMaterial(form: CookieForm): MeshStandardMaterial {
  const t = textures();
  return new MeshStandardMaterial({
    color: new Color(DOUGH[form]),
    roughness: form === 'nut_crust' ? 0.9 : 0.86,
    metalness: 0,
    bumpMap: form === 'malt_round' ? t.speck : t.grain,
    bumpScale: form === 'malt_round' ? 1.6 : 0.9,
    envMapIntensity: form === 'malt_round' ? 1.3 : 0.8,
  });
}

export function extraMaterial(kind: 'jam' | 'berry' | 'chunk' | 'leaf' | 'crumb' | 'seed' | 'fleck'): MeshStandardMaterial | MeshPhysicalMaterial {
  switch (kind) {
    case 'jam':
      return new MeshPhysicalMaterial({ color: '#3b1b57', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 });
    case 'berry':
      return new MeshPhysicalMaterial({ color: '#25204a', roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.6, sheenColor: new Color('#8a88b8') });
    case 'chunk':
      return new MeshPhysicalMaterial({ color: '#3a1c0e', roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 1.2 });
    case 'leaf':
      return new MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, side: DoubleSide, vertexColors: false });
    case 'crumb':
      return new MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
    case 'seed':
      return new MeshStandardMaterial({ color: '#6c5c30', roughness: 0.66 });
    case 'fleck':
      return new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
  }
}

export function shadowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(42,18,7,0.55)');
  g.addColorStop(0.45, 'rgba(42,18,7,0.28)');
  g.addColorStop(1, 'rgba(42,18,7,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
