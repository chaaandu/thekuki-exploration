/**
 * Local Shopify Online Store emulator for the Kuki theme.
 *
 *   node dev/server.ts [--port 9292] [--host 127.0.0.1] [--theme theme]
 *
 * Renders theme/ with the live store's data (store/snapshot → store/setup → dev/fixtures),
 * serves the AJAX Cart API + Section Rendering API, contact form, a mock checkout and an
 * image CDN. See docs/local-dev.md.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import sharp from 'sharp';
import { Theme } from './lib/theme.ts';
import { Renderer, type Route } from './lib/render.ts';
import { loadStoreModel, type StoreModel } from './lib/store-data.ts';
import { FileIndex } from './lib/files.ts';
import { addItems, CART_COOKIE, CartError, cartJson, changeLine, clearCart, computeLines, emptyCart, lineItemJson, newCartToken, replaceWithPermalink, updateCart, type CartState } from './lib/cart.ts';
import { productJson, StoreView } from './lib/drops.ts';
import type { FlashForm, RequestInfo } from './lib/state.ts';
import { cookies, json, MIME, readBody, redirect, send, type Body } from './lib/http.ts';
import * as log from './lib/log.ts';
import { escapeHtml } from './lib/util.ts';

/* ------------------------------------------------------------------ setup */

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const PORT = Number(arg('port', process.env.PORT ?? '9292'));
const HOST = arg('host', '127.0.0.1');
const ROOT = process.cwd();
const THEME_DIR = resolve(ROOT, arg('theme', 'theme'));
const DATA_DIR = resolve(ROOT, 'dev/.data');
mkdirSync(DATA_DIR, { recursive: true });

const theme = new Theme(THEME_DIR);
let model: StoreModel = loadStoreModel({ storeDir: resolve(ROOT, 'store'), fixturesDir: resolve(ROOT, 'dev/fixtures') });
const files = new FileIndex(resolve(ROOT, 'dev/fixtures/files'));
await files.load();
const renderer = new Renderer(theme, () => model, files);
renderer.liveReload = !process.env.KUKI_NO_LIVERELOAD;

/* ------------------------------------------------------------------ persistence */

interface Order {
  number: string;
  placedAt: string;
  lines: Record<string, unknown>[];
  note: string | null;
  attributes: Record<string, string>;
  total: number;
}

