// Loads the store data the emulator serves, in three layers:
//   store/snapshot (what the live store has today)
//   -> store/setup (pages, menus, metaobjects, product fixes the setup script will create)
//   -> dev/fixtures/overlays.json (dev-only additions, never sent to the store)
import { join } from 'node:path';
import * as log from './log.ts';
import { centsFromPriceString, isPlainObject, readJsonFile, readJsonIfExists, stableId } from './util.ts';

export interface VariantData {
  id: number;
  productId: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  sku: string | null;
  barcode: string | null;
  requiresShipping: boolean;
  taxable: boolean;
  available: boolean;
  price: number;
  compareAtPrice: number | null;
  grams: number;
  position: number;
  featuredImageId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ImageData {
  id: number;
  productId: number | null;
  position: number;
  fileName: string;
  width: number;
  height: number;
  alt: string | null;
  variantIds: number[];
}

export interface ProductOptionData {
  name: string;
  position: number;
  values: string[];
}

export interface MetafieldData {
  type: string;
  value: unknown;
}

export interface ProductData {
  id: number;
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  templateSuffix: string | null;
  options: ProductOptionData[];
  variants: VariantData[];
  images: ImageData[];
  /** keyed "namespace.key" */
  metafields: Record<string, MetafieldData>;
}

export interface CollectionData {
  id: number;
  handle: string;
  title: string;
  descriptionHtml: string;
  /** null = every product (the automatic /collections/all) */
  productHandles: string[] | null;
  defaultSortBy: string;
  templateSuffix: string | null;
  publishedAt: string | null;
}

export interface PageData {
  id: number;
  handle: string;
  title: string;
  bodyHtml: string;
  templateSuffix: string | null;
  publishedAt: string | null;
  author: string | null;
}

export interface MenuLinkData {
  title: string;
  url: string;
  links: MenuLinkData[];
}

export interface MenuData {
  handle: string;
  title: string;
  links: MenuLinkData[];
}

export interface PolicyData {
  id: number;
  handle: string;
  title: string;
  body: string;
}

export interface ArticleData {
  id: number;
  handle: string;
  title: string;
  bodyHtml: string;
  excerptHtml: string;
  author: string;
  tags: string[];
  publishedAt: string | null;
  image: string | null;
}

export interface BlogData {
  id: number;
  handle: string;
  title: string;
  articles: ArticleData[];
}

export interface MetaobjectFieldDef {
  key: string;
  name: string;
  type: string;
  description?: string;
  validations?: Array<{ name: string; value: string }>;
}

export interface MetaobjectDefinition {
  type: string;
  name: string;
  displayNameKey: string | null;
  fields: MetaobjectFieldDef[];
  fieldsByKey: Map<string, MetaobjectFieldDef>;
}

export interface MetaobjectEntry {
  id: number;
  type: string;
  handle: string;
  fields: Record<string, unknown>;
}

export interface MetafieldDefinition {
  ownerType: string;
  namespace: string;
  key: string;
  type: string;
  metaobjectType: string | null;
}

export interface ShopData {
  id: number;
  name: string;
  myshopifyDomain: string;
  domain: string;
  url: string;
  city: string | null;
  province: string | null;
  country: string | null;
  currency: string;
  moneyFormat: string;
  moneyWithCurrencyFormat: string;
  timezone: string;
  description: string;
  phone: string | null;
  email: string | null;
  customerAccountsUrl: string;
  passwordMessage: string;
}

export interface StoreModel {
  shop: ShopData;
  products: ProductData[];
  productsByHandle: Map<string, ProductData>;
  productsById: Map<number, ProductData>;
  variantsById: Map<number, { product: ProductData; variant: VariantData }>;
  collections: CollectionData[];
  collectionsByHandle: Map<string, CollectionData>;
  pages: PageData[];
  pagesByHandle: Map<string, PageData>;
  menus: Map<string, MenuData>;
  policies: PolicyData[];
  missingPolicies: string[];
  blogs: Map<string, BlogData>;
  metaobjectDefinitions: Map<string, MetaobjectDefinition>;
  metaobjects: Map<string, MetaobjectEntry[]>;
  metafieldDefinitions: MetafieldDefinition[];
  /** Handles of products whose images are expected under dev/fixtures/files */
  loadedAt: number;
}

export interface StorePaths {
  storeDir: string;
  fixturesDir: string;
}

type Raw = Record<string, unknown>;

function asRaw(value: unknown): Raw {
  return isPlainObject(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fileNameFromSrc(src: string): string {
  try {
    const url = new URL(src, 'https://cdn.shopify.com');
    const name = url.pathname.split('/').pop() ?? '';
    return decodeURIComponent(name);
  } catch {
    return src.split('/').pop()?.split('?')[0] ?? src;
  }
}

function normalizeProduct(raw: Raw): ProductData {
  const id = num(raw.id);
  const images: ImageData[] = asArray(raw.images).map((imgRaw, index) => {
    const img = asRaw(imgRaw);
    return {
      id: num(img.id, stableId(`image:${id}:${index}`)),
      productId: id,
      position: num(img.position, index + 1),
      fileName: fileNameFromSrc(str(img.src)),
      width: num(img.width),
      height: num(img.height),
      alt: strOrNull(img.alt),
      variantIds: asArray(img.variant_ids).map((v) => num(v)),
    };
  });
  const variants: VariantData[] = asArray(raw.variants).map((vRaw, index) => {
    const v = asRaw(vRaw);
    const featured = asRaw(v.featured_image);
    return {
      id: num(v.id),
      productId: id,
      title: str(v.title, 'Default Title'),
      option1: strOrNull(v.option1),
      option2: strOrNull(v.option2),
      option3: strOrNull(v.option3),
      sku: strOrNull(v.sku),
      barcode: strOrNull(v.barcode),
      requiresShipping: v.requires_shipping !== false,
      taxable: v.taxable !== false,
      available: v.available !== false,
      price: centsFromPriceString(v.price) ?? 0,
      compareAtPrice: centsFromPriceString(v.compare_at_price),
      grams: num(v.grams),
      position: num(v.position, index + 1),
      featuredImageId: featured.id === undefined ? null : num(featured.id),
      createdAt: strOrNull(v.created_at),
      updatedAt: strOrNull(v.updated_at),
    };
  });
  const options: ProductOptionData[] = asArray(raw.options).map((oRaw, index) => {
    const o = asRaw(oRaw);
    return { name: str(o.name), position: num(o.position, index + 1), values: asArray(o.values).map((x) => str(x)) };
  });
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => str(t))
    : str(raw.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
  return {
    id,
    handle: str(raw.handle),
    title: str(raw.title),
    bodyHtml: str(raw.body_html),
    vendor: str(raw.vendor),
    productType: str(raw.product_type),
    tags,
    publishedAt: strOrNull(raw.published_at),
    createdAt: strOrNull(raw.created_at),
    updatedAt: strOrNull(raw.updated_at),
    templateSuffix: strOrNull(raw.template_suffix),
    options,
    variants,
    images,
    metafields: {},
  };
}

function variantTitle(v: VariantData): string {
  const parts = [v.option1, v.option2, v.option3].filter((x): x is string => x !== null);
  return parts.length ? parts.join(' / ') : 'Default Title';
}

function applyProductFix(product: ProductData, fix: Raw): void {
  const renames = asRaw(fix.renameOptionValues);
  for (const [optionName, mappingRaw] of Object.entries(renames)) {
    const mapping = asRaw(mappingRaw);
    const option = product.options.find((o) => o.name === optionName);
    if (!option) {
      log.warn(`productFixes: ${product.handle} has no option "${optionName}"`);
      continue;
    }
    const key = (['option1', 'option2', 'option3'] as const)[option.position - 1];
    option.values = option.values.map((v) => (typeof mapping[v] === 'string' ? (mapping[v] as string) : v));
    if (!key) continue;
    for (const variant of product.variants) {
      const current = variant[key];
      if (current !== null && typeof mapping[current] === 'string') variant[key] = mapping[current] as string;
      variant.title = variantTitle(variant);
    }
  }
  if (typeof fix.productType === 'string') product.productType = fix.productType;
  if (typeof fix.title === 'string') product.title = fix.title;
  if (typeof fix.templateSuffix === 'string') product.templateSuffix = fix.templateSuffix;
}

function normalizeMenuLinks(value: unknown): MenuLinkData[] {
  return asArray(value).map((lRaw) => {
    const l = asRaw(lRaw);
    return { title: str(l.title), url: str(l.url), links: normalizeMenuLinks(l.links) };
  });
}

function normalizeEntry(type: string, raw: Raw): MetaobjectEntry {
  const handle = str(raw.handle);
  return {
    id: num(raw.id, stableId(`metaobject:${type}:${handle}`)),
    type,
    handle,
    fields: { ...asRaw(raw.fields) },
  };
}

export function loadStoreModel(paths: StorePaths): StoreModel {
  const snap = (name: string): Raw => asRaw(readJsonFile(join(paths.storeDir, 'snapshot', name)));
  const setupFile = (name: string): Raw => asRaw(readJsonIfExists(join(paths.storeDir, 'setup', name)));

  const shopRaw = snap('shop.json');
  const content = setupFile('content.json');
  const definitions = setupFile('definitions.json');
  const seed = setupFile('seed.json');
  const overlays = asRaw(readJsonIfExists(join(paths.fixturesDir, 'overlays.json')));

  // ---- shop
  const shop: ShopData = {
    id: num(shopRaw.id),
    name: str(shopRaw.name, 'Shop'),
    myshopifyDomain: str(shopRaw.myshopify_domain),
    domain: str(shopRaw.domain),
    url: str(shopRaw.url, `https://${str(shopRaw.domain)}`),
    city: strOrNull(shopRaw.city),
    province: strOrNull(shopRaw.province),
    country: strOrNull(shopRaw.country),
    currency: str(shopRaw.currency, 'INR'),
    moneyFormat: str(shopRaw.money_format, '{{amount}}'),
    moneyWithCurrencyFormat: str(shopRaw.money_with_currency_format, '{{amount}}'),
    timezone: str(shopRaw.timezone, 'Asia/Kolkata'),
    description: str(shopRaw.description),
    phone: strOrNull(shopRaw.phone),
    email: strOrNull(shopRaw.email),
    customerAccountsUrl: str(shopRaw.customer_accounts_url, `https://shopify.com/${num(shopRaw.id)}/account`),
    passwordMessage: str(shopRaw.password_message),
  };
  const shopOverlay = asRaw(overlays.shop);
  for (const [k, v] of Object.entries(shopOverlay)) {
    if (k in shop) (shop as unknown as Raw)[k] = v;
  }

  // ---- products (+ setup fixes + overlay patches)
  const products = asArray(snap('products.json').products).map((p) => normalizeProduct(asRaw(p)));
  const productsByHandle = new Map(products.map((p) => [p.handle, p]));
  for (const fixRaw of asArray(content.productFixes)) {
    const fix = asRaw(fixRaw);
    const product = productsByHandle.get(str(fix.product));
    if (!product) {
      log.warn(`productFixes: unknown product "${str(fix.product)}"`);
      continue;
    }
    applyProductFix(product, fix);
  }
  for (const patchRaw of asArray(overlays.products)) {
    const patch = asRaw(patchRaw);
    const product = productsByHandle.get(str(patch.handle));
    if (!product) {
      log.warn(`overlays.json: unknown product "${str(patch.handle)}"`);
      continue;
    }
    if (typeof patch.title === 'string') product.title = patch.title;
    if (typeof patch.body_html === 'string') product.bodyHtml = patch.body_html;
    if (typeof patch.template_suffix === 'string') product.templateSuffix = patch.template_suffix;
    if (Array.isArray(patch.tags)) product.tags = patch.tags.map((t) => str(t));
    for (const vpRaw of asArray(patch.variants)) {
      const vp = asRaw(vpRaw);
      const variant = product.variants.find((v) => v.id === num(vp.id));
      if (!variant) continue;
      if (typeof vp.available === 'boolean') variant.available = vp.available;
      if (vp.price !== undefined) variant.price = centsFromPriceString(vp.price) ?? variant.price;
      if (vp.compare_at_price !== undefined) variant.compareAtPrice = centsFromPriceString(vp.compare_at_price);
    }
  }

  // ---- metaobject + metafield definitions
  const metaobjectDefinitions = new Map<string, MetaobjectDefinition>();
  for (const dRaw of asArray(definitions.metaobjects)) {
    const d = asRaw(dRaw);
    const fields: MetaobjectFieldDef[] = asArray(d.fields).map((fRaw) => {
      const f = asRaw(fRaw);
      const def: MetaobjectFieldDef = { key: str(f.key), name: str(f.name), type: str(f.type) };
      if (typeof f.description === 'string') def.description = f.description;
      if (Array.isArray(f.validations)) {
        def.validations = f.validations.map((vRaw) => {
          const v = asRaw(vRaw);
          return { name: str(v.name), value: str(v.value) };
        });
      }
      return def;
    });
    metaobjectDefinitions.set(str(d.type), {
      type: str(d.type),
      name: str(d.name),
      displayNameKey: strOrNull(d.displayNameKey),
      fields,
      fieldsByKey: new Map(fields.map((f) => [f.key, f])),
    });
  }
  const metafieldDefinitions: MetafieldDefinition[] = asArray(definitions.metafields).map((mRaw) => {
    const m = asRaw(mRaw);
    return {
      ownerType: str(m.ownerType),
      namespace: str(m.namespace),
      key: str(m.key),
      type: str(m.type),
      metaobjectType: strOrNull(m.metaobjectType),
    };
  });

  // ---- metaobject entries: seed, then overlays (merge by handle, field-level)
  const metaobjects = new Map<string, MetaobjectEntry[]>();
  for (const type of metaobjectDefinitions.keys()) metaobjects.set(type, []);
  const productLinks: Array<{ type: string; handle: string; product: string }> = [];
  const addEntries = (source: Raw, label: string): void => {
    for (const [type, list] of Object.entries(source)) {
      if (type.startsWith('$')) continue;
      if (!metaobjectDefinitions.has(type)) {
        log.warn(`${label}: metaobject type "${type}" has no definition in store/setup/definitions.json`);
      }
      const entries = metaobjects.get(type) ?? [];
      for (const raw of asArray(list)) {
        const entryRaw = asRaw(raw);
        const entry = normalizeEntry(type, entryRaw);
        const existing = entries.find((e) => e.handle === entry.handle);
        if (existing) Object.assign(existing.fields, entry.fields);
        else entries.push(entry);
        if (typeof entryRaw.product === 'string') productLinks.push({ type, handle: entry.handle, product: entryRaw.product });
      }
      metaobjects.set(type, entries);
    }
  };
  addEntries(seed, 'store/setup/seed.json');
  addEntries(asRaw(overlays.metaobjects), 'dev/fixtures/overlays.json');

  // product metafields that point at metaobjects (custom.flavour_story)
  for (const link of productLinks) {
    const product = productsByHandle.get(link.product);
    if (!product) {
      log.warn(`metaobject ${link.type}/${link.handle} links unknown product "${link.product}"`);
      continue;
    }
    const def = metafieldDefinitions.find(
      (m) => m.ownerType === 'PRODUCT' && m.type === 'metaobject_reference' && m.metaobjectType === link.type,
    );
    if (!def) {
      log.warn(`no PRODUCT metaobject_reference metafield definition for metaobject type "${link.type}"`);
      continue;
    }
    product.metafields[`${def.namespace}.${def.key}`] = { type: def.type, value: `${link.type}/${link.handle}` };
  }
  for (const [handle, fieldsRaw] of Object.entries(asRaw(overlays.productMetafields))) {
    const product = productsByHandle.get(handle);
    if (!product) continue;
    for (const [nsKey, mfRaw] of Object.entries(asRaw(fieldsRaw))) {
      const mf = asRaw(mfRaw);
      product.metafields[nsKey] = { type: str(mf.type, 'single_line_text_field'), value: mf.value };
    }
  }

  // ---- collections (+ the automatic "all")
  const collections: CollectionData[] = asArray(snap('collections.json').collections).map((cRaw) => {
    const c = asRaw(cRaw);
    const handle = str(c.handle);
    return {
      id: num(c.id, stableId(`collection:${handle}`)),
      handle,
      title: str(c.title),
      descriptionHtml: str(c.description ?? c.body_html),
      productHandles: asArray(c.products).map((p) => str(p)),
      defaultSortBy: str(c.sort_order, 'manual'),
      templateSuffix: strOrNull(c.template_suffix),
      publishedAt: strOrNull(c.published_at),
    };
  });
  const allCollection: CollectionData = {
    id: stableId('collection:all'),
    handle: 'all',
    title: 'Products',
    descriptionHtml: '',
    productHandles: null,
    defaultSortBy: 'title-ascending',
    templateSuffix: null,
    publishedAt: null,
  };
  const collectionsByHandle = new Map(collections.map((c) => [c.handle, c]));
  collectionsByHandle.set('all', allCollection);

  // ---- pages: snapshot + setup (setup pages exist "as if setup already ran")
  const pages: PageData[] = asArray(snap('pages.json').pages).map((pRaw) => {
    const p = asRaw(pRaw);
    const handle = str(p.handle);
    return {
      id: num(p.id, stableId(`page:${handle}`)),
      handle,
      title: str(p.title),
      bodyHtml: str(p.body_html),
      templateSuffix: strOrNull(p.template_suffix),
      publishedAt: strOrNull(p.published_at),
      author: strOrNull(p.author),
    };
  });
  const mergePages = (list: unknown[]): void => {
    for (const pRaw of list) {
      const p = asRaw(pRaw);
      const handle = str(p.handle);
      const existing = pages.find((x) => x.handle === handle);
      const page: PageData = {
        id: existing?.id ?? stableId(`page:${handle}`),
        handle,
        title: str(p.title, existing?.title ?? handle),
        bodyHtml: str(p.body_html, existing?.bodyHtml ?? ''),
        templateSuffix: p.template_suffix === undefined ? (existing?.templateSuffix ?? null) : strOrNull(p.template_suffix),
        publishedAt: existing?.publishedAt ?? null,
        author: existing?.author ?? null,
      };
      if (existing) Object.assign(existing, page);
      else pages.push(page);
    }
  };
  mergePages(asArray(content.pages));
  mergePages(asArray(overlays.pages));
  const pagesByHandle = new Map(pages.map((p) => [p.handle, p]));

  // ---- menus: setup menus replace snapshot menus with the same handle
  const menus = new Map<string, MenuData>();
  const addMenus = (list: unknown[]): void => {
    for (const mRaw of list) {
      const m = asRaw(mRaw);
      menus.set(str(m.handle), { handle: str(m.handle), title: str(m.title), links: normalizeMenuLinks(m.links) });
    }
  };
  addMenus(asArray(snap('menus.json').menus));
  addMenus(asArray(content.menus));
  addMenus(asArray(overlays.menus));

  // ---- policies (missing ones stay missing, like the live store)
  const policiesRaw = snap('policies.json');
  const policies: PolicyData[] = asArray(policiesRaw.policies).map((pRaw) => {
    const p = asRaw(pRaw);
    const handle = str(p.handle);
    return { id: num(p.id, stableId(`policy:${handle}`)), handle, title: str(p.title), body: str(p.body) };
  });
  const missingPolicies = asArray(policiesRaw.missing).map((x) => str(x));

  // ---- blogs
  const blogs = new Map<string, BlogData>();
  for (const bRaw of asArray(snap('blogs.json').blogs)) {
    const b = asRaw(bRaw);
    const handle = str(b.handle);
    blogs.set(handle, {
      id: num(b.id, stableId(`blog:${handle}`)),
      handle,
      title: str(b.title),
      articles: asArray(b.articles).map((aRaw) => {
        const a = asRaw(aRaw);
        const ah = str(a.handle);
        return {
          id: num(a.id, stableId(`article:${handle}:${ah}`)),
          handle: ah,
          title: str(a.title),
          bodyHtml: str(a.body_html),
          excerptHtml: str(a.summary_html),
          author: str(a.author),
          tags: asArray(a.tags).map((t) => str(t)),
          publishedAt: strOrNull(a.published_at),
          image: strOrNull(a.image),
        };
      }),
    });
  }

  const productsById = new Map(products.map((p) => [p.id, p]));
  const variantsById = new Map<number, { product: ProductData; variant: VariantData }>();
  for (const product of products) {
    for (const variant of product.variants) variantsById.set(variant.id, { product, variant });
  }

  return {
    shop,
    products,
    productsByHandle,
    productsById,
    variantsById,
    collections,
    collectionsByHandle,
    pages,
    pagesByHandle,
    menus,
    policies,
    missingPolicies,
    blogs,
    metaobjectDefinitions,
    metaobjects,
    metafieldDefinitions,
    loadedAt: Date.now(),
  };
}
