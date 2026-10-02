/**
 * Shopify AJAX Cart API client. Every mutation asks Shopify to re-render the paper bag
 * (bundled Section Rendering), so the bag's numbers always come from Liquid, never from JS.
 * Mutations run one at a time so fast double-taps can't race each other.
 */

export const BAG_SECTION = 'paper-bag';

export interface AddItem {
  id: number;
  quantity: number;
  properties?: Record<string, string>;
}

export class CartError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface CartResponse {
  sections?: Record<string, string | null>;
  [key: string]: unknown;
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function route(key: 'cartAdd' | 'cartChange' | 'cartUpdate', fallback: string): string {
  return `${window.KUKI?.routes?.[key] ?? fallback}.js`;
}

async function post(url: string, body: Record<string, unknown>): Promise<CartResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  let json: any = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new CartError(json.description || json.message || res.statusText || 'Cart error', res.status);
  return json as CartResponse;
}

const withSections = (body: Record<string, unknown>) => ({
  ...body,
  sections: BAG_SECTION,
  sections_url: location.pathname,
});

export function addItems(items: AddItem[]): Promise<CartResponse> {
  return enqueue(() => post(route('cartAdd', '/cart/add'), withSections({ items })));
}

export function changeLine(key: string, quantity: number): Promise<CartResponse> {
  return enqueue(() => post(route('cartChange', '/cart/change'), withSections({ id: key, quantity: Math.max(0, quantity) })));
}

export function updateNote(note: string): Promise<CartResponse> {
  return enqueue(() => post(route('cartUpdate', '/cart/update'), { note }));
}
