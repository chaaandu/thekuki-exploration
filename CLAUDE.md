# Kuki — project bible (read before every task)

## What we sell
Handmade cookies, baked fresh in small batches through the day, never frozen. 100% veg.
Six flavours: Blueberry (thumbprint, blueberry jam, whole dried blueberries) · Boost
(properly malty, crisp edge, chewy middle) · Masala (savoury-sweet, toasted curry leaves)
· Nutella Chunk · Omam (crisp stick with carom seed) · Rose Gulkand (pale pink crumb,
crushed pistachio). Sizes 100g / 250g. Free delivery above ₹599.
Corporate & bulk gifting with branded boxes.
Instagram @getkuki · WhatsApp/Call +91 98230 12354
Lines we own: "Twist your tastebuds." "Small batch. Big bite."
Shopify is the single source of truth for products, prices, variants, stock, checkout.

## Beliefs (every decision traces back to one of these)
1. Our flavours are memories, not novelties: Boost after school, masala and omam with
   evening chai, gulkand like the paan after dinner. Tell each flavour through one
   specific memory. Never "fusion", "exotic" or "a unique twist".
2. Small batch is our promise, so prove it honestly. No fake timers, fake stock counts or
   "only 3 left" unless Shopify actually says so.
3. People order on phones. Any flavour is ≤ 3 taps from the cart, and reaching free
   delivery (₹599) should feel like filling a bag, not paying a penalty.
4. Gifting is half the business. A corporate buyer should leave with a mockup of their
   branded box and a sent enquiry in under 2 minutes.
5. Mid-range Android, patchy 4G. Fast is a feature.
6. The Kuki team must be able to change copy, banners, festive offers and featured
   flavours from the Shopify theme editor without touching code.

## Voice
- Warm, nostalgic, a little cheeky. Sensory and specific. Reuse the product descriptions;
  they're the best writing we have.
- Indian words where natural (chai, dabba, omam); gloss less-known ones once
  ("omam, that's ajwain").
- Prices as ₹199, never "Rs. 199.00".
- Never generic bakery filler ("finest ingredients", "made with love", "deserve nothing less").

## Visual direction
- The world: an old neighbourhood bakery counter in afternoon light. Glass jars with
  handwritten paper price tags, a wooden shelf, brown paper bags, a steel tumbler of chai.
  Real objects, not decorative patterns.
- Match the existing Kuki logo colours. Each flavour owns its ingredient's colour:
  blueberry indigo, malt brown, curry-leaf green, hazelnut, carom-seed khaki, rose pink
  with pistachio green. Base: sunlit off-white, warm dark ink.
- Type: Rozha One for headlines (signboard energy), Baloo 2 or Mukta for UI, plus one
  handwritten face for jar tags and notes.
- Show the green veg mark on every product.

## Banned (zombie UI tells)
- Fade-up-on-scroll everywhere; headline-left/image-right hero; gradient blobs; glass
  cards; corner toasts; spinners where content could render; confetti
- "Indian brand" clichés: mandala/rangoli/paisley patterns, marigold garlands,
  fake-Devanagari Latin fonts, stock photos of smiling families
- Invented reviews, ratings, allergens, shelf life, delivery promises or prices.
  Unknowns are TODO fields in theme settings or metaobjects and hide themselves.
- Other brands' logos or packaging (Boost, Nutella): name them in text only, never draw them

## Quality floor (every change)
- Mobile-first; check 360×800, 390×844, 768×1024, 1440×900
- Tap targets ≥ 44px; thumb-reach cart on mobile
- prefers-reduced-motion respected; every animation still makes sense when static
- Full keyboard support, visible focus, WCAG AA contrast, real alt text
- Animate transform/opacity only; smooth on a mid-range Android
- LCP < 2.5s on simulated 4G; 3D loads after first paint and never blocks buying
- Lighthouse mobile ≥ 90 on all four scores; `shopify theme check` clean

## How to work
- Plan first. For visual decisions, offer 2–3 directions (one deliberately weird) and wait.
- Develop with `shopify theme dev`. Never touch the live theme. Push only with
  `shopify theme push --unpublished`. I publish.
- After visual work: Playwright screenshots at the four sizes plus frame strips of
  animations. Look at them, critique against this file, fix, then show me.
- Commit after every working step. Ask me for business facts; never guess them.
