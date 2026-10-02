/**
 * Fails if any customer-visible copy is hardcoded in Liquid. Every word must come from a
 * section/block setting (editable in the theme editor) or a locale file (editable in
 * "Edit default theme content"). Checks text nodes and the text-bearing attributes
 * alt, title, placeholder, aria-label, aria-description.
 *
 *   node scripts/lint-copy.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'theme';
const DIRS = ['layout', 'sections', 'snippets', 'templates', 'blocks'];
// Generated files and JSON data snippets (keys, not copy).
const SKIP = new Set(['snippets/critical-css.liquid', 'snippets/svg-sprite.liquid', 'snippets/flavour-json.liquid', 'snippets/flavour-json-item.liquid']);

function files(): string[] {
  const out: string[] = [];
  for (const dir of DIRS) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const f of entries) if (f.endsWith('.liquid')) out.push(`${dir}/${f}`);
  }
  return out.filter((f) => !SKIP.has(f));
}

const LIQUID = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const BLOCKS: RegExp[] = [
  /\{%-?\s*schema\s*-?%\}[\s\S]*?\{%-?\s*endschema\s*-?%\}/g,
  /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g,
  /\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*-?%\}/g,
  /\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g,
  /\{%-?\s*liquid[\s\S]*?-?%\}/g,
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
];

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

let problems = 0;
for (const file of files()) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  // Blank out ignored regions but keep offsets (so line numbers stay right).
  let text = source;
  for (const re of BLOCKS) text = text.replace(re, (m) => m.replace(/[^\n]/g, ' '));

  // Attributes that carry copy.
  const attr = /\s(alt|title|placeholder|aria-label|aria-description)="([^"]*)"/g;
  for (const m of text.matchAll(attr)) {
    const literal = m[2]!.replace(LIQUID, '');
    if (/[A-Za-z]{2,}/.test(literal)) {
      problems += 1;
      console.log(`${file}:${lineOf(source, m.index ?? 0)}  hardcoded ${m[1]}="${m[2]}"`);
    }
  }

  // Text between tags.
  const withoutTags = text.replace(LIQUID, (m) => m.replace(/[^\n]/g, ' ')).replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, ' '));
  const word = /[A-Za-z][A-Za-z'’]+(?:\s+[A-Za-z'’]+)*/g;
  for (const m of withoutTags.matchAll(word)) {
    problems += 1;
    console.log(`${file}:${lineOf(source, m.index ?? 0)}  hardcoded text "${m[0].trim()}"`);
  }
}

if (problems) {
  console.error(`\n✗ ${problems} piece(s) of hardcoded copy. Move them to section settings or locales/en.default.json.`);
  process.exit(1);
}
console.log('✓ No hardcoded copy in Liquid.');
