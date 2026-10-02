// Renders pages the way Shopify does: JSON template → sections (wrapped) → layout.
// Also renders single sections for the Section Rendering API.
import type { Liquid, Template } from 'liquidjs';
import { createLiquid, describeError, errorBoxHtml, reportError } from './engine.ts';
import { registerFilters } from './filters.ts';
import { registerTags } from './tags.ts';
import type { Theme, SectionInstance } from './theme.ts';
import { STATE, type FlashForm, type RenderState, type RequestInfo } from './state.ts';
import { ShopDrop, StoreView, TemplateDrop } from './drops.ts';
import type { FileIndex } from './files.ts';
import type { StoreModel } from './store-data.ts';
import { CartDrop, type CartState } from './cart.ts';
import { buildSection, resolveSettings } from './settings.ts';
import { escapeHtml, stableId } from './util.ts';

export interface Route {
  /** template name: index, product, collection, page, blog, article, search, cart, 404, list-collections */
  template: string;
  suffix: string | null;
  pageType: string;
  status: number;
  /** Page objects (product, collection, page, search…) built from this request's store view. */
  objects: (view: StoreView) => Record<string, unknown>;
  title: string;
  description?: string;
  handle?: string;
  pageCollection?: string | null;
  /** Already-rendered content_for_layout (policy pages) */
  content?: string;
}

export interface RenderResult {
  html: string;
  status: number;
  errors: number;
}

const groupId = (name: string) => `sections--${stableId(`group:${name}`, 14)}`;
const templateId = (name: string) => `template--${stableId(`template:${name}`, 14)}`;

export class Renderer {
  readonly theme: Theme;
  #getModel: () => StoreModel;
  #files: FileIndex;
  #liquid: Liquid | null = null;
  #liquidVersion = -1;
  #parsed = new Map<string, { mtime: number; templates: Template[] }>();
  liveReload = true;

  constructor(theme: Theme, getModel: () => StoreModel, files: FileIndex) {
    this.theme = theme;
    this.#getModel = getModel;
    this.#files = files;
  }

  get liquid(): Liquid {
    if (!this.#liquid || this.#liquidVersion !== this.theme.version) {
      const liquid = createLiquid({ partials: [this.theme.path('snippets')], cache: true });
      registerFilters(liquid);
      registerTags(liquid);
      this.#liquid = liquid;
      this.#liquidVersion = this.theme.version;
      this.#parsed.clear();
    }
    return this.#liquid;
  }

