# Launch checklist

Everything here runs against the real store, quxv3b-ze.myshopify.com. The live theme
("Kuki", id 190758584393) is never touched. The new theme goes up **unpublished**, and the
Kuki team publishes it themselves.

## 0. Before connecting

- `npm ci && npm run build && npm run check && npm test`. All four must pass.
- Read "Open business facts" below. Anything still unknown stays blank and hides itself
  on the site. Nothing gets guessed.

## 1. Connect and create the store-side pieces

```sh
shopify store auth --store quxv3b-ze.myshopify.com --scopes \
  read_products,write_products,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_pages,write_online_store_pages,read_online_store_navigation,write_online_store_navigation

node scripts/store-setup.ts            # dry run: prints every query, changes nothing
node scripts/store-setup.ts --apply    # definitions, flavour stories, pages, menus, fixes
```

What `--apply` creates (it's safe to re-run, because it upserts by handle):

| Piece | Details |
| --- | --- |
| Metaobject definitions | `flavour_story`, `todays_trays` (see docs/metaobjects.md) |
| Product metafield | `custom.flavour_story` → metaobject reference, on all six products |
| Flavour stories | Known facts only. Memory lines and pairings are **draft copy** for the team to edit |
| Pages | `about`, `gifting`, `dabba`, `small-batch`, each with its own template suffix |
| Menus | Main menu and footer, pointing at the pages above. `/#about` and `/#gifting` still work |
| Fixes | Rose Gulkand option values "100"/"250" → "100g"/"250g" to match the other five |

## 2. Push the theme (unpublished)

```sh
npm run build
shopify theme check --path theme
shopify theme push --unpublished --path theme --store quxv3b-ze.myshopify.com
```

Open the preview link the CLI prints. `shopify theme dev --path theme` also works for
live editing against real data.

## 3. Check on the preview

- [ ] Home at 360, 390, 768 and 1440 wide: the shelf, the flavour list, the taste map,
      gifting, the day strip, About
- [ ] All six product pages: the jar opens on load, size toggle, add to bag, Twist this
      next, Twist & send makes a video
- [ ] Bag: the free-delivery meter, one-tap suggestion, gift note, checkout button
- [ ] Fill a dabba: 3 and 6, with the "Gift box" property showing on the cart lines
- [ ] Gifting: upload a logo, download the PNG, check the WhatsApp message opens with the
      right number and fields
- [ ] Contact form arrives in the store's inbox
- [ ] Old URLs: `/collections/all`, `/collections/frontpage`, `/pages/contact`,
      `/blogs/news`, `/policies/privacy-policy`, all six `/products/...`
- [ ] Theme editor: change a banner, the festive offer dates, the featured chai picks, and
      a Today's trays entry, all without touching code
- [ ] Lighthouse mobile on the preview URL: `node scripts/lighthouse.ts --base=<preview url>`.
      Every score should be ≥ 90 (local runs: home 98, product 99, the rest 100)

## 4. A test order

Turn on Shopify's Bogus Gateway (Settings › Payments) or use a 100% discount code. Then
place one order with a dabba, one with a gift note, and check that both line properties
and the note reach the order in admin. Turn the test gateway off again afterwards.

## 5. Customer events (analytics)

Settings › Customer events › Add custom pixel. Paste the snippet from
docs/analytics.md. The theme publishes `kuki_twist`, `kuki_size_switch`,
`kuki_add_to_bag`, `kuki_free_delivery_reached`, `kuki_dabba_built`,
`kuki_gifting_enquiry` and `kuki_twist_send`.

## 6. Publish

The Kuki team publishes it from Online Store › Themes. Keep the old theme for a few weeks
so it's one click to roll back.

## Open business facts

These are blank on purpose and hide themselves until someone fills them in:

| Where | What | Hides |
| --- | --- | --- |
| Flavour story (each product) | Cookies per 100g / 250g | Cookie-count dots and "about N cookies" |
| Flavour story | Allergens, eggless, shelf life | The facts rows on the product page |
| Flavour story | Memory line + pairing for Blueberry and Nutella Chunk (others are drafts to check) | The memory line |
| Flavour story | Local-name note (e.g. "omam, that's ajwain") | The gloss line |
| Flavour story | Texture photos, share image | Texture strip uses product photos instead |
| Theme settings › Legal | FSSAI licence number | Footer licence line |
| Theme settings › Delivery | Delivery note (areas, days) | The line under the buy box |
| Gifting section | Bulk tiers, minimum boxes, days of notice | Tiers list, date floor |
| Gifting section | Real box and sleeve colours | The mockup uses kraft + cream until then |
| Dabba section | Is there a box product to sell with each dabba? | Nothing is added if not |
| Policies | Refund, shipping and terms policies (only privacy exists) | Footer links |

Raised earlier and still open: 3 × 100g = ₹597, just under the ₹599 free-delivery line;
whether ₹249 is a real former price for 100g; replacing the AI-generated hero and gift
box images; the "100% natural" claim.