function load<T>(name: string, fallback: T): T {
  const p = join(DATA_DIR, `${name}.json`);
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(name: string, data: unknown) {
  writeFileSync(join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

const carts = new Map<string, CartState>(Object.entries(load<Record<string, CartState>>('carts', {})));
let orders = load<Order[]>('orders', []);
let contacts = load<Record<string, unknown>[]>('contacts', []);
const flashes = new Map<string, FlashForm>();
const persistCarts = () => save('carts', Object.fromEntries(carts));

/* ------------------------------------------------------------------ helpers */

function requestInfo(req: IncomingMessage, url: URL): RequestInfo {
  const nowOverride = url.searchParams.get('now');
  const parsed = nowOverride ? new Date(nowOverride) : null;
  return {
    method: req.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    host: url.host,
    origin: `${url.protocol}//${url.host}`,
    designMode: url.searchParams.get('design_mode') === '1',
    now: parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(),
    nowOverride: parsed && !Number.isNaN(parsed.getTime()) ? nowOverride : null,
  };
}

function getCart(req: IncomingMessage, res: ServerResponse): CartState {
  let token = cookies(req)[CART_COOKIE];
  let cart = token ? carts.get(token) : undefined;
  if (!cart) {
    token = newCartToken();
    cart = emptyCart(token);
    carts.set(token, cart);
    res.setHeader('Set-Cookie', `${CART_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=1209600`);
  }
  return cart;
}

function viewFor(url: URL): StoreView {
  return new StoreView({ model, files, now: new Date(), path: url.pathname, query: url.searchParams });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ routing */

function route(url: URL): Route | null {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const view = viewFor(url);
  const shopTitle = model.shop.name;
  const m = (re: RegExp) => re.exec(p);
  let r: RegExpExecArray | null;

  if (p === '/') return { template: 'index', suffix: null, pageType: 'index', status: 200, objects: () => ({}), title: shopTitle, description: model.shop.description || undefined };

  if ((r = m(/^\/products\/([^/.]+)$/)) || (r = m(/^\/collections\/[^/]+\/products\/([^/.]+)$/))) {
    const handle = r[1]!;
    const product = model.productsByHandle.get(handle);
    if (!product) return null;
    return {
      template: 'product',
      suffix: url.searchParams.get('view') ?? product.templateSuffix ?? null,
      pageType: 'product',
      status: 200,
      objects: (v) => ({ product: v.product(handle) }),
      title: product.title,
      description: stripHtml(product.bodyHtml).slice(0, 320),
      handle,
    };
  }

  if (p === '/collections') return { template: 'list-collections', suffix: null, pageType: 'list-collections', status: 200, objects: () => ({}), title: 'Collections' };

  if ((r = m(/^\/collections\/([^/]+)$/))) {
    const handle = r[1]!;
    const c = view.collection(handle);
    if (!c) return null;
    return {
      template: 'collection',
      suffix: url.searchParams.get('view') ?? c.template_suffix ?? null,
      pageType: 'collection',
      status: 200,
      objects: (v) => ({ collection: v.collection(handle) }),
      title: c.title,
      description: stripHtml(c.description || '') || undefined,
      handle,
      pageCollection: handle,
    };
  }

  if ((r = m(/^\/pages\/([^/]+)$/))) {
    const handle = r[1]!;
    const page = model.pagesByHandle.get(handle);
    if (!page) return null;
    return {
      template: 'page',
      suffix: url.searchParams.get('view') ?? page.templateSuffix ?? null,
      pageType: 'page',
      status: 200,
      objects: (v) => ({ page: v.page(handle) }),
      title: page.title,
      description: stripHtml(page.bodyHtml).slice(0, 320) || undefined,
      handle,
    };
  }

  if ((r = m(/^\/blogs\/([^/]+)$/))) {
    const handle = r[1]!;
    if (!model.blogs.get(handle)) return null;
    return { template: 'blog', suffix: null, pageType: 'blog', status: 200, objects: (v) => ({ blog: v.blog(handle) }), title: model.blogs.get(handle)!.title, handle };
  }

  if ((r = m(/^\/blogs\/([^/]+)\/([^/]+)$/))) {
    const [blogHandle, handle] = [r[1]!, r[2]!];
    const article = view.article(blogHandle, handle);
    if (!article) return null;
    return { template: 'article', suffix: null, pageType: 'article', status: 200, objects: (v) => ({ blog: v.blog(blogHandle), article: v.article(blogHandle, handle) }), title: article.title, handle };
  }

  if (p === '/search') {
    const terms = (url.searchParams.get('q') ?? '').trim();
    return {
      template: 'search',
      suffix: null,
      pageType: 'search',
      status: 200,
      objects: (v) => {
        if (!terms) return { search: { performed: false, terms: '', results: [], results_count: 0, types: ['product', 'page'] } };
        const needle = terms.toLowerCase();
        const products = v.allProducts().filter((pr) => `${pr.title} ${stripHtml(pr.description)} ${pr.type} ${pr.tags.join(' ')}`.toLowerCase().includes(needle));
        const pages = model.pages.filter((pg) => `${pg.title} ${stripHtml(pg.bodyHtml)}`.toLowerCase().includes(needle)).map((pg) => v.page(pg.handle)).filter(Boolean);
        const results = [...products, ...pages];
        return { search: { performed: true, terms, results, results_count: results.length, types: ['product', 'page'] } };
      },
      title: terms ? `Search: ${terms}` : 'Search',
    };
  }

  if (p === '/cart') return { template: 'cart', suffix: null, pageType: 'cart', status: 200, objects: () => ({}), title: 'Your bag' };

  if ((r = m(/^\/policies\/([^/]+)$/))) {
    const policy = model.policies.find((x) => x.handle === r![1]);
    if (!policy) return null;
    return {
      template: 'policy',
      suffix: null,
      pageType: 'policy',
      status: 200,
      objects: () => ({}),
      title: policy.title,
      content: `<div class="shopify-policy__container"><div class="shopify-policy__title"><h1>${escapeHtml(policy.title)}</h1></div><div class="shopify-policy__body"><div class="rte">${policy.body}</div></div></div>`,
    };
  }
  return null;
}

const notFound = (): Route => ({ template: '404', suffix: null, pageType: '404', status: 404, objects: () => ({}), title: '404 Not Found' });

/* ------------------------------------------------------------------ live reload */

const sseClients = new Set<ServerResponse>();
let reloadTimer: NodeJS.Timeout | null = null;
watch(THEME_DIR, { recursive: true }, () => {
  theme.invalidate();
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const c of sseClients) c.write('data: reload\n\n');
  }, 120);
});
watch(resolve(ROOT, 'dev/fixtures/files'), { recursive: true }, () => void files.load());

/* ------------------------------------------------------------------ image CDN */

const IMG_CACHE = join(DATA_DIR, 'img-cache');
mkdirSync(IMG_CACHE, { recursive: true });

async function serveImage(req: IncomingMessage, res: ServerResponse, url: URL) {
  const name = decodeURIComponent(url.pathname.replace(/^\/cdn\/shop\/files\//, ''));
  const entry = files.get(name);
  if (!entry) return send(res, 404, 'Not found', 'text/plain');
  const width = Number(url.searchParams.get('width')) || 0;
  const height = Number(url.searchParams.get('height')) || 0;
  const crop = url.searchParams.get('crop');
  const accept = req.headers.accept ?? '';
  let format = url.searchParams.get('format') ?? (accept.includes('image/avif') ? 'avif' : accept.includes('image/webp') ? 'webp' : '');
  if (entry.format === 'svg' || entry.format === 'gif') format = '';
  const key = `${entry.relPath.replace(/\//g, '_')}-${entry.mtimeMs}-${width}x${height}-${crop}-${format}`;
  const cached = join(IMG_CACHE, key);
  let ext = format || extname(entry.path).slice(1);
  if (ext === 'pjpg') ext = 'jpg';
  if (!existsSync(cached)) {
    let img = sharp(entry.path);
    if (width || height) {
      img = img.resize({
        width: width ? Math.min(width, entry.width || width) : undefined,
        height: height ? Math.min(height, entry.height || height) : undefined,
        fit: width && height ? 'cover' : 'inside',
        position: crop && ['top', 'bottom', 'left', 'right'].includes(crop) ? crop : 'centre',
        withoutEnlargement: true,
      });
    }
    if (format === 'avif') img = img.avif({ quality: 50, effort: 3 });
    else if (format === 'webp') img = img.webp({ quality: 78 });
    else if (format === 'jpg' || format === 'pjpg') img = img.jpeg({ quality: 82, progressive: format === 'pjpg' });
    await img.toFile(cached);
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000', Vary: 'Accept' });
  createReadStream(cached).pipe(res);
}

/* ------------------------------------------------------------------ mock checkout */

function checkoutPage(cart: CartState, message: string | null): string {
  const view = new StoreView({ model, files, now: new Date(), path: '/checkout', query: new URLSearchParams() });
  const lines = computeLines(cart, view).map(lineItemJson);
  const money = (n: number) => `₹${(n / 100).toLocaleString('en-IN')}`;
  const total = lines.reduce((s, l) => s + Number(l.final_line_price), 0);
  const rows = lines
    .map((l) => {
      const props = Object.entries((l.properties as Record<string, string>) ?? {})
        .map(([k, v]) => `<div class="${k.startsWith('_') ? 'hidden-prop' : 'prop'}" data-testid="line-property">${escapeHtml(k)}: ${escapeHtml(v)}</div>`)
        .join('');
      return `<tr data-testid="checkout-line"><td>${escapeHtml(String(l.product_title))}<div>${escapeHtml(String(l.variant_title ?? ''))}</div>${props}</td><td data-testid="line-qty">${l.quantity}</td><td>${money(Number(l.final_line_price))}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout (local mock)</title>
<style>body{font:16px/1.5 system-ui;margin:0;background:#f5f5f5;color:#222}.banner{background:#111;color:#fff;padding:12px 20px;font-weight:600}main{max-width:720px;margin:24px auto;background:#fff;padding:24px;border-radius:8px}table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #eee;vertical-align:top}.prop{font-size:13px;color:#555}.hidden-prop{font-size:13px;color:#999;font-style:italic}button{font:inherit;padding:12px 18px;background:#111;color:#fff;border:0;border-radius:6px;cursor:pointer}.ok{background:#e8f5e9;padding:12px;border-radius:6px}</style></head>
<body><div class="banner" data-testid="mock-banner">Local emulator — on the real store this is Shopify Checkout</div><main>
<h1>Checkout (local mock)</h1>
${message ? `<p class="ok" data-testid="order-placed">${escapeHtml(message)}</p>` : ''}
${lines.length ? `<table><tbody>${rows}</tbody></table><p data-testid="checkout-total"><strong>Subtotal: ${money(total)}</strong></p>` : '<p>Your cart is empty.</p>'}
${cart.note ? `<p data-testid="checkout-note"><strong>Note:</strong> ${escapeHtml(cart.note)}</p>` : ''}
${Object.keys(cart.attributes).length ? `<p data-testid="checkout-attributes">${Object.entries(cart.attributes).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join('<br>')}</p>` : ''}
${lines.length ? '<form method="post" action="/checkout"><button type="submit" data-testid="place-order">Place test order</button></form>' : ''}
<p><a href="/cart">Back to the bag</a></p></main></body></html>`;
}

/* ------------------------------------------------------------------ handler */

async function handle(req: IncomingMessage, res: ServerResponse) {
  const started = performance.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const done = (status: number, note = '') => log.request(method, path + url.search, status, Math.round(performance.now() - started), note);

  // static theme assets
  if (path.startsWith('/cdn/shop/t/1/assets/')) {
    const name = decodeURIComponent(path.slice('/cdn/shop/t/1/assets/'.length));
    const file = theme.assetPath(name);
    if (!file || name.includes('..')) {
      send(res, 404, 'Not found', 'text/plain');
      return done(404);
    }
    const type = MIME[extname(name).slice(1)] ?? 'application/octet-stream';
    // Shopify's CDN compresses text assets; do the same so local Lighthouse runs are fair.
    if (/svg|javascript|css|json/.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res);
      return done(200, 'gzip');
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': String(statSync(file).size) });
    createReadStream(file).pipe(res);
    return done(200);
  }
  if (path.startsWith('/cdn/shop/files/')) {
    await serveImage(req, res, url);
    return done(200);
  }
  if (path === '/__livereload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (path === '/favicon.ico') {
    send(res, 204, '');
    return;
  }

  const cart = getCart(req, res);
  const info = requestInfo(req, url);
  const sectionsFor = (body: Body): Record<string, string | null> | undefined => {
    const raw = body.sections;
    if (!raw) return undefined;
    const ids = (Array.isArray(raw) ? raw.map(String) : String(raw).split(',')).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const sectionsUrl = typeof body.sections_url === 'string' ? body.sections_url : '/';
    const surl = new URL(sectionsUrl, url);
    const r = route(surl) ?? notFound();
    return renderer.renderSectionsById(ids, requestInfo(req, surl), r, cart);
  };
  const view = viewFor(url);

  try {
    /* ---------------- emulator utilities ---------------- */
    if (path === '/__emulator/reset' && method === 'POST') {
      carts.clear();
      orders = [];
      contacts = [];
      flashes.clear();
      persistCarts();
      save('orders', orders);
      save('contacts', contacts);
      json(res, 200, { ok: true });
      return done(200);
    }
    if (path === '/__emulator/state') {
      json(res, 200, { cart: cartJson(cart, view), orders, contacts });
      return done(200);
    }

    /* ---------------- AJAX cart ---------------- */
    if (path === '/cart.js' && method === 'GET') {
      json(res, 200, cartJson(cart, view));
      return done(200);
    }
    const cartAction = /^\/cart\/(add|change|update|clear)(\.js)?$/.exec(path);
    if (cartAction && (method === 'POST' || (cartAction[1] === 'change' && method === 'GET'))) {
      const [, action, js] = cartAction;
      const body: Body = method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      try {
        let response: Record<string, unknown> = {};
        if (action === 'add') {
          const items = Array.isArray(body.items) ? (body.items as Body[]) : [{ id: body.id, quantity: body.quantity, properties: body.properties }];
          const keys = addItems(cart, items as never, view);
          const lines = computeLines(cart, view).map(lineItemJson);
          const added = keys.map((k) => lines.find((l) => l.key === k)).filter(Boolean) as Record<string, unknown>[];
          response = Array.isArray(body.items) ? { items: added } : (added[0] ?? {});
        } else if (action === 'change') {
          changeLine(cart, { id: body.id, line: body.line, quantity: body.quantity, properties: body.properties });
          response = cartJson(cart, view);
        } else if (action === 'update') {
          updateCart(cart, { updates: body.updates, note: body.note, attributes: body.attributes }, view);
          response = cartJson(cart, view);
        } else {
          clearCart(cart);
          response = cartJson(cart, view);
        }
        cart.updatedAt = Date.now();
        persistCarts();
        if (!js) {
          const back = typeof body.return_to === 'string' && body.return_to.startsWith('/') ? body.return_to : '/cart';
          redirect(res, back);
          return done(302);
        }
        const sections = sectionsFor(body);
        if (sections) response.sections = sections;
        json(res, 200, response);
        return done(200);
      } catch (err) {
        if (err instanceof CartError) {
          if (!js) {
            send(res, err.status, `<p>${escapeHtml(err.description)}</p><p><a href="/cart">Back</a></p>`);
            return done(err.status);
          }
          json(res, err.status, err.toJSON());
          return done(err.status, err.description);
        }
        throw err;
      }
    }
    if (path === '/cart' && method === 'POST') {
      const body = await readBody(req);
      updateCart(cart, { updates: body.updates, note: body.note, attributes: body.attributes }, view);
      cart.updatedAt = Date.now();
      persistCarts();
      redirect(res, 'checkout' in body ? '/checkout' : '/cart');
      return done(302);
    }
    if (path.startsWith('/cart/') && method === 'GET' && /^\/cart\/[\d:,]+$/.test(path)) {
      replaceWithPermalink(cart, path.slice('/cart/'.length), view);
      persistCarts();
      redirect(res, '/checkout');
      return done(302);
    }

    /* ---------------- mock checkout ---------------- */
    if (path === '/checkout') {
      if (method === 'POST') {
        const lines = computeLines(cart, view).map(lineItemJson);
        const number = `KUKI-DEV-${1001 + orders.length}`;
        orders.push({ number, placedAt: new Date().toISOString(), lines, note: cart.note, attributes: cart.attributes, total: lines.reduce((s, l) => s + Number(l.final_line_price), 0) });
        save('orders', orders);
        clearCart(cart);
        cart.note = null;
        persistCarts();
        send(res, 200, checkoutPage(cart, `Test order ${number} placed`));
        return done(200);
      }
      send(res, 200, checkoutPage(cart, null));
      return done(200);
    }

    /* ---------------- contact ---------------- */
    if (path === '/contact' && method === 'POST') {
      const body = await readBody(req);
      const contact = (body.contact ?? {}) as Record<string, string>;
      const errors: Record<string, string> = {};
      const email = (contact.email ?? '').trim();
      if (!email) errors.email = "can't be blank";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'is invalid';
      const back = new URL(req.headers.referer ?? '/pages/contact', url);
      if (Object.keys(errors).length) {
        flashes.set(cart.token, { formType: 'contact', errors, values: contact });
        redirect(res, `${back.pathname}#contact_form`, 303);
        return done(303, 'contact error');
      }
      contacts.push({ at: new Date().toISOString(), ...contact });
      save('contacts', contacts);
      redirect(res, `${back.pathname}?contact_posted=true#contact_form`, 303);
      return done(303);
    }

    /* ---------------- AJAX product, search, misc ---------------- */
    let r: RegExpExecArray | null;
    if ((r = /^\/products\/([^/]+)\.(js|json)$/.exec(path))) {
      const p = view.product(r[1]!);
      if (!p) {
        json(res, 404, { status: 404, message: 'Not Found' });
        return done(404);
      }
      json(res, 200, r[2] === 'js' ? productJson(p, 'ajax') : { product: productJson(p, 'liquid') });
      return done(200);
    }
    if (path === '/search/suggest.json') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const products = view.allProducts().filter((p) => p.title.toLowerCase().includes(q)).slice(0, 6).map((p) => productJson(p, 'ajax'));
      json(res, 200, { resources: { results: { products } } });
      return done(200);
    }
    if (path === '/recommendations/products.json') {
      const id = Number(url.searchParams.get('product_id'));
      const products = view.allProducts().filter((p) => p.id !== id).slice(0, 4).map((p) => productJson(p, 'ajax'));
      json(res, 200, { products });
      return done(200);
    }
    if (path.startsWith('/account')) {
      redirect(res, model.shop.customerAccountsUrl);
      return done(302);
    }
    if (path === '/robots.txt') {
      send(res, 200, `User-agent: *\nDisallow: /cart\nDisallow: /checkout\nDisallow: /account\nSitemap: ${model.shop.url}/sitemap.xml\n`, 'text/plain');
      return done(200);
    }
    if (path === '/sitemap.xml') {
      const urls = ['/', '/collections/all', ...model.products.map((p) => `/products/${p.handle}`), ...model.pages.map((p) => `/pages/${p.handle}`)];
      send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${model.shop.url}${u}</loc></url>`).join('')}</urlset>`, 'application/xml');
      return done(200);
    }

    /* ---------------- pages ---------------- */
    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'Method not allowed', 'text/plain');
      return done(405);
    }
    const pageRoute = route(url) ?? notFound();
    const sectionIds = url.searchParams.get('sections');
    const sectionId = url.searchParams.get('section_id');
    if (sectionIds) {
      json(res, 200, renderer.renderSectionsById(sectionIds.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5), info, pageRoute, cart));
      return done(200, 'sections');
    }
    if (sectionId) {
      const html = renderer.renderSectionsById([sectionId], info, pageRoute, cart)[sectionId];
      if (html === null || html === undefined) send(res, 404, 'Section not found', 'text/plain');
      else send(res, 200, html);
      return done(html ? 200 : 404, 'section_id');
    }
    const flash = flashes.get(cart.token) ?? null;
    if (flash) flashes.delete(cart.token);
    const result = renderer.renderPage(info, pageRoute, cart, flash);
    send(res, result.status, result.html);
    return done(result.status, result.errors ? `${result.errors} liquid error(s)` : '');
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(message);
    send(res, 500, `<pre style="white-space:pre-wrap;color:#a00">${escapeHtml(message)}</pre>`);
    return done(500);
  }
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    log.error(String(err?.stack ?? err));
    if (!res.headersSent) send(res, 500, 'Internal error', 'text/plain');
  });
}).listen(PORT, HOST, () => {
  log.info(`Kuki local store on http://${HOST}:${PORT}  (theme: ${THEME_DIR})`);
});

// Reload store data when it changes (node --watch also restarts on dev/ and store/ edits).
watch(resolve(ROOT, 'store'), { recursive: true }, () => {
  try {
    model = loadStoreModel({ storeDir: resolve(ROOT, 'store'), fixturesDir: resolve(ROOT, 'dev/fixtures') });
  } catch (err) {
    log.error(`store data: ${(err as Error).message}`);
  }
});
