// Cart state per session, Shopify AJAX Cart API semantics, cart.js JSON and the `cart` drop.
import { randomBytes } from 'node:crypto';
import { BaseDrop } from './drop-base.ts';
import { ImageDrop, ProductDrop, StoreView, VariantDrop, isDefaultVariant } from './drops.ts';
import type { ProductData, VariantData } from './store-data.ts';
import { isPlainObject, md5 } from './util.ts';

export interface CartLineState {
  key: string;
  variantId: number;
  quantity: number;
  properties: Record<string, string>;
}

export interface CartState {
  token: string;
  note: string | null;
  attributes: Record<string, string>;
  lines: CartLineState[];
  createdAt: number;
  updatedAt: number;
}

/** Shopify's cart cookie is `cart`; carts are kept two weeks. */
export const CART_COOKIE = 'cart';

export function newCartToken(): string {
  return `kuki-${randomBytes(12).toString('hex')}`;
}

export function emptyCart(token: string): CartState {
  const now = Date.now();
  return { token, note: null, attributes: {}, lines: [], createdAt: now, updatedAt: now };
}

export class CartError extends Error {
  readonly status: number;
  readonly description: string;
  readonly title: string;

  constructor(status: number, description: string, title = 'Cart Error') {
    super(description);
    this.status = status;
    this.description = description;
    this.title = title;
  }

  toJSON(): Record<string, unknown> {
    return { status: this.status, message: this.title, description: this.description };
  }
}

/** Shopify drops properties with blank values. */
export function cleanProperties(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.trim() === '') continue;
    out[k] = s;
  }
  return out;
}

export function lineKey(variantId: number, properties: Record<string, string>): string {
  const canonical = JSON.stringify(Object.keys(properties).sort().map((k) => [k, properties[k]]));
  return `${variantId}:${md5(canonical)}`;
}

function parseQuantity(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new CartError(422, 'Quantity must be a number', 'Cart Error');
  return Math.trunc(n);
}

export interface AddItemInput {
  id: unknown;
  quantity?: unknown;
  properties?: unknown;
  selling_plan?: unknown;
}

function lineTitle(product: ProductData, variant: VariantData): string {
  return isDefaultVariant(product) ? product.title : `${product.title} - ${variant.title}`;
}

function resolveVariant(view: StoreView, rawId: unknown): { product: ProductData; variant: VariantData } {
  const id = Number(rawId);
  const entry = Number.isFinite(id) ? view.model.variantsById.get(id) : undefined;
  if (!entry) throw new CartError(404, 'Cannot find variant');
  return entry;
}

/** /cart/add: validates every item first (all-or-nothing), merges identical lines. */
export function addItems(cart: CartState, items: AddItemInput[], view: StoreView): string[] {
  if (!items.length) {
    throw new CartError(400, 'Required parameter missing or invalid: items', 'Parameter Missing or Invalid');
  }
  const prepared = items.map((item) => {
    if (item.id === undefined || item.id === null || item.id === '') {
      throw new CartError(400, 'Required parameter missing or invalid: items', 'Parameter Missing or Invalid');
    }
    const { product, variant } = resolveVariant(view, item.id);
    const quantity = parseQuantity(item.quantity, 1);
    if (quantity < 1) throw new CartError(422, 'Quantity must be at least 1');
    if (item.selling_plan !== undefined && item.selling_plan !== null && item.selling_plan !== '') {
      throw new CartError(422, 'Selling plans are not available for this product');
    }
    if (!variant.available) {
      throw new CartError(422, `The product '${lineTitle(product, variant)}' is already sold out.`);
    }
    const properties = cleanProperties(item.properties);
    return { variant, quantity, properties, key: lineKey(variant.id, properties) };
  });
  const keys: string[] = [];
  for (const p of prepared) {
    const existing = cart.lines.find((l) => l.key === p.key);
    if (existing) existing.quantity += p.quantity;
    else cart.lines.unshift({ key: p.key, variantId: p.variant.id, quantity: p.quantity, properties: p.properties });
    if (!keys.includes(p.key)) keys.push(p.key);
  }
  cart.updatedAt = Date.now();
  return keys;
}

