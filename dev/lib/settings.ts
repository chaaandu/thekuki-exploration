// Theme/section/block settings as Liquid sees them, resolved by setting type.
import { BaseDrop } from './drop-base.ts';
import { ColorDrop } from './colors.ts';
import { VideoUrlDrop, type StoreView } from './drops.ts';
import type { SectionInstance, SectionSchema, SettingSchema } from './theme.ts';

function blankToNull(v: unknown): unknown {
  return v === '' || v === undefined ? null : v;
}

export function resolveSetting(schema: SettingSchema | undefined, raw: unknown, view: StoreView): unknown {
  const type = schema?.type ?? 'text';
  const value = raw === undefined ? (schema?.default ?? null) : raw;
  switch (type) {
    case 'checkbox':
      return value === true || value === 'true';
    case 'number':
    case 'range':
      return value === null || value === '' ? null : Number(value);
    case 'product':
      return typeof value === 'string' && value ? view.product(value) : null;
    case 'product_list':
      return Array.isArray(value) ? value.map((h) => view.product(String(h))).filter(Boolean) : [];
    case 'collection':
      return typeof value === 'string' && value ? view.collection(value) : null;
    case 'collection_list':
      return Array.isArray(value) ? value.map((h) => view.collection(String(h))).filter(Boolean) : [];
    case 'page':
      return typeof value === 'string' && value ? view.page(value) : null;
    case 'blog':
      return typeof value === 'string' && value ? view.blog(value) : null;
    case 'article': {
      if (typeof value !== 'string' || !value.includes('/')) return null;
      const [blog, handle] = value.split('/');
      return view.article(blog!, handle!);
    }
    case 'link_list':
      return typeof value === 'string' && value ? view.linklist(value) : null;
    case 'image_picker':
      return typeof value === 'string' && value ? view.fileImage(value) : null;
    case 'color':
    case 'color_background':
      return value ? ColorDrop.from(value) : null;
    case 'video_url': {
      if (typeof value !== 'string' || !value) return null;
      const yt = /(?:youtu\.be\/|v=)([\w-]{6,})/.exec(value);
      const vimeo = /vimeo\.com\/(\d+)/.exec(value);
      if (yt) return new VideoUrlDrop(value, 'youtube', yt[1]!);
      if (vimeo) return new VideoUrlDrop(value, 'vimeo', vimeo[1]!);
      return null;
    }
    default:
      return blankToNull(value);
  }
}

export function resolveSettings(schemas: SettingSchema[] | undefined, values: Record<string, unknown> | undefined, view: StoreView): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of schemas ?? []) {
    if (!s.id) continue;
    out[s.id] = resolveSetting(s, values?.[s.id], view);
  }
  // Values present without a schema entry still pass through (Shopify keeps them).
  for (const [k, v] of Object.entries(values ?? {})) if (!(k in out)) out[k] = v;
  return out;
}

export class BlockDrop extends BaseDrop {
  readonly id: string;
  readonly type: string;
  readonly settings: Record<string, unknown>;
  readonly shopify_attributes: string;
  readonly index: number;

  constructor(id: string, type: string, settings: Record<string, unknown>, index: number, designMode: boolean) {
    super();
    this.id = id;
    this.type = type;
    this.settings = settings;
    this.index = index;
    this.shopify_attributes = designMode ? `data-shopify-editor-block="${JSON.stringify({ id, type }).replace(/"/g, '&quot;')}"` : '';
  }

  override toString(): string {
    return 'BlockDrop';
  }
}

export class SectionDrop extends BaseDrop {
  readonly id: string;
  readonly type: string;
  readonly settings: Record<string, unknown>;
  readonly blocks: BlockDrop[];
  readonly index: number | null;
  readonly index0: number | null;
  readonly location: string;

  constructor(init: { id: string; type: string; settings: Record<string, unknown>; blocks: BlockDrop[]; index: number | null; location: string }) {
    super();
    this.id = init.id;
    this.type = init.type;
    this.settings = init.settings;
    this.blocks = init.blocks;
    this.index = init.index;
    this.index0 = init.index === null ? null : init.index - 1;
    this.location = init.location;
  }

  override toString(): string {
    return 'SectionDrop';
  }
}

export function buildSection(
  id: string,
  type: string,
  instance: SectionInstance | null,
  schema: SectionSchema,
  view: StoreView,
  opts: { index: number | null; location: string; designMode: boolean },
): SectionDrop {
  const settings = resolveSettings(schema.settings, instance?.settings, view);
  const blocks: BlockDrop[] = [];
  const order = instance?.block_order ?? Object.keys(instance?.blocks ?? {});
  let i = 0;
  for (const blockId of order) {
    const block = instance?.blocks?.[blockId];
    if (!block || block.disabled) continue;
    const blockSchema = schema.blocks?.find((b) => b.type === block.type);
    if (!blockSchema && !block.type.startsWith('@')) {
      throw new Error(`Block type "${block.type}" is not in the {% schema %} of section "${type}"`);
    }
    i += 1;
    blocks.push(new BlockDrop(blockId, block.type, resolveSettings(blockSchema?.settings, block.settings, view), i, opts.designMode));
  }
  return new SectionDrop({ id, type, settings, blocks, index: opts.index, location: opts.location });
}
