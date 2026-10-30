# Flavour stories and Today's trays

Both are Shopify metaobjects (Content › Metaobjects). `scripts/store-setup.ts` creates the
definitions and the first entries. After that, the team edits them in admin. Any blank
field hides its part of the site.

## Flavour story (`flavour_story`)

Each product links to one through the `custom.flavour_story` metafield.

| Field | Type | Used for | When blank |
| --- | --- | --- | --- |
| Tag name | text | Jar tag, dabba, gifting, Twist & send | Product title |
| Memory line | multi-line text | Product page, jar tag back, Twist & send story | Hidden |
| Best with (pairing) | text | Product page, jar tag | Hidden |
| Colour | colour | Lid, flavour accents, taste map dot | Kraft brown |
| Accent colour | colour | Second accent (e.g. pistachio on Rose Gulkand) | Colour |
| Aroma | text: `blueberry`, `malt_dust`, `curry_leaf`, `hazelnut`, `carom_seed`, `rose_petal` | What bursts out when the jar opens | No burst |
| Cookie form | text: `thumbprint`, `malt_round`, `leaf_crust`, `chunk`, `stick`, `nut_crust` | Which cookie art fills the jar | Empty jar |
| Sweet ↔ savoury | 0–100 | Taste map x, Twist this next | Not on the map |
| Comfort ↔ curious | 0–100 | Taste map y | Not on the map |
| Cookies per 100g / 250g | integer | Cookie-count dots on the size toggle | Hidden |
| Allergens | list of text | Product facts | Hidden |
| Eggless | true/false | Product facts | Hidden |
| Shelf life | text | Product facts | Hidden |
| Local-name note | text, e.g. "omam, that's ajwain" | Under the memory line | Hidden |
| Texture photos | files | Texture strip | Product photos |
| Share image | file | Open Graph image for the product | First product photo |

In the theme editor, blank facts show a dashed "To fill in" marker. Customers never see it.

## Today's trays (`todays_trays`)

One entry per baking day. The section only appears when an entry's date is **today in
India time**. Liquid checks the date, and the browser checks again, so a cached page from
yesterday hides itself.

| Field | Type | Notes |
| --- | --- | --- |
| Date | date | The day the trays are out |
| On the trays | product list | The flavours baked today |
| Note | text | e.g. "Second Masala batch out at 4" |
| Photo | file | A real photo of today's trays, if there is one |

To update it each morning, add a new entry with today's date. Old entries can stay.
