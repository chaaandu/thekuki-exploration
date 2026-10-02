// Index of the shop's "Files" (dev/fixtures/files): names -> path + pixel size.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import * as log from './log.ts';

export interface FileEntry {
  /** file name as referenced by Shopify (`kuki-logo.png`) */
  name: string;
  /** path relative to the files dir (`products/abc.jpg`) */
  relPath: string;
  path: string;
  width: number;
  height: number;
  format: string;
  mtimeMs: number;
  size: number;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export class FileIndex {
  readonly dir: string;
  #byName = new Map<string, FileEntry>();
  #byRelPath = new Map<string, FileEntry>();
  #cache = new Map<string, FileEntry>();
  #loading: Promise<void> | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** (Re)scan the directory. Image dimensions are read with sharp (header only). */
  load(): Promise<void> {
    this.#loading = this.#scan();
    return this.#loading;
  }

  ready(): Promise<void> {
    return this.#loading ?? this.load();
  }

  async #scan(): Promise<void> {
    const byName = new Map<string, FileEntry>();
    const byRelPath = new Map<string, FileEntry>();
    for (const full of walk(this.dir)) {
      const st = statSync(full);
      const relPath = relative(this.dir, full).split(sep).join('/');
      const cacheKey = `${relPath}:${st.mtimeMs}:${st.size}`;
      let entry = this.#cache.get(cacheKey);
      if (!entry) {
        let width = 0;
        let height = 0;
        let format = relPath.split('.').pop()?.toLowerCase() ?? '';
        try {
          const meta = await sharp(full).metadata();
          width = meta.width ?? 0;
          height = meta.height ?? 0;
          format = meta.format ?? format;
        } catch {
          // not an image (pdf, video...) – still a valid shop file
        }
        const name = relPath.split('/').pop() ?? relPath;
        entry = { name, relPath, path: full, width, height, format, mtimeMs: st.mtimeMs, size: st.size };
        this.#cache.set(cacheKey, entry);
      }
      byRelPath.set(entry.relPath, entry);
      const existing = byName.get(entry.name);
      // top-level files win over nested ones with the same name
      if (!existing || existing.relPath.includes('/')) {
        if (existing && existing.relPath.includes('/') && entry.relPath.includes('/')) {
          log.warnOnce(`dup-file:${entry.name}`, `dev/fixtures/files has two files named ${entry.name}`);
        }
        byName.set(entry.name, entry);
      }
    }
    this.#byName = byName;
    this.#byRelPath = byRelPath;
  }

  /** Look up by bare file name (`kuki-logo.png`) or relative path (`products/x.jpg`). */
  get(name: string): FileEntry | undefined {
    const clean = name.replace(/^\/+/, '');
    return this.#byRelPath.get(clean) ?? this.#byName.get(clean) ?? this.#byName.get(clean.split('/').pop() ?? clean);
  }

  all(): FileEntry[] {
    return [...this.#byRelPath.values()];
  }
}
