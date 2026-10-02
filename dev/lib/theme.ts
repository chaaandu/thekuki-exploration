// The theme on disk: templates, sections, snippets, layouts, config, locales, assets.
// Files are cached by mtime, so edits show up on the next request without a restart.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, parseJsonc } from './util.ts';
import * as log from './log.ts';

export interface SettingSchema {
  type: string;
  id?: string;
  default?: unknown;
  [key: string]: unknown;
}

export interface BlockSchema {
  type: string;
  name?: string;
  limit?: number;
  settings?: SettingSchema[];
}

export interface SectionSchema {
  name?: string;
  tag?: string;
  class?: string;
  settings?: SettingSchema[];
  blocks?: BlockSchema[];
  max_blocks?: number;
  presets?: unknown[];
  enabled_on?: unknown;
  disabled_on?: unknown;
}

export interface SectionInstance {
  type: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, { type: string; settings?: Record<string, unknown>; disabled?: boolean }>;
  block_order?: string[];
  disabled?: boolean;
}

export interface JsonTemplate {
  layout?: string | false;
  wrapper?: string;
  sections: Record<string, SectionInstance>;
  order: string[];
}

export interface SectionGroup {
  type: string;
  name: string;
  sections: Record<string, SectionInstance>;
  order: string[];
}

interface CacheEntry<T> {
  mtimeMs: number;
  value: T;
}

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

export class Theme {
  readonly dir: string;
  #text = new Map<string, CacheEntry<string>>();
  #json = new Map<string, CacheEntry<unknown>>();
  #schemas = new Map<string, CacheEntry<SectionSchema>>();
  /** bumped on every file change (live reload + engine cache) */
  version = 0;

  constructor(dir: string) {
    this.dir = dir;
  }

  path(rel: string): string {
    return join(this.dir, rel);
  }

  exists(rel: string): boolean {
    return existsSync(this.path(rel));
  }

  mtime(rel: string): number {
    try {
      return statSync(this.path(rel)).mtimeMs;
    } catch {
      return 0;
    }
  }

  read(rel: string): string {
    const full = this.path(rel);
    const m = this.mtime(rel);
    const hit = this.#text.get(full);
    if (hit && hit.mtimeMs === m) return hit.value;
    const value = readFileSync(full, 'utf8');
    this.#text.set(full, { mtimeMs: m, value });
    return value;
  }

  json<T = unknown>(rel: string): T {
    const full = this.path(rel);
    const m = this.mtime(rel);
    const hit = this.#json.get(full);
    if (hit && hit.mtimeMs === m) return hit.value as T;
    const value = parseJsonc(readFileSync(full, 'utf8'), rel);
    this.#json.set(full, { mtimeMs: m, value });
    return value as T;
  }

  list(dir: string): string[] {
    try {
      return readdirSync(this.path(dir));
    } catch {
      return [];
    }
  }

  invalidate(): void {
    this.#text.clear();
    this.#json.clear();
    this.#schemas.clear();
    this.version += 1;
  }

  /* ---------------- sections ---------------- */

  sectionSource(type: string): string {
    const rel = `sections/${type}.liquid`;
    if (!this.exists(rel)) throw new Error(`Section "${type}" not found (sections/${type}.liquid)`);
    return this.read(rel);
  }

  /** The section's Liquid with the {% schema %} block blanked out (line numbers preserved). */
  sectionBody(type: string): string {
    return this.sectionSource(type).replace(SCHEMA_RE, (m) => m.replace(/[^\n]/g, ' '));
  }

  schema(type: string): SectionSchema {
    const rel = `sections/${type}.liquid`;
    const m = this.mtime(rel);
    const hit = this.#schemas.get(rel);
    if (hit && hit.mtimeMs === m) return hit.value;
    const match = SCHEMA_RE.exec(this.sectionSource(type));
    let value: SectionSchema = {};
    if (match) {
      try {
        value = JSON.parse(match[1]!) as SectionSchema;
      } catch (err) {
        throw new Error(`Invalid {% schema %} JSON in sections/${type}.liquid: ${(err as Error).message}`);
      }
    }
    this.#schemas.set(rel, { mtimeMs: m, value });
    return value;
  }

