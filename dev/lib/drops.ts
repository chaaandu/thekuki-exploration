// Shopify Liquid objects (drops) built per request from the store model.
import { BaseDrop } from './drop-base.ts';
import { ColorDrop } from './colors.ts';
import { LiquidFloat } from './numbers.ts';
import { LiquidTime, SHOP_TIMEZONE, liquidTimeFromIso } from './dates.ts';
import type { FileIndex } from './files.ts';
import * as log from './log.ts';
import type {
  ArticleData,
  BlogData,
  CollectionData,
  ImageData,
  MenuLinkData,
  MetaobjectDefinition,
  MetaobjectEntry,
  PageData,
  PolicyData,
  ProductData,
  StoreModel,
  VariantData,
} from './store-data.ts';
import { dateInZone, escapeHtml, handleize, resolveShopifyUrl, stableId } from './util.ts';

export const MAX_UNPAGINATED = 50;

export interface ViewInit {
  model: StoreModel;
  files: FileIndex;
  now: Date;
  path: string;
  query: URLSearchParams;
  /** collection being viewed (its products honour ?sort_by=) */
  pageCollection?: string | null;
}

// ---------------------------------------------------------------------------------------
// Images & media

export interface ImageInit {
  id: number;
  fileName: string;
  width: number;
  height: number;
  alt: string;
  position: number | null;
  productId: number | null;
  variantIds: number[];
  /** file is present in dev/fixtures/files */
  present: boolean;
}

export function imageSrc(fileName: string): string {
  return `/cdn/shop/files/${encodeURIComponent(fileName).replace(/%2F/g, '/')}?v=1`;
}

/** An image (and, for product media, an image media object). */
export class ImageDrop extends BaseDrop {
  #i: ImageInit;

  constructor(init: ImageInit) {
    super();
    this.#i = init;
  }

  cdnFileName(): string {
    return this.#i.fileName;
  }

  get id(): number {
    return this.#i.id;
  }

