// Per-render state shared by filters and tags (stored in Liquid globals under a symbol,
// so templates cannot see it but every render/include context can reach it).
import type { Context } from 'liquidjs';
import type { StoreView } from './drops.ts';
import type { Theme } from './theme.ts';

export const STATE: unique symbol = Symbol.for('kuki.renderState');

export interface LiquidErrorRecord {
  kind: 'error' | 'syntax';
  file: string | null;
  line: number | null;
  message: string;
  text: string;
}

export interface FlashForm {
  formType: string;
  errors: Record<string, string>;
  values: Record<string, string>;
}

export interface SectionContext {
  id: string;
  type: string;
}

export interface RequestInfo {
  method: string;
  path: string;
  query: URLSearchParams;
  host: string;
  origin: string;
  designMode: boolean;
  now: Date;
  nowOverride: string | null;
}

export interface RenderState {
  theme: Theme;
  view: StoreView;
  request: RequestInfo;
  pageType: string;
  /** Errors rendered inline during this request */
  errors: LiquidErrorRecord[];
  /** `{% layout %}` in a .liquid template */
  layoutOverride: string | false | undefined;
  flash: FlashForm | null;
  section: SectionContext | null;
  /** template-level objects (product, collection...) for section rendering */
  pageObjects: Record<string, unknown>;
  /** rendering of nested sections, guards against `{% section %}` recursion */
  sectionDepth: number;
  /** set by {% paginate %} so `current_page`/page titles can use it */
  currentPage?: number;
  /** callbacks implemented by the renderer */
  renderStaticSection: (name: string, state: RenderState) => string;
  renderSectionGroup: (name: string, state: RenderState) => string;
}

export function getState(ctx: Context): RenderState {
  const state = (ctx.globals as Record<symbol, unknown>)[STATE] as RenderState | undefined;
  if (!state) throw new Error('internal: render state missing from Liquid globals');
  return state;
}

export function tryGetState(ctx: Context | undefined): RenderState | null {
  if (!ctx) return null;
  return ((ctx.globals as Record<symbol, unknown>)[STATE] as RenderState | undefined) ?? null;
}
