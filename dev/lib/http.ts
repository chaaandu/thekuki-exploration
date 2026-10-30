// Small HTTP helpers: bodies (JSON, urlencoded, multipart) with Rails-style bracket keys,
// cookies, and responses.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

export type Body = Record<string, unknown>;

export async function readRaw(req: IncomingMessage, limit = 2_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** `items[0][id]`, `properties[Gift box]`, `updates[]`, `updates[key]` → nested objects/arrays. */
export function nest(pairs: [string, string][]): Body {
  const root: Body = {};
  for (const [rawKey, value] of pairs) {
    const m = /^([^[\]]+)((?:\[[^\]]*\])*)$/.exec(rawKey);
    if (!m) {
      root[rawKey] = value;
      continue;
    }
    const keys = [m[1]!, ...[...m[2]!.matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]!)];
    let node: any = root;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const last = i === keys.length - 1;
      const nextIsIndex = !last && /^\d*$/.test(keys[i + 1]!);
      if (k === '') {
        if (!Array.isArray(node)) break;
        if (last) node.push(value);
        else {
          const child = nextIsIndex ? [] : {};
          node.push(child);
          node = child;
        }
        continue;
      }
      if (last) {
        if (Array.isArray(node) && /^\d+$/.test(k)) node[Number(k)] = value;
        else node[k] = value;
      } else {
        if (node[k] === undefined) node[k] = nextIsIndex ? [] : {};
        node = node[k];
      }
    }
  }
  return root;
}

function parseMultipart(buf: Buffer, boundary: string): [string, string][] {
  const out: [string, string][] = [];
  const text = buf.toString('utf8');
  for (const part of text.split(`--${boundary}`)) {
    const idx = part.indexOf('\r\n\r\n');
    if (idx === -1) continue;
    const head = part.slice(0, idx);
    const name = /name="([^"]*)"/.exec(head)?.[1];
    if (!name || /filename="/.test(head)) continue;
    out.push([name, part.slice(idx + 4).replace(/\r\n$/, '')]);
  }
  return out;
}

export async function readBody(req: IncomingMessage): Promise<Body> {
  const type = req.headers['content-type'] ?? '';
  const raw = await readRaw(req);
  if (!raw.length) return {};
  if (type.includes('application/json')) {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Body) : {};
  }
  if (type.includes('multipart/form-data')) {
    const boundary = /boundary=([^;]+)/.exec(type)?.[1];
    return boundary ? nest(parseMultipart(raw, boundary.replace(/^"|"$/g, ''))) : {};
  }
  return nest([...new URLSearchParams(raw.toString('utf8'))]);
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/html; charset=utf-8', headers: Record<string, string> = {}) {
  // Compress HTML/JSON like Shopify does (only when the client asks and it's worth it).
  const accepts = /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] ?? ''));
  if (accepts && /html|json|javascript/.test(type) && Buffer.byteLength(body) > 1024 && !headers['Content-Encoding']) {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ...headers });
    res.end(gzipSync(body, { level: 6 }));
    return;
  }
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', headers);
}

export function redirect(res: ServerResponse, location: string, status = 302, headers: Record<string, string> = {}) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export const MIME: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  woff2: 'font/woff2',
  woff: 'font/woff',
  glb: 'model/gltf-binary',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain; charset=utf-8',
  ico: 'image/x-icon',
};