  #parse(key: string, source: () => string, file: string): Template[] {
    const mtime = this.theme.mtime(file);
    const hit = this.#parsed.get(key);
    if (hit && hit.mtime === mtime) return hit.templates;
    const templates = this.liquid.parse(source(), this.theme.path(file));
    this.#parsed.set(key, { mtime, templates });
    return templates;
  }

  /* ------------------------------------------------------------ context */

  #state(request: RequestInfo, route: Route, cart: CartState, flash: FlashForm | null): { state: RenderState; globals: Record<string | symbol, unknown> } {
    const model = this.#getModel();
    const view = new StoreView({ model, files: this.#files, now: request.now, path: request.path, query: request.query, pageCollection: route.pageCollection ?? null });
    const objects = route.objects(view);
    const state: RenderState = {
      theme: this.theme,
      view,
      request,
      pageType: route.pageType,
      errors: [],
      layoutOverride: undefined,
      flash,
      section: null,
      pageObjects: objects,
      sectionDepth: 0,
      renderStaticSection: (name, st) => this.#renderStatic(name, st, globals),
      renderSectionGroup: (name, st) => this.#renderGroup(name, st, globals),
    };
    const settings = resolveSettings(this.theme.globalSettingSchemas(), this.theme.globalSettingsRaw(), view);
    const shopUrl = model.shop.url;
    const canonicalPath = request.path === '/' ? '' : request.path;
    const globals: Record<string | symbol, unknown> = {
      [STATE]: state,
      shop: new ShopDrop(view),
      settings,
      request: {
        design_mode: request.designMode,
        visual_preview_mode: false,
        page_type: route.pageType,
        path: request.path,
        host: request.host,
        origin: request.origin,
        locale: { iso_code: 'en', primary: true, name: 'English', root_url: '/' },
      },
      routes: {
        root_url: '/',
        account_url: '/account',
        account_login_url: '/account/login',
        account_logout_url: '/account/logout',
        account_register_url: '/account/register',
        account_addresses_url: '/account/addresses',
        account_recover_url: '/account/recover',
        collections_url: '/collections',
        all_products_collection_url: '/collections/all',
        search_url: '/search',
        predictive_search_url: '/search/suggest',
        cart_url: '/cart',
        cart_add_url: '/cart/add',
        cart_change_url: '/cart/change',
        cart_clear_url: '/cart/clear',
        cart_update_url: '/cart/update',
        product_recommendations_url: '/recommendations/products',
        storefront_login_url: '/storefront/login',
      },
      cart: new CartDrop(cart, view),
      collections: view.collectionsDrop(),
      all_products: view.allProductsDrop(),
      linklists: view.linklistsDrop(),
      pages: view.pagesDrop(),
      blogs: view.blogsDrop(),
      metaobjects: view.metaobjectsDrop(),
      localization: {
        country: { iso_code: 'IN', name: 'India', currency: { iso_code: 'INR', symbol: '₹', name: 'Indian Rupee' } },
        language: { iso_code: 'en', name: 'English', endonym_name: 'English', primary: true, root_url: '/' },
        available_countries: [{ iso_code: 'IN', name: 'India', currency: { iso_code: 'INR', symbol: '₹' } }],
        available_languages: [{ iso_code: 'en', name: 'English', endonym_name: 'English', primary: true }],
      },
      template: new TemplateDrop(route.template === 'policy' ? 'page' : route.template, route.suffix),
      canonical_url: `${shopUrl}${canonicalPath}`,
      page_title: route.title,
      page_description: route.description ?? null,
      handle: route.handle ?? null,
      customer: null,
      current_tags: null,
      current_page: 1,
      powered_by_link: '<a target="_blank" rel="nofollow" href="https://www.shopify.com">Powered by Shopify</a>',
      additional_checkout_buttons: false,
      content_for_additional_checkout_buttons: '',
      content_for_header: this.#contentForHeader(request, model),
      ...objects,
    };
    return { state, globals };
  }

  #contentForHeader(request: RequestInfo, model: StoreModel): string {
    const shopify = {
      shop: model.shop.myshopifyDomain,
      locale: 'en',
      currency: { active: 'INR', rate: '1.0' },
      country: 'IN',
      theme: { name: 'Kuki (local)', id: 1, role: 'development', schema_name: 'Kuki' },
      routes: { root: '/' },
      designMode: request.designMode,
      ...(request.nowOverride ? { devNow: request.nowOverride } : {}),
    };
    return (
      '<meta name="shopify-local-emulator" content="1">' +
      `<script>window.Shopify=Object.assign(window.Shopify||{},${JSON.stringify(shopify).replace(/</g, '\\u003c')});` +
      'window.__kukiAnalytics=window.__kukiAnalytics||[];' +
      'Shopify.analytics={publish:function(n,d){var e={name:n,data:d,at:Date.now()};window.__kukiAnalytics.push(e);' +
      "window.dispatchEvent(new CustomEvent('kuki:dev-analytics',{detail:e}));}};</script>"
    );
  }

  /* ------------------------------------------------------------ sections */

  #renderSection(
    state: RenderState,
    globals: Record<string | symbol, unknown>,
    id: string,
    type: string,
    instance: SectionInstance | null,
    location: string,
    index: number | null,
    extraClass = '',
  ): string {
    let inner: string;
    let tag = 'div';
    let cls = '';
    const previous = state.section;
    try {
      if (state.sectionDepth > 4) throw new Error(`section "${type}" nests too deep`);
      state.sectionDepth += 1;
      const schema = this.theme.schema(type);
      tag = schema.tag ?? 'div';
      cls = schema.class ? ` ${schema.class}` : '';
      const section = buildSection(id, type, instance, schema, state.view, { index, location, designMode: state.request.designMode });
      state.section = { id, type };
      const templates = this.#parse(`section:${type}`, () => this.theme.sectionBody(type), `sections/${type}.liquid`);
      inner = this.liquid.renderSync(templates, { section }, { globals });
    } catch (err) {
      const record = describeError(err);
      if (!record.file) record.text = record.text.replace('(line', `(sections/${type}.liquid line`);
      reportError(undefined, record);
      state.errors.push(record);
      inner = errorBoxHtml(record);
    } finally {
      state.sectionDepth -= 1;
      state.section = previous;
    }
    return `<${tag} id="shopify-section-${escapeHtml(id)}" class="shopify-section${extraClass}${cls}">${inner}</${tag}>`;
  }

  #renderStatic(name: string, state: RenderState, globals: Record<string | symbol, unknown>): string {
    const instance = this.theme.staticSectionData(name) ?? { type: name };
    return this.#renderSection(state, globals, name, name, instance, 'static', null);
  }

  #renderGroup(name: string, state: RenderState, globals: Record<string | symbol, unknown>): string {
    const group = this.theme.sectionGroup(name);
    if (!group) {
      const record = describeError(new Error(`section group "${name}" not found (sections/${name}.json)`));
      state.errors.push(record);
      return errorBoxHtml(record);
    }
    const prefix = groupId(name);
    return group.order
      .filter((key) => group.sections[key] && !group.sections[key]!.disabled)
      .map((key, i) => this.#renderSection(state, globals, `${prefix}__${key}`, group.sections[key]!.type, group.sections[key]!, name, i + 1, ` shopify-section-group-${name}`))
      .join('');
  }

  /* ------------------------------------------------------------ pages */

  renderPage(request: RequestInfo, route: Route, cart: CartState, flash: FlashForm | null): RenderResult {
    const { state, globals } = this.#state(request, route, cart, flash);
    let content = route.content ?? '';
    let layout: string | false = 'theme';
    if (route.content === undefined) {
      const found = this.theme.findTemplate(route.template, route.suffix);
      if (!found) {
        const record = describeError(new Error(`template "${route.template}" not found in templates/`));
        state.errors.push(record);
        content = errorBoxHtml(record);
      } else if (found.kind === 'json') {
        const tpl = this.theme.json<{ layout?: string | false; sections: Record<string, SectionInstance>; order: string[] }>(found.rel);
        if (tpl.layout !== undefined) layout = tpl.layout === false ? false : tpl.layout;
        const tname = found.rel.replace(/^templates\//, '').replace(/\.json$/, '');
        const prefix = templateId(tname);
        content = tpl.order
          .filter((key) => tpl.sections[key] && !tpl.sections[key]!.disabled)
          .map((key, i) => this.#renderSection(state, globals, `${prefix}__${key}`, tpl.sections[key]!.type, tpl.sections[key]!, 'template', i + 1))
          .join('');
      } else {
        try {
          const templates = this.#parse(`tpl:${found.rel}`, () => this.theme.read(found.rel), found.rel);
          content = this.liquid.renderSync(templates, {}, { globals });
        } catch (err) {
          const record = describeError(err);
          state.errors.push(record);
          content = errorBoxHtml(record);
        }
      }
    }
    if (state.currentPage) globals.current_page = state.currentPage;
    if (state.layoutOverride !== undefined) layout = state.layoutOverride;
    let html = content;
    if (layout !== false) {
      const rel = `layout/${layout}.liquid`;
      try {
        const templates = this.#parse(`layout:${layout}`, () => this.theme.read(rel), rel);
        globals.content_for_layout = content;
        html = this.liquid.renderSync(templates, {}, { globals });
      } catch (err) {
        const record = describeError(err);
        state.errors.push(record);
        html = errorBoxHtml(record) + content;
      }
    }
    if (this.liveReload) html = html.replace(/<\/body>/i, `${LIVE_RELOAD}</body>`);
    return { html, status: route.status, errors: state.errors.length };
  }

  /**
   * Section Rendering API: ids are static section names, group section ids or template
   * section ids as they appear on the page for `route`.
   */
  renderSectionsById(ids: string[], request: RequestInfo, route: Route, cart: CartState): Record<string, string | null> {
    const { state, globals } = this.#state(request, route, cart, null);
    const out: Record<string, string | null> = {};
    const found = route.content === undefined ? this.theme.findTemplate(route.template, route.suffix) : null;
    const tpl = found?.kind === 'json' ? this.theme.json<{ sections: Record<string, SectionInstance>; order: string[] }>(found.rel) : null;
    const tprefix = found ? templateId(found.rel.replace(/^templates\//, '').replace(/\.json$/, '')) : '';
    for (const id of ids) {
      if (tpl && id.startsWith(`${tprefix}__`)) {
        const key = id.slice(tprefix.length + 2);
        const inst = tpl.sections[key];
        out[id] = inst ? this.#renderSection(state, globals, id, inst.type, inst, 'template', tpl.order.indexOf(key) + 1) : null;
        continue;
      }
      const gm = /^sections--(\d+)__(.+)$/.exec(id);
      if (gm) {
        let rendered: string | null = null;
        for (const file of this.theme.list('sections')) {
          if (!file.endsWith('.json')) continue;
          const name = file.replace(/\.json$/, '');
          if (groupId(name) !== `sections--${gm[1]}`) continue;
          const group = this.theme.sectionGroup(name);
          const inst = group?.sections[gm[2]!];
          if (inst) rendered = this.#renderSection(state, globals, id, inst.type, inst, name, group!.order.indexOf(gm[2]!) + 1, ` shopify-section-group-${name}`);
        }
        out[id] = rendered;
        continue;
      }
      out[id] = this.theme.exists(`sections/${id}.liquid`) ? this.#renderStatic(id, state, globals) : null;
    }
    return out;
  }
}

const LIVE_RELOAD =
  '<script>(function(){if(!window.EventSource)return;var s=new EventSource("/__livereload");' +
  's.onmessage=function(e){if(e.data==="reload")location.reload();};})();</script>';
