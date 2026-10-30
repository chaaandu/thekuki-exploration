/**
 * The gift box drawn in 2D (oblique view) for phones without WebGL, Save-Data or reduced
 * motion. Same textures as the 3D box, mapped onto faces with affine transforms.
 */
import { BOX, lidTexture, shade, sleeveTexture, type BoxLook } from './art.ts';

type Pt = [number, number];

/** Map a texture onto the parallelogram origin → origin+u, origin+v. */
function face(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement | string, o: Pt, u: Pt, v: Pt) {
  ctx.save();
  ctx.transform(u[0], u[1], v[0], v[1], o[0], o[1]);
  if (typeof tex === 'string') {
    ctx.fillStyle = tex;
    ctx.fillRect(0, 0, 1, 1);
  } else {
    ctx.scale(1 / tex.width, 1 / tex.height);
    ctx.drawImage(tex, 0, 0);
  }
  ctx.restore();
}

export function drawFlatBox(ctx: CanvasRenderingContext2D, w: number, h: number, look: BoxLook, logo: HTMLCanvasElement | null) {
  const depthX = 0.62 * Math.cos((38 * Math.PI) / 180);
  const depthY = 0.62 * Math.sin((38 * Math.PI) / 180);
  const totalW = BOX.w + BOX.d * depthX;
  const totalH = BOX.h + BOX.lid * 0.15 + BOX.d * depthY;
  const s = Math.min((w * 0.86) / totalW, (h * 0.8) / totalH);
  const ox = (w - totalW * s) / 2;
  const oy = (h - totalH * s) / 2 + BOX.d * depthY * s;
  const dx: Pt = [BOX.d * depthX * s, -BOX.d * depthY * s];
  const W = BOX.w * s;
  const H = BOX.h * s;
  const lidH = BOX.lid * s;
  const lip = 3 * s;

  // Soft contact shadow.
  ctx.save();
  ctx.fillStyle = 'rgba(42,18,7,0.22)';
  ctx.filter = `blur(${10 * s}px)`;
  ctx.beginPath();
  ctx.ellipse(ox + W / 2 + dx[0] / 2, oy + H + 4 * s + dx[1] / 2, W * 0.62, 14 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Base front + right side (only the strip below the lid shows).
  face(ctx, shade(look.box, -0.08), [ox, oy], [W, 0], [0, H]);
  face(ctx, shade(look.box, -0.26), [ox + W, oy], dx, [0, H]);

  // Sleeve around the middle of the base.
  const sleeveTop = oy + lidH - lip + (H - lidH - BOX.sleeve * s) / 2 + 2 * s;
  const front = sleeveTexture(look, logo, BOX.w, 768);
  face(ctx, front, [ox - 1, sleeveTop], [W + 2, 0], [0, BOX.sleeve * s]);
  face(ctx, shade(look.sleeve, -0.22), [ox + W + 1, sleeveTop], dx, [0, BOX.sleeve * s]);
  // Darken the sleeve front a touch so it sits in the same light as the box.
  face(ctx, 'rgba(42,18,7,0.06)', [ox - 1, sleeveTop], [W + 2, 0], [0, BOX.sleeve * s]);

  // Lid: slightly bigger than the base, sitting on top.
  const lx = ox - lip;
  const ly = oy - lip;
  const LW = W + lip * 2;
  face(ctx, shade(look.box, 0.02), [lx, ly], [LW, 0], [0, lidH]);
  face(ctx, shade(look.box, -0.2), [lx + LW, ly], dx, [0, lidH]);
  face(ctx, lidTexture(look, logo, 768), [lx + dx[0], ly + dx[1]], [LW, 0], [-dx[0], -dx[1]]);

  // Edge lines, like a pencil-sharp fold.
  ctx.save();
  ctx.strokeStyle = 'rgba(42,18,7,0.28)';
  ctx.lineWidth = Math.max(1, s * 0.8);
  ctx.beginPath();
  ctx.moveTo(lx, ly + lidH);
  ctx.lineTo(lx + LW, ly + lidH);
  ctx.lineTo(lx + LW + dx[0], ly + lidH + dx[1]);
  ctx.moveTo(lx + LW, ly);
  ctx.lineTo(lx + LW, ly + lidH);
  ctx.stroke();
  ctx.restore();
}
