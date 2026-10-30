/**
 * The gift box in 3D (plain three.js, shares the three chunk with the shelf). Lid and sleeve
 * carry the visitor's logo. Drag or arrow keys turn it; renders only when something changes.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { BOX, lidTexture, plainTexture, sleeveTexture, type BoxLook } from './art.ts';

export interface Box3D {
  setLogo(logo: HTMLCanvasElement | null): void;
  turnBy(radians: number): void;
  /** Render a still at the given size and return the canvas holding it. */
  still(width: number, height: number): HTMLCanvasElement;
  dispose(): void;
}

function tex(c: HTMLCanvasElement, renderer: WebGLRenderer): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

const card = (map: Texture) => new MeshStandardMaterial({ map, roughness: 0.86, metalness: 0 });

function shadowTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(42,18,7,0.42)');
  g.addColorStop(1, 'rgba(42,18,7,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}

export function createBox3D(host: HTMLElement, look: BoxLook, opts: { reducedMotion: boolean; label: string }): Box3D {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.className = 'gift__canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', opts.label);
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 10, 4000);
  scene.add(new HemisphereLight(0xfff4e2, 0x6b4a2e, 1.1));
  scene.add(new AmbientLight(0xffffff, 0.25));
  const sun = new DirectionalLight(0xffe2b8, 2.2); // afternoon light through the bakery window
  sun.position.set(-260, 420, 300);
  scene.add(sun);
  const fill = new DirectionalLight(0xfff0dc, 0.7);
  fill.position.set(300, 120, -200);
  scene.add(fill);

  const box = new Group();
  scene.add(box);

  const boxSide = card(tex(plainTexture(look.box), renderer));
  const base = new Mesh(new BoxGeometry(BOX.w, BOX.h, BOX.d), boxSide);
  base.position.y = BOX.h / 2;
  box.add(base);

  // Lid: a shallow box a little bigger than the base. Face order: +x −x +y −y +z −z.
  const lidGeo = new BoxGeometry(BOX.w + 6, BOX.lid, BOX.d + 6);
  const lidMats: Material[] = [boxSide, boxSide, boxSide, boxSide, boxSide, boxSide];
  const lid = new Mesh(lidGeo, lidMats);
  lid.position.y = BOX.h + 3 - BOX.lid / 2;
  box.add(lid);

  // Sleeve: wraps the four sides of the base; top and bottom open.
  const sleeveGeo = new BoxGeometry(BOX.w + 2, BOX.sleeve, BOX.d + 2);
  const sleeveSide = card(tex(plainTexture(look.sleeve), renderer));
  const hidden = new MeshBasicMaterial({ visible: false });
  const sleeveMats: Material[] = [sleeveSide, sleeveSide, hidden, hidden, sleeveSide, sleeveSide];
  const sleeve = new Mesh(sleeveGeo, sleeveMats);
  sleeve.position.y = (BOX.h - BOX.lid + 3) / 2;
  box.add(sleeve);

  const shadow = new Mesh(
    new PlaneGeometry(BOX.w * 1.7, BOX.d * 1.9),
    new MeshBasicMaterial({ map: new CanvasTexture(shadowTexture()), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.5;
  scene.add(shadow);

  let logo: HTMLCanvasElement | null = null;
  const owned: Texture[] = [];
  const paint = () => {
    owned.splice(0).forEach((t) => t.dispose());
    const top = tex(lidTexture(look, logo), renderer);
    const front = tex(sleeveTexture(look, logo, BOX.w), renderer);
    owned.push(top, front);
    if (lidMats[2] !== boxSide) lidMats[2]!.dispose();
    if (sleeveMats[4] !== sleeveSide) sleeveMats[4]!.dispose();
    lidMats[2] = card(top);
    sleeveMats[4] = sleeveMats[5] = card(front);
    lid.material = lidMats;
    sleeve.material = sleeveMats;
  };
  paint();

  let yaw = opts.reducedMotion ? -0.55 : -1.05;
  let target = -0.55;
  let raf = 0;
  const pitch = 0.5;

  const size = () => {
    const r = host.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };

  const frame = (w: number, h: number) => {
    camera.aspect = w / h;
    // Fit the turning box (its footprint diagonal, plus lid height) with a little air.
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const reach = Math.hypot(BOX.w + 6, BOX.d + 6) / 0.82;
    const tall = (BOX.h + BOX.d * 0.6) / 0.72;
    const dist = Math.max(reach / (2 * tanV * camera.aspect), tall / (2 * tanV));
    camera.position.set(0, Math.sin(pitch) * dist + 40, Math.cos(pitch) * dist);
    camera.lookAt(0, BOX.h * 0.42, 0);
    camera.updateProjectionMatrix();
    box.rotation.y = yaw;
  };

  const render = () => {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    frame(w, h);
    renderer.render(scene, camera);
  };

  const tick = () => {
    raf = 0;
    const diff = target - yaw;
    yaw += diff * 0.14;
    if (Math.abs(diff) < 0.001) yaw = target;
    render();
    if (yaw !== target) raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  // Drag to turn (horizontal only, so vertical swipes still scroll the page).
  let dragX: number | null = null;
  const down = (e: PointerEvent) => {
    dragX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (dragX === null) return;
    target += (e.clientX - dragX) * 0.012;
    dragX = e.clientX;
    if (opts.reducedMotion) yaw = target;
    kick();
  };
  const up = () => {
    dragX = null;
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      api.turnBy(e.key === 'ArrowLeft' ? -0.3 : 0.3);
    }
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('keydown', key);
  const ro = new ResizeObserver(() => kick());
  ro.observe(host);

  // Wait for the display and hand fonts so the lid note and sleeve line draw in them.
  document.fonts?.ready.then(() => {
    paint();
    kick();
  });
  kick();

  const api: Box3D = {
    setLogo(next) {
      logo = next;
      paint();
      target = -0.55;
      kick();
    },
    turnBy(r) {
      target += r;
      if (opts.reducedMotion) yaw = target;
      kick();
    },
    still(width, height) {
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      yaw = target;
      frame(width, height);
      renderer.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      out.getContext('2d')!.drawImage(canvas, 0, 0);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      render();
      return out;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      owned.forEach((t) => t.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
  return api;
}
