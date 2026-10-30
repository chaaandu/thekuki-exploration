import type { JarPose } from './timeline.ts';

export type CookieForm = 'thumbprint' | 'malt_round' | 'leaf_crust' | 'chunk' | 'stick' | 'nut_crust';
export type Aroma = 'curry_leaf' | 'carom_seed' | 'rose_petal' | 'blueberry' | 'malt_dust' | 'hazelnut_ribbon';

export interface JarInfo {
  index: number;
  el: HTMLElement;
  art: HTMLElement;
  handle: string;
  form: CookieForm;
  aroma: Aroma | null;
  colour: string;
  accent: string;
}

/** What draws the jars. The 2D (DOM) and 3D (WebGL) shelves both implement it. */
export interface ShelfRenderer {
  readonly kind: '2d' | '3d';
  /** Draw jar `index` in this pose (called every frame while it moves). */
  apply(index: number, pose: JarPose): void;
  /** 0 = 100g jar, 1 = 250g jar (animated by the renderer). */
  setSize(index: number, size: 0 | 1): void;
  hover(index: number, on: boolean): void;
  /** DOM layout changed (resize, scroll of the phone row). */
  layout(): void;
  destroy(): void;
}
