/**
 * Should this device get the 3D shelf? Everyone else keeps the 2D shelf, which can sell
 * every flavour just as well.
 */
import { reducedMotion } from '../../core/prefs.ts';

export interface TierCheck {
  ok: boolean;
  reason: string;
  /** max device pixel ratio for the 3D canvas */
  dpr: number;
  lowPower: boolean;
}

export function check3D(enabledForSection: boolean): TierCheck {
  const no = (reason: string): TierCheck => ({ ok: false, reason, dpr: 1, lowPower: true });
  const forced = new URLSearchParams(location.search).get('tier');
  if (forced === '2d') return no('forced 2d');
  if (!window.KUKI?.settings?.enable3d || !enabledForSection) return no('turned off in theme settings');
  if (reducedMotion()) return no('reduced motion');
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  if (nav.connection?.saveData) return no('save-data');
  if (nav.connection?.effectiveType && ['slow-2g', '2g'].includes(nav.connection.effectiveType)) return no('slow network');
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4 && forced !== '3d') return no('low memory');
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4 && forced !== '3d') return no('few cores');

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true, powerPreference: 'high-performance' });
  if (!gl) return no('no webgl2');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (/swiftshader|llvmpipe|software|basic render/i.test(name) && forced !== '3d') return no(`software renderer (${name})`);

  const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  const weakGpu = /mali-4|mali-t[0-6]|adreno \(tm\) [1-5]\d\d|powervr sgx|intel\(r\) hd graphics [2-4]/i.test(name);
  return {
    ok: true,
    reason: name || 'ok',
    dpr: Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2),
    lowPower: phone || weakGpu,
  };
}
