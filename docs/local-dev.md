# Local development (no Shopify connection needed)

The store isn't connected yet, so the theme runs on a **local Shopify emulator** that renders
`theme/` with real Liquid and the live store's data.

```bash
npm install
npm run dev        # Vite (src/ → theme/assets) + emulator on http://127.0.0.1:9292, live reload
npm run serve      # emulator only (after `npm run build`)
npm test           # Playwright: ordering end to end, no-JS paths, every live URL (phone + desktop)
npm run shots -- --phase=x [--pages=home,product] [--daypart=chai] [--full]
npm run check      # typecheck + "no hardcoded copy" lint + shopify theme check
```

## Where the data comes from (same layering as the real store will have)

1. `store/snapshot/` — the live store as of 2026-10-02, taken from the public storefront
   (products, prices, variants, descriptions, menus, the privacy policy, shop settings).
2. `store/setup/` — what `scripts/store-setup.ts` will create on the real store when it's
   connected: metaobject definitions (`flavour_story`, `todays_trays`), the seed entries
   (only known facts; blanks stay blank), the new pages and menus, the Rose Gulkand size fix.
3. `dev/fixtures/` — local-only extras: product photos (downloaded from the live CDN), the
   logo, and a sample "Today's trays" entry dated today (never sent to the store).

## What's emulated

- JSON templates, sections, section groups, static sections, blocks, schema defaults, theme
  settings, `render`, `form` (product, contact, cart), `paginate`, `style`, `layout`, locales
  (`t` with interpolation + plurals), Shopify money/image/asset/date/maths filters.
- AJAX Cart API (`/cart/add|change|update|clear(.js)`, `/cart.js`) with bundled Section
  Rendering, the Section Rendering API (`?sections=`, `?section_id=`), no-JS cart forms,
  cart permalinks, the contact form (with errors), policies, `/account` → new customer
  accounts, an image CDN (resizing + WebP/AVIF), and a **mock checkout** at `/checkout` with a
  "Place test order" button (orders are saved to `dev/.data/orders.json`).
- `Shopify.analytics.publish` is stubbed: events land in `window.__kukiAnalytics`.

## Preview helpers (also safe on the real store)

- `?daypart=morning|day|chai|evening|night` — preview the shelf's light at any time of day.
- `?now=2026-10-02T17:30:00+05:30` — set the clock (dates, Today's trays, offers, dayparts).
- `?design_mode=1` (emulator only) — show the theme-editor "To fill in" markers.

## Known differences from real Shopify

- Checkout is a mock page; the real store hands off to Shopify Checkout.
- `content_for_header` is a small stub (no Shopify analytics, pixels, apps or perf-kit), so local
  Lighthouse scores are higher than they will be on the store.
- Theme blocks (`{% content_for %}`), font_picker filters and gift card pages aren't emulated.
- Search is a simple substring match.
- Prices/availability are the snapshot's; inventory never runs out locally.