function findLineIndex(cart: CartState, id: unknown, line: unknown): number {
  if (line !== undefined && line !== null && line !== '') {
    const n = Number(line);
    if (Number.isInteger(n) && n >= 1 && n <= cart.lines.length) return n - 1;
    return -1;
  }
  if (id === undefined || id === null || id === '') return -1;
  const s = String(id);
  if (s.includes(':')) return cart.lines.findIndex((l) => l.key === s);
  const variantId = Number(s);
  return cart.lines.findIndex((l) => l.variantId === variantId);
}

/** /cart/change */
export function changeLine(
  cart: CartState,
  input: { id?: unknown; line?: unknown; quantity?: unknown; properties?: unknown },
): void {
  const idx = findLineIndex(cart, input.id, input.line);
  if (idx === -1) throw new CartError(400, 'no valid id or line parameter', 'Cart Error');
  const current = cart.lines[idx] as CartLineState;
  const quantity = input.quantity === undefined ? current.quantity : parseQuantity(input.quantity, current.quantity);
  if (input.properties !== undefined) {
    current.properties = cleanProperties(input.properties);
    current.key = lineKey(current.variantId, current.properties);
    const dupIdx = cart.lines.findIndex((l, i) => i !== idx && l.key === current.key);
    if (dupIdx !== -1) {
      (cart.lines[dupIdx] as CartLineState).quantity += quantity;
      cart.lines.splice(idx, 1);
      cart.updatedAt = Date.now();
      return;
    }
  }
  if (quantity <= 0) cart.lines.splice(idx, 1);
  else current.quantity = quantity;
  cart.updatedAt = Date.now();
}