  sectionGroup(name: string): SectionGroup | null {
    const rel = `sections/${name}.json`;
    return this.exists(rel) ? this.json<SectionGroup>(rel) : null;
  }

  /* ---------------- templates ---------------- */

  /** Finds templates/<name>[.<suffix>].json|liquid, falling back to the base name. */
  findTemplate(name: string, suffix: string | null): { rel: string; suffix: string | null; kind: 'json' | 'liquid' } | null {
    const candidates: [string, string | null][] = [];
    if (suffix) candidates.push([`${name}.${suffix}`, suffix]);
    candidates.push([name, null]);
    for (const [base, sfx] of candidates) {
      for (const ext of ['json', 'liquid'] as const) {
        const rel = `templates/${base}.${ext}`;
        if (this.exists(rel)) return { rel, suffix: sfx, kind: ext };
      }
    }
    return null;
  }

  /* ---------------- settings ---------------- */

  settingsSchema(): Array<{ name?: string; settings?: SettingSchema[] }> {
    return this.exists('config/settings_schema.json') ? this.json('config/settings_schema.json') : [];
  }

  settingsData(): Record<string, unknown> {
    if (!this.exists('config/settings_data.json')) return {};
    const data = this.json<{ current?: unknown; presets?: Record<string, Record<string, unknown>> }>('config/settings_data.json');
    const current = data.current;
    if (typeof current === 'string') return data.presets?.[current] ?? {};
    return (current as Record<string, unknown>) ?? {};
  }

  /** Global theme settings: schema defaults overlaid with settings_data current values. */
  globalSettingsRaw(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const group of this.settingsSchema()) {
      for (const s of group.settings ?? []) if (s.id) out[s.id] = s.default ?? null;
    }
    const data = this.settingsData();
    for (const [k, v] of Object.entries(data)) if (k !== 'sections' && k !== 'content_for_index' && k !== 'blocks') out[k] = v;
    return out;
  }

  globalSettingSchemas(): SettingSchema[] {
    return this.settingsSchema().flatMap((g) => g.settings ?? []);
  }

  staticSectionData(name: string): SectionInstance | null {
    const sections = (this.settingsData().sections ?? {}) as Record<string, SectionInstance>;
    return sections[name] ?? null;
  }

  /* ---------------- locales ---------------- */

  locale(): Record<string, unknown> {
    const rel = 'locales/en.default.json';
    return this.exists(rel) ? this.json(rel) : {};
  }

  lookup(key: string): unknown {
    let node: unknown = this.locale();
    for (const part of key.split('.')) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[part];
      else return undefined;
    }
    return node;
  }

  /** Shopify's `t` filter: interpolation, `_html` keys unescaped, pluralization with `count`. */
  translate(key: string, args: Record<string, unknown>): string {
    let value = this.lookup(key);
    if (value && typeof value === 'object' && 'count' in args) {
      const count = Number(args.count);
      const forms = value as Record<string, unknown>;
      value = (count === 0 && forms.zero !== undefined ? forms.zero : count === 1 ? forms.one : forms.other) ?? forms.other;
    }
    if (typeof value !== 'string') {
      log.warnOnce(`t:${key}`, `translation missing: en.${key}`);
      return `translation missing: en.${key}`;
    }
    const html = key.endsWith('_html') || key.split('.').pop()?.endsWith('_html');
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
      const v = args[name];
      const s = v === null || v === undefined ? '' : String(v);
      return html ? s : escapeHtml(s);
    });
  }

  dateFormat(name: string): string | undefined {
    const v = this.lookup(`date_formats.${name}`);
    return typeof v === 'string' ? v : undefined;
  }

  /* ---------------- assets ---------------- */

  assetPath(name: string): string | null {
    const rel = `assets/${name}`;
    return this.exists(rel) ? this.path(rel) : null;
  }

  assetUrl(name: string): string {
    const m = Math.round(this.mtime(`assets/${name}`)) || 1;
    return `/cdn/shop/t/1/assets/${encodeURIComponent(name)}?v=${m}`;
  }
}
