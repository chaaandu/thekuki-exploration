// Shopify-specific tags for LiquidJS.
import { Tag, TagToken, Value, toValue, type Context, type Emitter, type Liquid, type Template, type TopLevelToken } from 'liquidjs';
import { FormDrop } from './forms.ts';
import { toStoredValue } from './engine.ts';
import { getState } from './state.ts';
import { escapeHtml } from './util.ts';

type ParserLike = {
  parseStream(tokens: TopLevelToken[]): {
    on(name: string, cb: (arg: any) => void): any;
    start(): void;
    stop(): void;
  };
};

/** Split a tag's argument string on top-level commas (quotes respected). */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of args) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function blockUntil(tag: Tag, parser: ParserLike, remainTokens: TopLevelToken[], endName: string, token: TagToken): Template[] {
  const templates: Template[] = [];
  const stream = parser
    .parseStream(remainTokens)
    .on(`tag:${endName}`, () => stream.stop())
    .on('template', (tpl: Template) => templates.push(tpl))
    .on('end', () => {
      throw new Error(`tag ${token.getText()} not closed`);
    });
  stream.start();
  void tag;
  return templates;
}

/** Tags whose body is not Liquid (schema, doc, stylesheet, javascript): swallow until the end tag. */
function rawBlock(endName: string) {
  return class extends Tag {
    constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
      super(token, remainTokens, liquid);
      while (remainTokens.length) {
        const t = remainTokens.shift()!;
        if (t instanceof TagToken && t.name === endName) return;
      }
      throw new Error(`tag ${token.getText()} not closed`);
    }
    *render(): Generator<unknown, void, unknown> {}
  };
}

/* ---------------- {% section 'name' %} / {% sections 'group' %} ---------------- */

class SectionTag extends Tag {
  #name: Value;
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid);
    this.#name = new Value(token.args, liquid);
  }
  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const name = String(toValue(yield this.#name.value(ctx, false)));
    const state = getState(ctx);
    emitter.write(state.renderStaticSection(name, state));
  }
}

class SectionsTag extends Tag {
  #name: Value;
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid);
    this.#name = new Value(token.args, liquid);
  }
  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const name = String(toValue(yield this.#name.value(ctx, false)));
    const state = getState(ctx);
    emitter.write(state.renderSectionGroup(name, state));
  }
}

/* ---------------- {% layout 'name' %} / {% layout none %} ---------------- */

class LayoutTag extends Tag {
  #value: Value | null;
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid);
    this.#value = token.args.trim() === 'none' ? null : new Value(token.args, liquid);
  }
  *render(ctx: Context): Generator<unknown, void, unknown> {
    const state = getState(ctx);
    state.layoutOverride = this.#value ? String(toValue(yield this.#value.value(ctx, false))) : false;
  }
}

/* ---------------- {% style %} ---------------- */

class StyleTag extends Tag {
  #templates: Template[];
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid, parser: ParserLike) {
    super(token, remainTokens, liquid);
    this.#templates = blockUntil(this, parser, remainTokens, 'endstyle', token);
  }
  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    emitter.write('<style data-shopify>');
    yield this.liquid.renderer.renderTemplates(this.#templates, ctx, emitter);
    emitter.write('</style>');
  }
}

/* ---------------- {% form 'type', object, attr: value %} ---------------- */

const FORM_ACTIONS: Record<string, string> = {
  product: '/cart/add',
  contact: '/contact',
  cart: '/cart',
  customer: '/contact',
  localization: '/localization',
  storefront_password: '/password',
};