/** /cart/update: updates by key/variant id (unknown variant ids are added) or by line position. */
export function updateCart(
  cart: CartState,
  input: { updates?: unknown; note?: unknown; attributes?: unknown },
  view: StoreView,
): void {
  const { updates } = input;
  if (Array.isArray(updates)) {
    const quantities = updates.map((q) => parseQuantity(q, 0));
    const keep: CartLineState[] = [];
    cart.lines.forEach((line, i) => {
      const q = quantities[i];
      if (q === undefined) keep.push(line);
      else if (q > 0) keep.push({ ...line, quantity: q });
    });
    cart.lines = keep;
  } else if (isPlainObject(updates)) {
    for (const [rawKey, rawQty] of Object.entries(updates)) {
      const quantity = parseQuantity(rawQty, 0);
      const idx = rawKey.includes(':')
        ? cart.lines.findIndex((l) => l.key === rawKey)
        : cart.lines.findIndex((l) => l.variantId === Number(rawKey));
      if (idx === -1) {
        if (rawKey.includes(':')) throw new CartError(400, 'no valid id or line parameter', 'Cart Error');
        if (quantity > 0) addItems(cart, [{ id: rawKey, quantity }], view);
        continue;
      }
      if (quantity <= 0) cart.lines.splice(idx, 1);
      else (cart.lines[idx] as CartLineState).quantity = quantity;
    }
  }
  if (input.note !== undefined) cart.note = input.note === null ? null : String(input.note);
  if (isPlainObject(input.attributes)) {
    for (const [k, v] of Object.entries(input.attributes)) {
      if (v === null || v === undefined || String(v) === '') delete cart.attributes[k];
      else cart.attributes[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
  cart.updatedAt = Date.now();
}

export function clearCart(cart: CartState): void {
  cart.lines = [];
  cart.updatedAt = Date.now();
}

/** Replace the cart with `variantId:qty` pairs (cart permalinks). */
export function replaceWithPermalink(cart: CartState, spec: string, view: StoreView): void {
  const items: AddItemInput[] = [];
  for (const part of spec.split(',')) {
    const [id, qty] = part.split(':');
    if (!id) continue;
    items.push({ id, quantity: qty ?? 1 });
  }
  const next = emptyCart(cart.token);
  addItems(next, items, view);
  // permalink order follows the URL
  next.lines.reverse();
  cart.lines = next.lines;
  cart.updatedAt = Date.now();
}

// ---- computed lines ---------------------------------------------------------------------

export interface ComputedLine {
  state: CartLineState;
  product: ProductData;
  variant: VariantData;
  productDrop: ProductDrop;
  variantDrop: VariantDrop;
  image: ImageDrop | null;
  linePrice: number;
}

export function computeLines(cart: CartState, view: StoreView): ComputedLine[] {
  const out: ComputedLine[] = [];
  for (const state of cart.lines) {
    const entry = view.model.variantsById.get(state.variantId);
    if (!entry) continue; // variant vanished from the snapshot
    const productDrop = view.product(entry.product.handle);
    const variantDrop = view.variant(state.variantId);
    if (!productDrop || !variantDrop) continue;
    out.push({
      state,
      product: entry.product,
      variant: entry.variant,
      productDrop,
      variantDrop,
      image: variantDrop.featured_image ?? productDrop.featured_image,
      linePrice: entry.variant.price * state.quantity,
    });
  }
  return out;
}

export function lineItemJson(line: ComputedLine): Record<string, unknown> {
  const { product, variant, state, image } = line;
  const isDefault = isDefaultVariant(product);
  const options = [variant.option1, variant.option2, variant.option3].filter((x): x is string => x !== null);
  return {
    id: variant.id,
    properties: { ...state.properties },
    quantity: state.quantity,
    variant_id: variant.id,
    key: state.key,
    title: lineTitle(product, variant),
    price: variant.price,
    original_price: variant.price,
    presentment_price: variant.price / 100,
    discounted_price: variant.price,
    line_price: line.linePrice,
    original_line_price: line.linePrice,
    total_discount: 0,
    discounts: [],
    sku: variant.sku,
    grams: variant.grams,
    vendor: product.vendor,
    taxable: variant.taxable,
    product_id: product.id,
    product_has_only_default_variant: isDefault,
    gift_card: false,
    final_price: variant.price,
    final_line_price: line.linePrice,
    url: `/products/${product.handle}?variant=${variant.id}`,
    featured_image: image
      ? {
          aspect_ratio: image.aspect_ratio?.value ?? null,
          alt: image.alt,
          height: image.height,
          url: image.src,
          width: image.width,
        }
      : null,
    image: image ? image.src : null,
    handle: product.handle,
    requires_shipping: variant.requiresShipping,
    product_type: product.productType,
    product_title: product.title,
    product_description: product.bodyHtml,
    variant_title: isDefault ? null : variant.title,
    variant_options: options,
    options_with_values: product.options.map((o, i) => ({ name: o.name, value: options[i] ?? null })),
    line_level_discount_allocations: [],
    line_level_total_discount: 0,
    has_components: false,
  };
}

export function cartTotals(lines: ComputedLine[]): { count: number; subtotal: number; weight: number; shipping: boolean } {
  let count = 0;
  let subtotal = 0;
  let weight = 0;
  let shipping = false;
  for (const l of lines) {
    count += l.state.quantity;
    subtotal += l.linePrice;
    weight += l.variant.grams * l.state.quantity;
    if (l.variant.requiresShipping) shipping = true;
  }
  return { count, subtotal, weight, shipping };
}

/** GET /cart.js */
export function cartJson(cart: CartState, view: StoreView): Record<string, unknown> {
  const lines = computeLines(cart, view);
  const t = cartTotals(lines);
  return {
    token: cart.token,
    note: cart.note,
    attributes: { ...cart.attributes },
    original_total_price: t.subtotal,
    total_price: t.subtotal,
    total_discount: 0,
    total_weight: t.weight,
    item_count: t.count,
    items: lines.map(lineItemJson),
    requires_shipping: t.shipping,
    currency: view.model.shop.currency,
    items_subtotal_price: t.subtotal,
    cart_level_discount_applications: [],
    discount_codes: [],
  };
}

// ---- Liquid drops -------------------------------------------------------------------------

export class LineItemDrop extends BaseDrop {
  #l: ComputedLine;

  constructor(line: ComputedLine) {
    super();
    this.#l = line;
  }

  get id(): number {
    return this.#l.variant.id;
  }

  get key(): string {
    return this.#l.state.key;
  }

  get quantity(): number {
    return this.#l.state.quantity;
  }

  get variant(): VariantDrop {
    return this.#l.variantDrop;
  }

  get variant_id(): number {
    return this.#l.variant.id;
  }

  get product(): ProductDrop {
    return this.#l.productDrop;
  }

  get product_id(): number {
    return this.#l.product.id;
  }

  get title(): string {
    return lineTitle(this.#l.product, this.#l.variant);
  }

  get price(): number {
    return this.#l.variant.price;
  }

  get original_price(): number {
    return this.#l.variant.price;
  }

  get final_price(): number {
    return this.#l.variant.price;
  }

  get line_price(): number {
    return this.#l.linePrice;
  }

  get original_line_price(): number {
    return this.#l.linePrice;
  }

  get final_line_price(): number {
    return this.#l.linePrice;
  }

  get total_discount(): number {
    return 0;
  }

  get line_level_total_discount(): number {
    return 0;
  }

  get discounts(): never[] {
    return [];
  }

  get discount_allocations(): never[] {
    return [];
  }

  get line_level_discount_allocations(): never[] {
    return [];
  }

  get properties(): Record<string, string> {
    return { ...this.#l.state.properties };
  }

  get url(): string {
    return `/products/${this.#l.product.handle}?variant=${this.#l.variant.id}`;
  }

  get url_to_remove(): string {
    return `/cart/change?id=${encodeURIComponent(this.#l.state.key)}&quantity=0`;
  }

  get image(): ImageDrop | null {
    return this.#l.image;
  }

  get sku(): string | null {
    return this.#l.variant.sku;
  }

  get vendor(): string {
    return this.#l.product.vendor;
  }

  get taxable(): boolean {
    return this.#l.variant.taxable;
  }

  get gift_card(): boolean {
    return false;
  }

  get requires_shipping(): boolean {
    return this.#l.variant.requiresShipping;
  }

  get options_with_values(): Array<{ name: string; value: string | null }> {
    const options = this.#l.variantDrop.options;
    return this.#l.product.options.map((o, i) => ({ name: o.name, value: options[i] ?? null }));
  }

  get unit_price(): null {
    return null;
  }

  get unit_price_measurement(): null {
    return null;
  }

  get selling_plan_allocation(): null {
    return null;
  }

  get 'has_components?'(): boolean {
    return false;
  }

  get item_components(): never[] {
    return [];
  }

  get fulfillment(): null {
    return null;
  }

  get message(): string {
    return '';
  }

  override toString(): string {
    return 'LineItemDrop';
  }

  override identity(): unknown {
    return `line:${this.#l.state.key}`;
  }

  override toJSON(): unknown {
    return lineItemJson(this.#l);
  }
}

export class CartDrop extends BaseDrop {
  #cart: CartState;
  #view: StoreView;
  #lines: ComputedLine[] | null = null;

  constructor(cart: CartState, view: StoreView) {
    super();
    this.#cart = cart;
    this.#view = view;
  }

  #computed(): ComputedLine[] {
    if (!this.#lines) this.#lines = computeLines(this.#cart, this.#view);
    return this.#lines;
  }

  get items(): LineItemDrop[] {
    return this.#computed().map((l) => new LineItemDrop(l));
  }

  get item_count(): number {
    return cartTotals(this.#computed()).count;
  }

  get items_subtotal_price(): number {
    return cartTotals(this.#computed()).subtotal;
  }

  get total_price(): number {
    return cartTotals(this.#computed()).subtotal;
  }

  get original_total_price(): number {
    return cartTotals(this.#computed()).subtotal;
  }

  get checkout_charge_amount(): number {
    return cartTotals(this.#computed()).subtotal;
  }

  get total_discount(): number {
    return 0;
  }

  get total_weight(): number {
    return cartTotals(this.#computed()).weight;
  }

  get note(): string | null {
    return this.#cart.note;
  }

  get attributes(): Record<string, string> {
    return { ...this.#cart.attributes };
  }

  get discount_applications(): never[] {
    return [];
  }

  get cart_level_discount_applications(): never[] {
    return [];
  }

  get currency(): Record<string, string> {
    return { iso_code: this.#view.model.shop.currency, name: 'Indian Rupee', symbol: '₹' };
  }

  get requires_shipping(): boolean {
    return cartTotals(this.#computed()).shipping;
  }

  /** The live store shows Dawn's "Taxes included." copy, i.e. prices include tax. */
  get taxes_included(): boolean {
    return true;
  }

  get duties_included(): boolean {
    return false;
  }

  get 'empty?'(): boolean {
    return this.#computed().length === 0;
  }

  get id(): string {
    return this.#cart.token;
  }

  override isBlankValue(): boolean {
    return this.#computed().length === 0;
  }

  override toString(): string {
    return 'CartDrop';
  }

  override identity(): unknown {
    return `cart:${this.#cart.token}`;
  }

  override toJSON(): unknown {
    return cartJson(this.#cart, this.#view);
  }
}