  get src(): string {
    return imageSrc(this.#i.fileName);
  }

  get url(): string {
    return this.src;
  }

  get width(): number {
    return this.#i.width;
  }

  get height(): number {
    return this.#i.height;
  }

  get aspect_ratio(): LiquidFloat | null {
    if (!this.#i.width || !this.#i.height) return null;
    return new LiquidFloat(this.#i.width / this.#i.height);
  }

  get alt(): string {
    return this.#i.alt;
  }

  get media_type(): string {
    return 'image';
  }

  get position(): number | null {
    return this.#i.position;
  }

  get product_id(): number | null {
    return this.#i.productId;
  }

  get variants(): never[] {
    return [];
  }

  get variant_ids(): number[] {
    return this.#i.variantIds;
  }

  get 'attached_to_variant?'(): boolean {
    return this.#i.variantIds.length > 0;
  }

  get preview_image(): ImageDrop {
    return this;
  }

  get presentation(): { focal_point: null } {
    return { focal_point: null };
  }

  get focal_point(): null {
    return null;
  }

  isPresent(): boolean {
    return this.#i.present;
  }

  override toString(): string {
    return this.src;
  }

  override identity(): unknown {
    return `image:${this.#i.id}:${this.#i.fileName}`;
  }

  override toJSON(): unknown {
    const ratio = this.aspect_ratio?.value ?? null;
    return {
      alt: this.#i.alt,
      aspect_ratio: ratio,
      height: this.#i.height,
      id: this.#i.id,
      media_type: 'image',
      position: this.#i.position,
      preview_image: { aspect_ratio: ratio, height: this.#i.height, width: this.#i.width, src: this.src },
      product_id: this.#i.productId,
      src: this.src,
      variant_ids: this.#i.variantIds,
      width: this.#i.width,
    };
  }
}

// ---------------------------------------------------------------------------------------
// Metafields & metaobjects

/** A metafield as Liquid sees it: `{{ mf }}` prints the value, `mf.value` is typed. Always truthy. */
export class MetafieldValue {
  value: unknown;
  type: string;
  'list?': boolean;
  #raw: unknown;

  constructor(value: unknown, type: string, raw: unknown) {
    this.value = value;
    this.type = type;
    this['list?'] = type.startsWith('list.');
    this.#raw = raw;
  }

  toString(): string {
    const v = this.value;
    if (this['list?']) return JSON.stringify(this.#raw);
    if (v instanceof MetaobjectDrop) return `gid://shopify/Metaobject/${v.system.id}`;
    if (v instanceof ProductDrop) return `gid://shopify/Product/${v.id}`;
    if (v instanceof ImageDrop) return `gid://shopify/MediaImage/${v.id}`;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && !(v instanceof BaseDrop) && !(v instanceof LiquidFloat)) return JSON.stringify(v);
    return String(v);
  }

  toJSON(): unknown {
    return this.value;
  }
}

function isUnset(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0);
}

export class MetaobjectDrop extends BaseDrop {
  #entry: MetaobjectEntry;
  #def: MetaobjectDefinition | undefined;
  #view: StoreView;
  #fields = new Map<string, MetafieldValue | null>();

  constructor(entry: MetaobjectEntry, def: MetaobjectDefinition | undefined, view: StoreView) {
    super();
    this.#entry = entry;
    this.#def = def;
    this.#view = view;
  }

  get system(): Record<string, unknown> {
    return {
      id: this.#entry.id,
      handle: this.#entry.handle,
      type: this.#entry.type,
      url: null,
    };
  }

  field(key: string): MetafieldValue | null {
    if (this.#fields.has(key)) return this.#fields.get(key) ?? null;
    let result: MetafieldValue | null = null;
    const def = this.#def?.fieldsByKey.get(key);
    if (!def && this.#def) {
      log.warnOnce(
        `mo-field:${this.#entry.type}:${key}`,
        `metaobject ${this.#entry.type} has no field "${key}" (store/setup/definitions.json) – Liquid gets nil`,
      );
    }
    const raw = this.#entry.fields[key];
    if (!isUnset(raw)) {
      const type = def?.type ?? 'single_line_text_field';
      const value = this.#view.convertMetafieldValue(type, raw, `${this.#entry.type}.${key}`);
      result = value === null || value === undefined ? null : new MetafieldValue(value, type, raw);
    }
    this.#fields.set(key, result);
    return result;
  }

  override liquidMethodMissing(key: string | number): unknown {
    return this.field(String(key));
  }

  override identity(): unknown {
    return `metaobject:${this.#entry.type}:${this.#entry.handle}`;
  }

  override toString(): string {
    return 'MetaobjectDrop';
  }

  override toJSON(): unknown {
    const out: Record<string, unknown> = { handle: this.#entry.handle, type: this.#entry.type };
    for (const key of Object.keys(this.#entry.fields)) out[key] = this.field(key)?.value ?? null;
    return out;
  }
}

class MetafieldNamespaceDrop extends BaseDrop {
  #fields: Record<string, MetafieldValue | null>;

  constructor(fields: Record<string, MetafieldValue | null>) {
    super();
    this.#fields = fields;
  }

  override liquidMethodMissing(key: string | number): unknown {
    return this.#fields[String(key)] ?? null;
  }

  override toJSON(): unknown {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.#fields)) out[k] = v?.value ?? null;
    return out;
  }
}

/** `product.metafields`: namespace -> key -> metafield */
export class MetafieldsDrop extends BaseDrop {
  #byNamespace: Map<string, Record<string, MetafieldValue | null>>;

  constructor(byNamespace: Map<string, Record<string, MetafieldValue | null>>) {
    super();
    this.#byNamespace = byNamespace;
  }

  override liquidMethodMissing(key: string | number): unknown {
    return new MetafieldNamespaceDrop(this.#byNamespace.get(String(key)) ?? {});
  }

  override toJSON(): unknown {
    return {};
  }
}

class MetaobjectTypeDrop extends BaseDrop {
  #type: string;
  #view: StoreView;

  constructor(type: string, view: StoreView) {
    super();
    this.#type = type;
    this.#view = view;
  }

  get values(): MetaobjectDrop[] {
    return this.#view.metaobjectsOfType(this.#type);
  }

  get size(): number {
    return this.values.length;
  }

  override liquidMethodMissing(key: string | number): unknown {
    return this.#view.metaobject(this.#type, String(key));
  }

  *[Symbol.iterator](): Iterator<MetaobjectDrop> {
    yield* this.values;
  }
}

export class MetaobjectsDrop extends BaseDrop {
  #view: StoreView;

  constructor(view: StoreView) {
    super();
    this.#view = view;
  }

  override liquidMethodMissing(key: string | number): unknown {
    const type = String(key);
    if (!this.#view.model.metaobjectDefinitions.has(type) && !this.#view.model.metaobjects.has(type)) {
      log.warnOnce(`mo-type:${type}`, `metaobjects.${type}: no such metaobject definition – Liquid gets nil`);
      return null;
    }
    return new MetaobjectTypeDrop(type, this.#view);
  }
}

// ---------------------------------------------------------------------------------------
// Products & variants

export class ProductOptionDrop extends BaseDrop {
  readonly name: string;
  readonly position: number;
  readonly values: string[];
  readonly selected_value: string | null;

  constructor(name: string, position: number, values: string[], selected: string | null) {
    super();
    this.name = name;
    this.position = position;
    this.values = values;
    this.selected_value = selected;
  }

  override toString(): string {
    return this.name;
  }

  override toJSON(): unknown {
    return { name: this.name, position: this.position, values: this.values };
  }
}

export class VariantDrop extends BaseDrop {
  #v: VariantData;
  #p: ProductData;
  #view: StoreView;

  constructor(variant: VariantData, product: ProductData, view: StoreView) {
    super();
    this.#v = variant;
    this.#p = product;
    this.#view = view;
  }

  data(): VariantData {
    return this.#v;
  }

  get id(): number {
    return this.#v.id;
  }

  get title(): string {
    return this.#v.title;
  }

  get option1(): string | null {
    return this.#v.option1;
  }

  get option2(): string | null {
    return this.#v.option2;
  }

  get option3(): string | null {
    return this.#v.option3;
  }

  get options(): string[] {
    return [this.#v.option1, this.#v.option2, this.#v.option3].filter((x): x is string => x !== null);
  }

  get price(): number {
    return this.#v.price;
  }

  get compare_at_price(): number | null {
    return this.#v.compareAtPrice;
  }

  get available(): boolean {
    return this.#v.available;
  }

  get sku(): string | null {
    return this.#v.sku;
  }

  get barcode(): string | null {
    return this.#v.barcode;
  }

  get weight(): number {
    return this.#v.grams;
  }

  get weight_unit(): string {
    return 'kg';
  }

  get weight_in_unit(): LiquidFloat {
    return new LiquidFloat(this.#v.grams / 1000);
  }

  get requires_shipping(): boolean {
    return this.#v.requiresShipping;
  }

  get taxable(): boolean {
    return this.#v.taxable;
  }

  get url(): string {
    return `/products/${this.#p.handle}?variant=${this.#v.id}`;
  }

  get featured_image(): ImageDrop | null {
    if (this.#v.featuredImageId === null) return null;
    return this.#view.product(this.#p.handle)?.images.find((i) => i.id === this.#v.featuredImageId) ?? null;
  }

  get image(): ImageDrop | null {
    return this.featured_image;
  }

  get featured_media(): ImageDrop | null {
    return this.featured_image;
  }

  get inventory_management(): string {
    return 'shopify';
  }

  get inventory_policy(): string {
    return 'deny';
  }

  get inventory_quantity(): null {
    return null;
  }

  get incoming(): boolean {
    return false;
  }

  get next_incoming_date(): null {
    return null;
  }

  get selected(): boolean {
    return this.#view.selectedVariantId() === this.#v.id;
  }

  get matched(): boolean {
    return true;
  }

  get product(): ProductDrop | null {
    return this.#view.product(this.#p.handle);
  }

  get requires_selling_plan(): boolean {
    return false;
  }

  get selling_plan_allocations(): never[] {
    return [];
  }

  get store_availabilities(): never[] {
    return [];
  }

  get unit_price(): null {
    return null;
  }

  get unit_price_measurement(): null {
    return null;
  }

  get quantity_rule(): { min: number; max: null; increment: number } {
    return { min: 1, max: null, increment: 1 };
  }

  get quantity_price_breaks(): never[] {
    return [];
  }

  get metafields(): MetafieldsDrop {
    return new MetafieldsDrop(new Map());
  }

  get 'requires_selling_plan?'(): boolean {
    return false;
  }

  override toString(): string {
    return 'VariantDrop';
  }

  override identity(): unknown {
    return `variant:${this.#v.id}`;
  }

  override toJSON(): unknown {
    return variantJson(this.#p, this.#v, this.featured_image);
  }
}

export function isDefaultVariant(product: ProductData): boolean {
  return product.variants.length === 1 && product.variants[0]?.title === 'Default Title';
}

export function variantJson(product: ProductData, v: VariantData, featured: ImageDrop | null): Record<string, unknown> {
  const isDefault = isDefaultVariant(product);
  return {
    id: v.id,
    title: v.title,
    option1: v.option1,
    option2: v.option2,
    option3: v.option3,
    sku: v.sku,
    requires_shipping: v.requiresShipping,
    taxable: v.taxable,
    featured_image: featured ? featured.toJSON() : null,
    available: v.available,
    name: isDefault ? product.title : `${product.title} - ${v.title}`,
    public_title: isDefault ? null : v.title,
    options: [v.option1, v.option2, v.option3].filter((x) => x !== null),
    price: v.price,
    weight: v.grams,
    compare_at_price: v.compareAtPrice,
    inventory_management: 'shopify',
    barcode: v.barcode,
    requires_selling_plan: false,
    selling_plan_allocations: [],
    quantity_rule: { min: 1, max: null, increment: 1 },
  };
}

function minMax(values: number[]): { min: number | null; max: number | null } {
  if (!values.length) return { min: null, max: null };
  return { min: Math.min(...values), max: Math.max(...values) };
}

export class ProductDrop extends BaseDrop {
  #p: ProductData;
  #view: StoreView;
  #variants: VariantDrop[] | null = null;
  #images: ImageDrop[] | null = null;
  #metafields: MetafieldsDrop | null = null;

  constructor(product: ProductData, view: StoreView) {
    super();
    this.#p = product;
    this.#view = view;
  }

  data(): ProductData {
    return this.#p;
  }

  get id(): number {
    return this.#p.id;
  }

  get handle(): string {
    return this.#p.handle;
  }

  get title(): string {
    return this.#p.title;
  }

  get description(): string {
    return this.#p.bodyHtml;
  }

  get content(): string {
    return this.#p.bodyHtml;
  }

  get vendor(): string {
    return this.#p.vendor;
  }

  get type(): string {
    return this.#p.productType;
  }

  get tags(): string[] {
    return [...this.#p.tags];
  }

  get url(): string {
    return `/products/${this.#p.handle}`;
  }

  get object_type(): string {
    return 'product';
  }

  get available(): boolean {
    return this.#p.variants.some((v) => v.available);
  }

  get price(): number | null {
    return this.price_min;
  }

  get price_min(): number | null {
    return minMax(this.#p.variants.map((v) => v.price)).min;
  }

  get price_max(): number | null {
    return minMax(this.#p.variants.map((v) => v.price)).max;
  }

  get price_varies(): boolean {
    return this.price_min !== this.price_max;
  }

  #compareAts(): number[] {
    return this.#p.variants.map((v) => v.compareAtPrice).filter((x): x is number => x !== null);
  }

  get compare_at_price(): number | null {
    return this.compare_at_price_min;
  }

  get compare_at_price_min(): number | null {
    return minMax(this.#compareAts()).min;
  }

  get compare_at_price_max(): number | null {
    return minMax(this.#compareAts()).max;
  }

  get compare_at_price_varies(): boolean | null {
    const c = this.#compareAts();
    if (!c.length) return null;
    return Math.min(...c) !== Math.max(...c);
  }

  get images(): ImageDrop[] {
    if (!this.#images) {
      this.#images = this.#p.images.map((img) => this.#view.productImage(img, this.#p));
    }
    return this.#images;
  }

  get featured_image(): ImageDrop | null {
    return this.images[0] ?? null;
  }

  get media(): ImageDrop[] {
    return this.images;
  }

  get featured_media(): ImageDrop | null {
    return this.images[0] ?? null;
  }

  get options(): string[] {
    return this.#p.options.map((o) => o.name);
  }

  get options_with_values(): ProductOptionDrop[] {
    const selected = this.selected_or_first_available_variant;
    return this.#p.options.map((o, idx) => {
      const sel = selected ? (selected.options[idx] ?? null) : null;
      return new ProductOptionDrop(o.name, o.position, o.values, sel);
    });
  }

  get options_by_name(): Record<string, ProductOptionDrop> {
    const out: Record<string, ProductOptionDrop> = {};
    for (const o of this.options_with_values) out[o.name] = o;
    return out;
  }

  get has_only_default_variant(): boolean {
    return isDefaultVariant(this.#p);
  }

  get variants(): VariantDrop[] {
    if (!this.#variants) this.#variants = this.#p.variants.map((v) => new VariantDrop(v, this.#p, this.#view));
    return this.#variants;
  }

  get variants_count(): number {
    return this.#p.variants.length;
  }

  get first_available_variant(): VariantDrop | null {
    return this.variants.find((v) => v.available) ?? null;
  }

  get selected_variant(): VariantDrop | null {
    const id = this.#view.selectedVariantId();
    if (id === null) return null;
    return this.variants.find((v) => v.id === id) ?? null;
  }

  get selected_or_first_available_variant(): VariantDrop | null {
    return this.selected_variant ?? this.first_available_variant ?? this.variants[0] ?? null;
  }

  get collections(): CollectionDrop[] {
    return this.#view
      .collectionsData()
      .filter((c) => c.productHandles !== null && c.productHandles.includes(this.#p.handle))
      .map((c) => this.#view.collection(c.handle))
      .filter((c): c is CollectionDrop => c !== null);
  }

  get metafields(): MetafieldsDrop {
    if (!this.#metafields) {
      const byNs = new Map<string, Record<string, MetafieldValue | null>>();
      for (const [nsKey, mf] of Object.entries(this.#p.metafields)) {
        const dot = nsKey.indexOf('.');
        const ns = nsKey.slice(0, dot);
        const key = nsKey.slice(dot + 1);
        const value = isUnset(mf.value) ? null : this.#view.convertMetafieldValue(mf.type, mf.value, `product.${nsKey}`);
        const bucket = byNs.get(ns) ?? {};
        bucket[key] = value === null || value === undefined ? null : new MetafieldValue(value, mf.type, mf.value);
        byNs.set(ns, bucket);
      }
      this.#metafields = new MetafieldsDrop(byNs);
    }
    return this.#metafields;
  }

  get template_suffix(): string | null {
    return this.#p.templateSuffix;
  }

  get published_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#p.publishedAt);
  }

  get created_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#p.createdAt);
  }

  get updated_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#p.updatedAt);
  }

  get 'gift_card?'(): boolean {
    return false;
  }

  get requires_selling_plan(): boolean {
    return false;
  }

  get selling_plan_groups(): never[] {
    return [];
  }

  get 'quantity_price_breaks_configured?'(): boolean {
    return false;
  }

  get quantity_price_breaks_configured(): boolean {
    return false;
  }

  get selected_selling_plan(): null {
    return null;
  }

  get selected_selling_plan_allocation(): null {
    return null;
  }

  get selected_or_first_available_selling_plan_allocation(): null {
    return null;
  }

  override toString(): string {
    return 'ProductDrop';
  }

  override identity(): unknown {
    return `product:${this.#p.id}`;
  }

  /** `{{ product | json }}` (Liquid shape: options are names). */
  override toJSON(): unknown {
    return productJson(this, 'liquid');
  }
}

/** Product JSON. `liquid` = `{{ product | json }}`; `ajax` = `/products/{handle}.js`. */
export function productJson(p: ProductDrop, shape: 'liquid' | 'ajax'): Record<string, unknown> {
  const data = p.data();
  const images = p.images.map((i) => i.src);
  const base: Record<string, unknown> = {
    id: data.id,
    title: data.title,
    handle: data.handle,
    description: data.bodyHtml,
    published_at: p.published_at?.toJSON() ?? null,
    created_at: p.created_at?.toJSON() ?? null,
    vendor: data.vendor,
    type: data.productType,
    tags: data.tags,
    price: p.price_min,
    price_min: p.price_min,
    price_max: p.price_max,
    available: p.available,
    price_varies: p.price_varies,
    compare_at_price: p.compare_at_price_min,
    compare_at_price_min: p.compare_at_price_min ?? 0,
    compare_at_price_max: p.compare_at_price_max ?? 0,
    compare_at_price_varies: p.compare_at_price_varies ?? false,
    variants: p.variants.map((v) => v.toJSON()),
    images,
    featured_image: images[0] ?? null,
    options:
      shape === 'ajax'
        ? data.options.map((o) => ({ name: o.name, position: o.position, values: o.values }))
        : data.options.map((o) => o.name),
  };
  if (shape === 'ajax') base.url = p.url;
  base.media = p.media.map((m) => m.toJSON());
  base.requires_selling_plan = false;
  base.selling_plan_groups = [];
  if (shape === 'liquid') base.content = data.bodyHtml;
  return base;
}

// ---------------------------------------------------------------------------------------
// Collections, pages, blogs, policies, menus

const SORT_OPTIONS = [
  { name: 'Featured', value: 'manual' },
  { name: 'Best selling', value: 'best-selling' },
  { name: 'Alphabetically, A-Z', value: 'title-ascending' },
  { name: 'Alphabetically, Z-A', value: 'title-descending' },
  { name: 'Price, low to high', value: 'price-ascending' },
  { name: 'Price, high to low', value: 'price-descending' },
  { name: 'Date, old to new', value: 'created-ascending' },
  { name: 'Date, new to old', value: 'created-descending' },
];

function sortProducts(products: ProductDrop[], sortBy: string): ProductDrop[] {
  const list = [...products];
  const byTitle = (a: ProductDrop, b: ProductDrop): number => a.title.localeCompare(b.title, 'en');
  const created = (p: ProductDrop): number => (p.data().createdAt ? Date.parse(p.data().createdAt as string) : 0);
  switch (sortBy) {
    case 'title-ascending':
    case 'best-selling':
      return list.sort(byTitle);
    case 'title-descending':
      return list.sort((a, b) => byTitle(b, a));
    case 'price-ascending':
      return list.sort((a, b) => (a.price_min ?? 0) - (b.price_min ?? 0) || byTitle(a, b));
    case 'price-descending':
      return list.sort((a, b) => (b.price_min ?? 0) - (a.price_min ?? 0) || byTitle(a, b));
    case 'created-ascending':
      return list.sort((a, b) => created(a) - created(b));
    case 'created-descending':
      return list.sort((a, b) => created(b) - created(a));
    default:
      return list;
  }
}

export class CollectionDrop extends BaseDrop {
  #c: CollectionData;
  #view: StoreView;
  #all: ProductDrop[] | null = null;

  constructor(collection: CollectionData, view: StoreView) {
    super();
    this.#c = collection;
    this.#view = view;
  }

  data(): CollectionData {
    return this.#c;
  }

  get id(): number {
    return this.#c.id;
  }

  get handle(): string {
    return this.#c.handle;
  }

  get title(): string {
    return this.#c.title;
  }

  get description(): string {
    return this.#c.descriptionHtml;
  }

  get url(): string {
    return `/collections/${this.#c.handle}`;
  }

  get object_type(): string {
    return 'collection';
  }

  /** All products in display order (before the 50-product cap). */
  allProducts(): ProductDrop[] {
    if (!this.#all) {
      const handles = this.#c.productHandles;
      const base =
        handles === null
          ? this.#view.allProducts()
          : handles.map((h) => this.#view.product(h)).filter((p): p is ProductDrop => p !== null);
      this.#all = sortProducts(base, this.#activeSort());
    }
    return this.#all;
  }

  #activeSort(): string {
    return this.sort_by ?? this.#c.defaultSortBy;
  }

  paginationSource(prop: string): unknown[] | null {
    return prop === 'products' ? this.allProducts() : null;
  }

  get products(): ProductDrop[] {
    return this.allProducts().slice(0, MAX_UNPAGINATED);
  }

  get products_count(): number {
    return this.allProducts().length;
  }

  get all_products_count(): number {
    return this.allProducts().length;
  }

  get image(): null {
    return null;
  }

  get featured_image(): ImageDrop | null {
    return this.allProducts()[0]?.featured_image ?? null;
  }

  get template_suffix(): string | null {
    return this.#c.templateSuffix;
  }

  get sort_by(): string | null {
    if (this.#view.pageCollection !== this.#c.handle) return null;
    return this.#view.query.get('sort_by');
  }

  get default_sort_by(): string {
    return this.#c.defaultSortBy;
  }

  get sort_options(): Array<{ name: string; value: string }> {
    return SORT_OPTIONS;
  }

  get filters(): never[] {
    return [];
  }

  get current_type(): null {
    return null;
  }

  get current_vendor(): null {
    return null;
  }

  get all_tags(): string[] {
    return [...new Set(this.allProducts().flatMap((p) => p.tags))].sort();
  }

  get tags(): string[] {
    return this.all_tags;
  }

  get all_types(): string[] {
    return [...new Set(this.allProducts().map((p) => p.type))].filter(Boolean).sort();
  }

  get all_vendors(): string[] {
    return [...new Set(this.allProducts().map((p) => p.vendor))].filter(Boolean).sort();
  }

  get published_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#c.publishedAt);
  }

  get metafields(): MetafieldsDrop {
    return new MetafieldsDrop(new Map());
  }

  get next_product(): null {
    return null;
  }

  get previous_product(): null {
    return null;
  }

  override toString(): string {
    return 'CollectionDrop';
  }

  override identity(): unknown {
    return `collection:${this.#c.handle}`;
  }

  override toJSON(): unknown {
    return {
      id: this.#c.id,
      handle: this.#c.handle,
      title: this.#c.title,
      description: this.#c.descriptionHtml,
      published_at: this.#c.publishedAt,
      image: null,
      products_count: this.products_count,
      sort_order: this.#c.defaultSortBy,
      template_suffix: this.#c.templateSuffix,
    };
  }
}

export class PageDrop extends BaseDrop {
  #p: PageData;

  constructor(page: PageData) {
    super();
    this.#p = page;
  }

  get id(): number {
    return this.#p.id;
  }

  get handle(): string {
    return this.#p.handle;
  }

  get title(): string {
    return this.#p.title;
  }

  get content(): string {
    return this.#p.bodyHtml;
  }

  get url(): string {
    return `/pages/${this.#p.handle}`;
  }

  get template_suffix(): string | null {
    return this.#p.templateSuffix;
  }

  get published_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#p.publishedAt);
  }

  get author(): string | null {
    return this.#p.author;
  }

  get object_type(): string {
    return 'page';
  }

  get metafields(): MetafieldsDrop {
    return new MetafieldsDrop(new Map());
  }

  override toString(): string {
    return 'PageDrop';
  }

  override identity(): unknown {
    return `page:${this.#p.handle}`;
  }

  override toJSON(): unknown {
    return {
      id: this.#p.id,
      handle: this.#p.handle,
      title: this.#p.title,
      content: this.#p.bodyHtml,
      url: this.url,
      template_suffix: this.#p.templateSuffix,
    };
  }
}

export class ArticleDrop extends BaseDrop {
  #a: ArticleData;
  #blog: BlogData;

  constructor(article: ArticleData, blog: BlogData) {
    super();
    this.#a = article;
    this.#blog = blog;
  }

  get id(): number {
    return this.#a.id;
  }

  get handle(): string {
    return this.#a.handle;
  }

  get title(): string {
    return this.#a.title;
  }

  get content(): string {
    return this.#a.bodyHtml;
  }

  get excerpt(): string {
    return this.#a.excerptHtml;
  }

  get excerpt_or_content(): string {
    return this.#a.excerptHtml || this.#a.bodyHtml;
  }

  get author(): string {
    return this.#a.author;
  }

  get tags(): string[] {
    return this.#a.tags;
  }

  get url(): string {
    return `/blogs/${this.#blog.handle}/${this.#a.handle}`;
  }

  get published_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#a.publishedAt);
  }

  get created_at(): LiquidTime | null {
    return liquidTimeFromIso(this.#a.publishedAt);
  }

  get image(): null {
    return null;
  }

  get comments(): never[] {
    return [];
  }

  get comments_count(): number {
    return 0;
  }

  get 'comments_enabled?'(): boolean {
    return false;
  }

  get object_type(): string {
    return 'article';
  }

  get metafields(): MetafieldsDrop {
    return new MetafieldsDrop(new Map());
  }

  override identity(): unknown {
    return `article:${this.#blog.handle}:${this.#a.handle}`;
  }
}

export class BlogDrop extends BaseDrop {
  #b: BlogData;

  constructor(blog: BlogData) {
    super();
    this.#b = blog;
  }

  get id(): number {
    return this.#b.id;
  }

  get handle(): string {
    return this.#b.handle;
  }

  get title(): string {
    return this.#b.title;
  }

  get url(): string {
    return `/blogs/${this.#b.handle}`;
  }

  allArticles(): ArticleDrop[] {
    return this.#b.articles.map((a) => new ArticleDrop(a, this.#b));
  }

  paginationSource(prop: string): unknown[] | null {
    return prop === 'articles' ? this.allArticles() : null;
  }

  get articles(): ArticleDrop[] {
    return this.allArticles().slice(0, MAX_UNPAGINATED);
  }

  get articles_count(): number {
    return this.#b.articles.length;
  }

  get all_tags(): string[] {
    return [...new Set(this.#b.articles.flatMap((a) => a.tags))].sort();
  }

  get tags(): string[] {
    return this.all_tags;
  }

  get 'comments_enabled?'(): boolean {
    return false;
  }

  get 'moderated?'(): boolean {
    return false;
  }

  get next_article(): null {
    return null;
  }

  get previous_article(): null {
    return null;
  }

  get metafields(): MetafieldsDrop {
    return new MetafieldsDrop(new Map());
  }

  override identity(): unknown {
    return `blog:${this.#b.handle}`;
  }
}

export class PolicyDrop extends BaseDrop {
  #p: PolicyData;

  constructor(policy: PolicyData) {
    super();
    this.#p = policy;
  }

  get id(): number {
    return this.#p.id;
  }

  get handle(): string {
    return this.#p.handle;
  }

  get title(): string {
    return this.#p.title;
  }

  get body(): string {
    return this.#p.body;
  }

  get url(): string {
    return `/policies/${this.#p.handle}`;
  }

  override toString(): string {
    return this.#p.title;
  }

  override identity(): unknown {
    return `policy:${this.#p.handle}`;
  }

  override toJSON(): unknown {
    return { id: this.#p.id, title: this.#p.title, body: this.#p.body, url: this.url };
  }
}

export class LinkDrop extends BaseDrop {
  #l: MenuLinkData;
  #view: StoreView;
  #links: LinkDrop[];

  constructor(link: MenuLinkData, view: StoreView) {
    super();
    this.#l = link;
    this.#view = view;
    this.#links = link.links.map((child) => new LinkDrop(child, view));
  }

  get title(): string {
    return this.#l.title;
  }

  get handle(): string {
    return handleize(this.#l.title);
  }

  get url(): string {
    return resolveShopifyUrl(this.#l.url);
  }

  get links(): LinkDrop[] {
    return this.#links;
  }

  get levels(): number {
    if (!this.#links.length) return 0;
    return 1 + Math.max(...this.#links.map((l) => l.levels));
  }

  get type(): string {
    const url = this.url;
    if (url === '/') return 'frontpage_link';
    if (url === '/collections/all') return 'catalog_link';
    if (/^\/collections\/[^/?#]+$/.test(url)) return 'collection_link';
    if (url === '/collections') return 'collections_link';
    if (/^\/products\/[^/?#]+$/.test(url)) return 'product_link';
    if (/^\/pages\/[^/?#]+$/.test(url)) return 'page_link';
    if (/^\/blogs\/[^/?#]+$/.test(url)) return 'blog_link';
    if (/^\/blogs\/[^/?#]+\/[^/?#]+$/.test(url)) return 'article_link';
    if (/^\/policies\/[^/?#]+$/.test(url)) return 'policy_link';
    if (url.startsWith('/search')) return 'search_link';
    return 'http_link';
  }

  get object(): unknown {
    const url = this.url;
    let m = /^\/collections\/([^/?#]+)$/.exec(url);
    if (m) return this.#view.collection(m[1] as string);
    m = /^\/products\/([^/?#]+)$/.exec(url);
    if (m) return this.#view.product(m[1] as string);
    m = /^\/pages\/([^/?#]+)$/.exec(url);
    if (m) return this.#view.page(m[1] as string);
    m = /^\/blogs\/([^/?#]+)$/.exec(url);
    if (m) return this.#view.blog(m[1] as string);
    m = /^\/policies\/([^/?#]+)$/.exec(url);
    if (m) return this.#view.policy(m[1] as string);
    return null;
  }

  get current(): boolean {
    return this.url === this.#view.path;
  }

  get active(): boolean {
    if (this.current) return true;
    const url = this.url;
    // A collection link is also active while viewing a product inside that collection.
    if (/^\/collections\/[^/?#]+$/.test(url) && this.#view.path.startsWith(`${url}/products/`)) return true;
    return false;
  }

  get child_current(): boolean {
    return this.#links.some((l) => l.current || l.child_current);
  }

  get child_active(): boolean {
    return this.#links.some((l) => l.active || l.child_active);
  }

  override toString(): string {
    return 'LinkDrop';
  }

  override toJSON(): unknown {
    return { title: this.title, url: this.url, type: this.type, links: this.#links.map((l) => l.toJSON()) };
  }
}

export class LinklistDrop extends BaseDrop {
  #handle: string;
  #title: string;
  #links: LinkDrop[];

  constructor(handle: string, title: string, links: LinkDrop[]) {
    super();
    this.#handle = handle;
    this.#title = title;
    this.#links = links;
  }

  get handle(): string {
    return this.#handle;
  }

  get title(): string {
    return this.#title;
  }

  get links(): LinkDrop[] {
    return this.#links;
  }

  get levels(): number {
    if (!this.#links.length) return 0;
    return 1 + Math.max(...this.#links.map((l) => l.levels));
  }

  override toString(): string {
    return 'LinkListDrop';
  }

  override identity(): unknown {
    return `linklist:${this.#handle}`;
  }

  override toJSON(): unknown {
    return { handle: this.#handle, title: this.#title, links: this.#links.map((l) => l.toJSON()) };
  }
}

// Map-like globals: all_products, collections, pages, blogs, linklists, policies --------

class LookupDrop<T> extends BaseDrop {
  #lookup: (key: string) => T | null;
  #list: () => T[];

  constructor(lookup: (key: string) => T | null, list: () => T[]) {
    super();
    this.#lookup = lookup;
    this.#list = list;
  }

  override liquidMethodMissing(key: string | number): unknown {
    return this.#lookup(String(key));
  }

  get size(): number {
    return this.#list().length;
  }

  get first(): T | null {
    return this.#list()[0] ?? null;
  }

  get last(): T | null {
    const l = this.#list();
    return l[l.length - 1] ?? null;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.#list();
  }

  override toJSON(): unknown {
    return this.#list();
  }
}

/** Shopify's video_url setting value. */
export class VideoUrlDrop extends BaseDrop {
  readonly id: string;
  readonly type: string;
  #url: string;

  constructor(url: string, type: string, id: string) {
    super();
    this.#url = url;
    this.type = type;
    this.id = id;
  }

  override toString(): string {
    return this.#url;
  }
}

/** Value standing in for an unsupported Shopify feature: prints a loud inline error. */
export class UnsupportedDrop extends BaseDrop {
  readonly #what: string;

  constructor(what: string) {
    super();
    this.#what = what;
  }

  override liquidMethodMissing(): unknown {
    return this;
  }

  override toString(): string {
    return `<span class="kuki-emulator-error" style="display:inline-block;border:2px solid #c00;background:#fee;color:#900;font:12px/1.4 monospace;padding:2px 6px">Emulator: ${escapeHtml(this.#what)} is not supported locally</span>`;
  }
}

// ---------------------------------------------------------------------------------------
// The per-request view of the store

export class StoreView {
  readonly model: StoreModel;
  readonly files: FileIndex;
  readonly now: Date;
  readonly path: string;
  readonly query: URLSearchParams;
  pageCollection: string | null;
  #products = new Map<string, ProductDrop | null>();
  #collections = new Map<string, CollectionDrop | null>();
  #metaobjects = new Map<string, MetaobjectDrop | null>();
  #linklists = new Map<string, LinklistDrop | null>();

  constructor(init: ViewInit) {
    this.model = init.model;
    this.files = init.files;
    this.now = init.now;
    this.path = init.path;
    this.query = init.query;
    this.pageCollection = init.pageCollection ?? null;
  }

  get timezone(): string {
    return this.model.shop.timezone || SHOP_TIMEZONE;
  }

  today(): string {
    return dateInZone(this.now, this.timezone);
  }

  selectedVariantId(): number | null {
    const raw = this.query.get('variant');
    if (!raw || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  }

  product(handle: string): ProductDrop | null {
    if (!this.#products.has(handle)) {
      const data = this.model.productsByHandle.get(handle);
      this.#products.set(handle, data ? new ProductDrop(data, this) : null);
    }
    return this.#products.get(handle) ?? null;
  }

  productById(id: number): ProductDrop | null {
    const data = this.model.productsById.get(id);
    return data ? this.product(data.handle) : null;
  }

  variant(id: number): VariantDrop | null {
    const entry = this.model.variantsById.get(id);
    if (!entry) return null;
    return this.product(entry.product.handle)?.variants.find((v) => v.id === id) ?? null;
  }

  allProducts(): ProductDrop[] {
    return this.model.products.map((p) => this.product(p.handle)).filter((p): p is ProductDrop => p !== null);
  }

  collectionsData(): CollectionData[] {
    return this.model.collections;
  }

  collection(handle: string): CollectionDrop | null {
    if (!this.#collections.has(handle)) {
      const data = this.model.collectionsByHandle.get(handle);
      this.#collections.set(handle, data ? new CollectionDrop(data, this) : null);
    }
    return this.#collections.get(handle) ?? null;
  }

  page(handle: string): PageDrop | null {
    const data = this.model.pagesByHandle.get(handle);
    return data ? new PageDrop(data) : null;
  }

  blog(handle: string): BlogDrop | null {
    const data = this.model.blogs.get(handle);
    return data ? new BlogDrop(data) : null;
  }

  article(blogHandle: string, handle: string): ArticleDrop | null {
    const blog = this.model.blogs.get(blogHandle);
    const article = blog?.articles.find((a) => a.handle === handle);
    return blog && article ? new ArticleDrop(article, blog) : null;
  }

  policy(handle: string): PolicyDrop | null {
    const data = this.model.policies.find((p) => p.handle === handle);
    return data ? new PolicyDrop(data) : null;
  }

  linklist(handle: string): LinklistDrop | null {
    if (!this.#linklists.has(handle)) {
      const menu = this.model.menus.get(handle);
      this.#linklists.set(
        handle,
        menu ? new LinklistDrop(menu.handle, menu.title, menu.links.map((l) => new LinkDrop(l, this))) : null,
      );
    }
    return this.#linklists.get(handle) ?? null;
  }

  metaobject(type: string, handle: string): MetaobjectDrop | null {
    const key = `${type}/${handle}`;
    if (!this.#metaobjects.has(key)) {
      const entry = this.model.metaobjects.get(type)?.find((e) => e.handle === handle);
      this.#metaobjects.set(
        key,
        entry ? new MetaobjectDrop(entry, this.model.metaobjectDefinitions.get(type), this) : null,
      );
    }
    return this.#metaobjects.get(key) ?? null;
  }

  metaobjectsOfType(type: string): MetaobjectDrop[] {
    return (this.model.metaobjects.get(type) ?? [])
      .map((e) => this.metaobject(type, e.handle))
      .filter((m): m is MetaobjectDrop => m !== null);
  }

  productImage(img: ImageData, product: ProductData): ImageDrop {
    const file = this.files.get(img.fileName);
    if (!file) {
      log.warnOnce(
        `missing-product-image:${img.fileName}`,
        `product image ${img.fileName} (${product.handle}) is missing from dev/fixtures/files – the CDN will 404`,
      );
    }
    return new ImageDrop({
      id: img.id,
      fileName: img.fileName,
      width: img.width || file?.width || 0,
      height: img.height || file?.height || 0,
      alt: img.alt ?? product.title,
      position: img.position,
      productId: product.id,
      variantIds: img.variantIds,
      present: Boolean(file),
    });
  }

  /** A shop file (`shopify://shop_images/x.png`, `x.png`, `products/x.jpg`) as an image drop. */
  fileImage(reference: string, alt = ''): ImageDrop | null {
    const name = reference.replace(/^shopify:\/\/shop_images\//, '').replace(/^\/+/, '');
    const file = this.files.get(name);
    if (!file) {
      log.warnOnce(
        `missing-file:${name}`,
        `shop file "${name}" not found in dev/fixtures/files – Liquid gets nil (add the file to preview it)`,
      );
      return null;
    }
    return new ImageDrop({
      id: stableId(`file:${file.relPath}`),
      fileName: file.name,
      width: file.width,
      height: file.height,
      alt,
      position: null,
      productId: null,
      variantIds: [],
      present: true,
    });
  }

  resolveToday(raw: unknown): unknown {
    return raw === '$today' ? this.today() : raw;
  }

  /** Metafield/metaobject field value conversion by Shopify field type. */
  convertMetafieldValue(type: string, raw: unknown, label: string): unknown {
    const value = this.resolveToday(raw);
    if (type.startsWith('list.')) {
      const inner = type.slice(5);
      const items = Array.isArray(value) ? value : [value];
      return items
        .map((item) => this.convertMetafieldValue(inner, item, label))
        .filter((x) => x !== null && x !== undefined);
    }
    switch (type) {
      case 'single_line_text_field':
      case 'multi_line_text_field':
      case 'url':
      case 'rich_text_field':
        return typeof value === 'string' ? value : JSON.stringify(value);
      case 'color':
        return ColorDrop.from(value);
      case 'number_integer':
        return Math.trunc(Number(value));
      case 'number_decimal':
        return new LiquidFloat(Number(value));
      case 'boolean':
        return value === true || value === 'true';
      case 'date':
        return typeof value === 'string' ? value.slice(0, 10) : null;
      case 'date_time': {
        const d = new Date(String(value));
        return Number.isNaN(d.getTime()) ? null : new LiquidTime(d, this.timezone);
      }
      case 'json':
        return value;
      case 'file_reference':
        return typeof value === 'string' ? this.fileImage(value) : null;
      case 'product_reference': {
        const p = typeof value === 'string' ? this.product(value) : null;
        if (!p) log.warnOnce(`ref:${label}:${String(value)}`, `${label}: product "${String(value)}" not found`);
        return p;
      }
      case 'collection_reference':
        return typeof value === 'string' ? this.collection(value) : null;
      case 'page_reference':
        return typeof value === 'string' ? this.page(value) : null;
      case 'variant_reference':
        return this.variant(Number(value));
      case 'metaobject_reference': {
        const ref = String(value);
        const slash = ref.indexOf('/');
        const mo = slash > 0 ? this.metaobject(ref.slice(0, slash), ref.slice(slash + 1)) : null;
        if (!mo) log.warnOnce(`ref:${label}:${ref}`, `${label}: metaobject "${ref}" not found`);
        return mo;
      }
      default:
        log.warnOnce(`mf-type:${type}`, `metafield type "${type}" (${label}) is passed through unconverted`);
        return value;
    }
  }

  // ---- map-like globals
  allProductsDrop(): LookupDrop<ProductDrop> {
    return new LookupDrop((h) => this.product(h), () => this.allProducts());
  }

  collectionsDrop(): LookupDrop<CollectionDrop> {
    return new LookupDrop(
      (h) => this.collection(h),
      () =>
        this.model.collections
          .map((c) => this.collection(c.handle))
          .filter((c): c is CollectionDrop => c !== null)
          .sort((a, b) => a.title.localeCompare(b.title, 'en')),
    );
  }

  pagesDrop(): LookupDrop<PageDrop> {
    return new LookupDrop(
      (h) => this.page(h),
      () => this.model.pages.map((p) => new PageDrop(p)),
    );
  }

  blogsDrop(): LookupDrop<BlogDrop> {
    return new LookupDrop(
      (h) => this.blog(h),
      () => [...this.model.blogs.values()].map((b) => new BlogDrop(b)),
    );
  }

  linklistsDrop(): LookupDrop<LinklistDrop> {
    return new LookupDrop(
      (h) => this.linklist(h),
      () =>
        [...this.model.menus.keys()].map((h) => this.linklist(h)).filter((l): l is LinklistDrop => l !== null),
    );
  }

  metaobjectsDrop(): MetaobjectsDrop {
    return new MetaobjectsDrop(this);
  }
}

// ---------------------------------------------------------------------------------------
// shop, template

export class ShopDrop extends BaseDrop {
  #view: StoreView;

  constructor(view: StoreView) {
    super();
    this.#view = view;
  }

  get #s(): StoreModel['shop'] {
    return this.#view.model.shop;
  }

  get id(): number {
    return this.#s.id;
  }

  get name(): string {
    return this.#s.name;
  }

  get url(): string {
    return this.#s.url;
  }

  get secure_url(): string {
    return this.#s.url.replace(/^http:/, 'https:');
  }

  get domain(): string {
    return this.#s.domain;
  }

  get permanent_domain(): string {
    return this.#s.myshopifyDomain;
  }

  get currency(): string {
    return this.#s.currency;
  }

  get money_format(): string {
    return this.#s.moneyFormat;
  }

  get money_with_currency_format(): string {
    return this.#s.moneyWithCurrencyFormat;
  }

  get email(): string | null {
    return this.#s.email;
  }

  get phone(): string | null {
    return this.#s.phone;
  }

  get description(): string {
    return this.#s.description;
  }

  get password_message(): string {
    return this.#s.passwordMessage;
  }

  get locale(): string {
    return 'en';
  }

  get timezone(): string {
    return this.#s.timezone;
  }

  get policies(): PolicyDrop[] {
    return this.#view.model.policies.map((p) => new PolicyDrop(p));
  }

  get privacy_policy(): PolicyDrop | null {
    return this.#view.policy('privacy-policy');
  }

  get refund_policy(): PolicyDrop | null {
    return this.#view.policy('refund-policy');
  }

  get shipping_policy(): PolicyDrop | null {
    return this.#view.policy('shipping-policy');
  }

  get terms_of_service(): PolicyDrop | null {
    return this.#view.policy('terms-of-service');
  }

  get subscription_policy(): PolicyDrop | null {
    return this.#view.policy('subscription-policy');
  }

  get address(): Record<string, unknown> {
    const s = this.#s;
    const country = s.country === 'IN' ? 'India' : s.country;
    return {
      address1: null,
      address2: null,
      city: s.city,
      province: s.province,
      province_code: s.province === 'Karnataka' ? 'KA' : null,
      zip: null,
      country,
      country_code: s.country,
      company: null,
      summary: [s.city, s.province, country].filter(Boolean).join(', '),
    };
  }

  get products_count(): number {
    return this.#view.model.products.length;
  }

  get collections_count(): number {
    return this.#view.model.collections.length;
  }

  get types(): string[] {
    return [...new Set(this.#view.model.products.map((p) => p.productType))].filter(Boolean).sort();
  }

  get vendors(): string[] {
    return [...new Set(this.#view.model.products.map((p) => p.vendor))].filter(Boolean).sort();
  }

  get metafields(): MetafieldsDrop {
    return new MetafieldsDrop(new Map());
  }

  get brand(): null {
    return null;
  }

  get customer_accounts_enabled(): boolean {
    return true;
  }

  get customer_accounts_optional(): boolean {
    return true;
  }

  get accepts_gift_cards(): boolean {
    return false;
  }

  get enabled_payment_types(): never[] {
    return [];
  }

  get enabled_currencies(): Array<Record<string, string>> {
    return [{ iso_code: 'INR', name: 'Indian Rupee', symbol: '₹' }];
  }

  get published_locales(): Array<Record<string, unknown>> {
    return [{ iso_code: 'en', name: 'English', endonym_name: 'English', primary: true, root_url: '/' }];
  }

  get taxes_included(): boolean {
    return true;
  }

  override toString(): string {
    return 'ShopDrop';
  }

  override identity(): unknown {
    return 'shop';
  }
}

export class TemplateDrop extends BaseDrop {
  readonly name: string;
  readonly suffix: string | null;
  readonly directory: string | null;

  constructor(name: string, suffix: string | null, directory: string | null = null) {
    super();
    this.name = name;
    this.suffix = suffix;
    this.directory = directory;
  }

  override toString(): string {
    const base = this.directory ? `${this.directory}/${this.name}` : this.name;
    return this.suffix ? `${base}.${this.suffix}` : base;
  }

  override toJSON(): unknown {
    return this.toString();
  }
}