class FormTag extends Tag {
  #type: Value;
  #object: Value | null = null;
  #attrs: [string, Value][] = [];
  #templates: Template[];

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid, parser: ParserLike) {
    super(token, remainTokens, liquid);
    const parts = splitArgs(token.args);
    if (!parts.length) throw new Error('form tag needs a form type');
    this.#type = new Value(parts[0]!, liquid);
    for (const part of parts.slice(1)) {
      const m = /^([A-Za-z_][\w-]*)\s*:\s*([\s\S]+)$/.exec(part);
      if (m) this.#attrs.push([m[1]!, new Value(m[2]!, liquid)]);
      else this.#object = new Value(part, liquid);
    }
    this.#templates = blockUntil(this, parser, remainTokens, 'endform', token);
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const state = getState(ctx);
    const type = String(toValue(yield this.#type.value(ctx, false)));
    const action = FORM_ACTIONS[type];
    if (!action) throw new Error(`form type "${type}" is not supported by the local emulator`);
    const attrs: Record<string, string> = {};
    for (const [k, v] of this.#attrs) {
      const val = toValue(yield v.value(ctx, false));
      if (val !== null && val !== undefined && val !== false) attrs[k] = String(val);
    }
    if (this.#object) yield this.#object.value(ctx, false);
    const returnTo = attrs.return_to;
    delete attrs.return_to;
    const id = attrs.id ?? (type === 'contact' ? 'contact_form' : null);
    const anchor = type === 'contact' || type === 'customer' ? `#${id ?? 'contact_form'}` : '';
    const html: string[] = [`<form method="post" action="${action}${anchor}"`];
    if (id) html.push(` id="${escapeHtml(id)}"`);
    html.push(' accept-charset="UTF-8"');
    for (const [k, v] of Object.entries(attrs)) if (k !== 'id') html.push(` ${k}="${escapeHtml(v)}"`);
    if (type === 'product') html.push(' enctype="multipart/form-data"');
    html.push(`><input type="hidden" name="form_type" value="${type}" /><input type="hidden" name="utf8" value="✓" />`);
    if (returnTo) html.push(`<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}" />`);
    emitter.write(html.join(''));

    const flash = state.flash && state.flash.formType === type ? state.flash : null;
    const posted = type === 'contact' && state.request.query.get('contact_posted') === 'true' && !flash?.errors;
    const form = new FormDrop({
      type,
      id,
      postedSuccessfully: posted || (flash !== null && Object.keys(flash.errors).length === 0),
      errors: flash && Object.keys(flash.errors).length ? flash.errors : null,
      values: flash?.values ?? {},
    });
    ctx.push({ form });
    yield this.liquid.renderer.renderTemplates(this.#templates, ctx, emitter);
    ctx.pop();
    emitter.write('</form>');
  }
}

/* ---------------- {% paginate collection.products by 12 %} ---------------- */

export interface PaginateInfo {
  current_page: number;
  current_offset: number;
  items: number;
  page_size: number;
  pages: number;
  previous: { title: string; url: string; is_link: boolean } | null;
  next: { title: string; url: string; is_link: boolean } | null;
  parts: { title: string; url: string; is_link: boolean }[];
}

class PaginateTag extends Tag {
  #path: string[];
  #by: Value;
  #templates: Template[];

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid, parser: ParserLike) {
    super(token, remainTokens, liquid);
    const m = /^\s*([\w.]+)\s+by\s+([^\s,]+)/.exec(token.args);
    if (!m) throw new Error(`paginate: expected "{% paginate collection.products by 12 %}", got "${token.args}"`);
    this.#path = m[1]!.split('.');
    this.#by = new Value(m[2]!, liquid);
    this.#templates = blockUntil(this, parser, remainTokens, 'endpaginate', token);
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const state = getState(ctx);
    const size = Math.max(1, Number(toValue(yield this.#by.value(ctx, false))) || 12);
    const [rootName, ...props] = this.#path;
    const root = toValue(yield new Value(rootName!, this.liquid).value(ctx, false)) as object | null;
    let parent: any = root;
    for (const p of props.slice(0, -1)) parent = parent?.[p];
    const last = props[props.length - 1];
    const full = (last ? parent?.[last] : root) as unknown;
    const list: unknown[] = Array.isArray(full) ? full : full && typeof full === 'object' && Symbol.iterator in full ? [...(full as Iterable<unknown>)] : [];
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(pages, Math.max(1, Number(state.request.query.get('page') ?? 1) || 1));
    const slice = list.slice((current - 1) * size, current * size);
    const link = (n: number) => {
      const q = new URLSearchParams(state.request.query);
      q.set('page', String(n));
      return `${state.request.path}?${q.toString()}`;
    };
    const info: PaginateInfo = {
      current_page: current,
      current_offset: (current - 1) * size,
      items: list.length,
      page_size: size,
      pages,
      previous: current > 1 ? { title: '« Previous', url: link(current - 1), is_link: true } : null,
      next: current < pages ? { title: 'Next »', url: link(current + 1), is_link: true } : null,
      parts: Array.from({ length: pages }, (_, i) => ({ title: String(i + 1), url: link(i + 1), is_link: i + 1 !== current })),
    };
    // Inside the block the paginated expression yields only the current page.
    let scope: Record<string, unknown>;
    if (!last) scope = { [rootName!]: slice };
    else {
      const override = (target: object, prop: string): object =>
        new Proxy(target, {
          get(t, key) {
            if (key === prop) return slice;
            return Reflect.get(t, key, t);
          },
          has(t, key) {
            return key === prop || Reflect.has(t, key);
          },
        });
      if (props.length === 1) scope = { [rootName!]: override(root as object, last) };
      else throw new Error('paginate: only one level of nesting is supported (e.g. collection.products)');
    }
    ctx.push({ ...scope, paginate: info });
    state.currentPage = current;
    yield this.liquid.renderer.renderTemplates(this.#templates, ctx, emitter);
    ctx.pop();
  }
}

/* ---------------- {% assign %} with Shopify storage semantics ---------------- */

// Shopify stores `blank`/`empty` as '' and `nil` as nil when assigned (LiquidJS keeps the literal object).
class AssignTag extends Tag {
  #key: string;
  #value: Value;
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid);
    const m = /^\s*([\w-]+)\s*=\s*([\s\S]+)$/.exec(token.args);
    if (!m) throw new Error(`illegal assign: ${token.getText()}`);
    this.#key = m[1]!;
    this.#value = new Value(m[2]!, liquid);
  }
  *render(ctx: Context): Generator<unknown, void, unknown> {
    const v = yield this.#value.value(ctx, this.liquid.options.lenientIf);
    ctx.bottom()[this.#key] = toStoredValue(v);
  }
}

class ContentForTag extends Tag {
  *render(): Generator<unknown, void, unknown> {
    throw new Error('{% content_for %} (theme blocks) is not supported by the local emulator');
  }
}

export function registerTags(liquid: Liquid): void {
  liquid.registerTag('section', SectionTag as never);
  liquid.registerTag('sections', SectionsTag as never);
  liquid.registerTag('layout', LayoutTag as never);
  liquid.registerTag('style', StyleTag as never);
  liquid.registerTag('form', FormTag as never);
  liquid.registerTag('paginate', PaginateTag as never);
  liquid.registerTag('schema', rawBlock('endschema') as never);
  liquid.registerTag('doc', rawBlock('enddoc') as never);
  liquid.registerTag('stylesheet', rawBlock('endstylesheet') as never);
  liquid.registerTag('javascript', rawBlock('endjavascript') as never);
  liquid.registerTag('content_for', ContentForTag as never);
  liquid.registerTag('assign', AssignTag as never);
}
