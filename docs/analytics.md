# Analytics

The theme publishes its own events through Shopify customer events
(`Shopify.analytics.publish`). Shopify's standard events (page views, add to cart,
checkout) keep working as usual alongside them.

| Event | When | Data |
| --- | --- | --- |
| `kuki_twist` | A jar is opened (tap, Enter, or the circular drag) | handle, method, source |
| `kuki_size_switch` | 100g ↔ 250g | handle, size, source |
| `kuki_add_to_bag` | Any add from the shelf, list, product page or suggestion | variant_id, quantity, handle, size, source |
| `kuki_free_delivery_reached` | The bag crosses ₹599 (once per session) | total |
| `kuki_dabba_built` | A dabba goes in the bag | size, flavours, box_product |
| `kuki_gifting_enquiry` | WhatsApp enquiry sent from the gifting studio | quantity, city, flavours, has_logo, needed_by |
| `kuki_twist_send` | A Twist & send video is made | flavour, format, container, has_name, sound, seconds_to_make |

## Custom pixel

Settings › Customer events › Add custom pixel, then paste this and change `send` to post
wherever you collect events (GA4, a sheet, etc.):

```js
const KUKI_EVENTS = [
  'kuki_twist', 'kuki_size_switch', 'kuki_add_to_bag', 'kuki_free_delivery_reached',
  'kuki_dabba_built', 'kuki_gifting_enquiry', 'kuki_twist_send',
];

function send(name, data) {
  // e.g. gtag('event', name, data);
  console.log('[kuki]', name, data);
}

KUKI_EVENTS.forEach((name) => analytics.subscribe(name, (event) => send(name, event.customData)));
```

You can switch all of these off in Theme settings › Analytics. The shop works the same
either way.
