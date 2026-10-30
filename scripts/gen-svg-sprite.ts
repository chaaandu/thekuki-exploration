/**
 * Generates theme/snippets/svg-sprite.liquid: the shared SVG <symbol>s for the 2D jars
 * (one cookie fill per cookie_form), jar clip paths/gradients, and UI icons.
 *
 * Deterministic (seeded) so every build produces the same art. Run: node scripts/gen-svg-sprite.ts
 */
import { writeFileSync } from 'node:fs';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n: number) => Number(n.toFixed(2));

// Jar geometry (viewBox 0 0 140 190). Inner cavity used to clip the cookies.
const INNER = 'M38 48 C28 50 21 55 21 66 L21 164 C21 171 26 175 33 175 L107 175 C114 175 119 171 119 164 L119 66 C119 55 112 50 102 48 Z';

type RoundForm = 'thumbprint' | 'malt_round' | 'leaf_crust' | 'chunk' | 'nut_crust';

const DOUGH: Record<RoundForm, string> = {
  thumbprint: '#d8a35f',
  malt_round: '#5f3820',
  leaf_crust: '#d6a354',
  chunk: '#d49d5d',
  nut_crust: '#efb4c2',
};

function cookieDetails(form: RoundForm, r: number, rand: () => number): string {
  const out: string[] = [];
  if (form === 'thumbprint') {
    out.push(`<circle r="${f(r * 0.38)}" fill="#43256e"/>`);
    out.push(`<circle r="${f(r * 0.38)}" fill="url(#kuki-jam-shine)"/>`);
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * 0.16 * rand();
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(r * 0.13)}" fill="#26204a"/>`);
    }
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.55 + rand() * 0.35);
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.7 + rand() * 0.6)}" fill="#b98545" opacity="0.8"/>`);
    }
  } else if (form === 'malt_round') {
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * Math.sqrt(rand()) * 0.9;
      const light = rand() > 0.5;
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.6 + rand() * 0.9)}" fill="${light ? '#8d5c37' : '#3b2112'}"/>`);
    }
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * 0.35;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      out.push(`<path d="M${f(x)} ${f(y)} l${f(rand() * 6 - 3)} ${f(rand() * 6 - 3)} l${f(rand() * 5 - 2.5)} ${f(rand() * 5 - 2.5)}" stroke="#2f190c" stroke-width="0.8" fill="none" stroke-linecap="round"/>`);
    }
  } else if (form === 'leaf_crust') {
    for (let i = 0; i < 18; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * Math.sqrt(rand()) * 0.9;
      const rot = rand() * 180;
      const shade = ['#23401a', '#2f5a22', '#3d6b2a', '#4a7d33'][Math.floor(rand() * 4)];
      out.push(`<ellipse cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" rx="${f(2.8 + rand() * 1.8)}" ry="${f(1.1 + rand() * 0.6)}" transform="rotate(${f(rot)} ${f(Math.cos(a) * d)} ${f(Math.sin(a) * d)})" fill="${shade}"/>`);
    }
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * Math.sqrt(rand()) * 0.9;
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.5 + rand() * 0.6)}" fill="#7a4e1f"/>`);
    }
  } else if (form === 'chunk') {
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.2 + rand() * 0.55);
      const cx = Math.cos(a) * d;
      const cy = Math.sin(a) * d;
      const pts: string[] = [];
      const rr = 2.6 + rand() * 2;
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * Math.PI * 2 + rand() * 0.5;
        const rad = rr * (0.7 + rand() * 0.45);
        pts.push(`${f(cx + Math.cos(t) * rad)},${f(cy + Math.sin(t) * rad)}`);
      }
      out.push(`<polygon points="${pts.join(' ')}" fill="#3a1d10"/>`);
      out.push(`<circle cx="${f(cx - rr * 0.3)}" cy="${f(cy - rr * 0.35)}" r="${f(rr * 0.28)}" fill="#7a4a2c" opacity="0.7"/>`);
    }
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * Math.sqrt(rand()) * 0.85;
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.8 + rand() * 0.8)}" fill="#b07a44"/>`);
    }
  } else if (form === 'nut_crust') {
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
      const d = r * (0.84 + rand() * 0.16);
      const c = ['#8fae4a', '#6f8f37', '#bcd07f'][Math.floor(rand() * 3)];
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(1 + rand() * 0.9)}" fill="${c}"/>`);
    }
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * Math.sqrt(rand()) * 0.6;
      out.push(`<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.7 + rand() * 0.8)}" fill="#a8435f"/>`);
    }
  }
  return out.join('');
}

function roundCookies(form: RoundForm, seed: number): string {
  const rand = rng(seed);
  const rows = [
    { y: 160, xs: [40, 70, 100] },
    { y: 131, xs: [34, 64, 96] },
    { y: 102, xs: [44, 76, 104] },
    { y: 75, xs: [36, 68] },
  ];
  const parts: string[] = [];
  // Draw top rows first so lower cookies sit in front.
  for (const row of [...rows].reverse()) {
    for (const x0 of row.xs) {
      const r = 15.5 + rand() * 2.5;
      const x = x0 + (rand() * 6 - 3);
      const y = row.y + (rand() * 6 - 3);
      const rot = rand() * 360;
      parts.push(
        `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})">` +
          `<circle r="${f(r)}" fill="${DOUGH[form]}"/>` +
          cookieDetails(form, r, rand) +
          `<circle r="${f(r)}" fill="url(#kuki-cookie-shade)"/>` +
          `<circle r="${f(r - 0.6)}" fill="none" stroke="rgb(59 26 12 / 0.28)" stroke-width="1.1"/>` +
        `</g>`,
      );
    }
  }
  return parts.join('');
}

function sticks(seed: number): string {
  const rand = rng(seed);
  const parts: string[] = [];
  // Back row (shadowed) then front row, packed like breadsticks in a glass.
  const rows: { xs: number[]; shade: number; base: number }[] = [
    { xs: [30, 42, 54, 66, 78, 90, 102, 112], shade: 0.32, base: 174 },
    { xs: [36, 49, 62, 75, 88, 101], shade: 0, base: 177 },
  ];
  for (const row of rows) {
    for (const x0 of row.xs) {
      const h = 76 + rand() * 18;
      const x = x0 + (rand() * 3 - 1.5);
      const tilt = rand() * 9 - 4.5;
      const top = row.base - h;
      const seeds: string[] = [];
      for (let i = 0; i < 12; i++) {
        const sx = 2 + rand() * 7;
        const sy = 4 + rand() * (h - 8);
        seeds.push(`<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="0.95" ry="0.55" transform="rotate(${f(rand() * 180)} ${f(sx)} ${f(sy)})" fill="#6c5c30"/>`);
      }
      parts.push(
        `<g transform="translate(${f(x - 5.5)} ${f(top)}) rotate(${f(tilt)} 5.5 ${f(h)})">` +
          `<rect width="11" height="${f(h)}" rx="4.5" fill="#dcae67"/>` +
          seeds.join('') +
          `<rect width="11" height="${f(h)}" rx="4.5" fill="url(#kuki-stick-shade)"/>` +
          (row.shade ? `<rect width="11" height="${f(h)}" rx="4.5" fill="#2a1206" fill-opacity="${row.shade}"/>` : '') +
          `<rect x="0.5" y="0.5" width="10" height="${f(h - 1)}" rx="4" fill="none" stroke="rgb(59 26 12 / 0.25)" stroke-width="1"/>` +
        `</g>`,
      );
    }
  }
  return parts.join('');
}

function crumbs(seed: number): string {
  const rand = rng(seed);
  const parts: string[] = [];
  for (let i = 0; i < 9; i++) {
    const x = 34 + rand() * 72;
    const y = 170 + rand() * 4;
    parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + rand() * 1.3)}" fill="#c99456"/>`);
  }
  return parts.join('');
}

const ridges = Array.from({ length: 44 }, (_, i) => `<rect x="${f(i * 4)}" y="0" width="1.6" height="40" fill="rgb(0 0 0 / 0.16)"/>`).join('');

// Icons: 24×24, 1.75 stroke, round joins. Drawn simply so they sit with the ink-outline logo.
const icon = (id: string, body: string) =>
  `<symbol id="kuki-icon-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`;

const icons = [
  icon('bag', '<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  icon('menu', '<path d="M4 7h16M4 12h16M4 17h10"/>'),
  icon('close', '<path d="M6 6l12 12M18 6L6 18"/>'),
  icon('chevron-down', '<path d="M6 9l6 6 6-6"/>'),
  icon('arrow-right', '<path d="M5 12h14M13 6l6 6-6 6"/>'),
  icon('check', '<path d="M5 12.5l4.2 4.2L19 7"/>'),
  icon('plus', '<path d="M12 5v14M5 12h14"/>'),
  icon('minus', '<path d="M5 12h14"/>'),
  icon('chat', '<path d="M4 12a8 8 0 1 1 3.4 6.5L4 20l1.3-3.6A7.9 7.9 0 0 1 4 12z"/><path d="M9 10.5h6M9 13.5h4"/>'),
  icon('phone', '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>'),
  icon('at', '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>'),
  icon('sound-on', '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  icon('sound-off', '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  icon('motion', '<path d="M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><path d="M12 9.5V12l1.8 1.2"/>'),
  icon('shelf', '<path d="M3 17h18M5 17V9.5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 10 9.5V17M14 17v-5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V17"/><path d="M5.5 6.5h4M14.5 8.5h4"/>'),
  icon('twist', '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/>'),
  icon('gift', '<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13"/><path d="M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1z"/>'),
  icon('box', '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
  icon('download', '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  icon('upload', '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>'),
  icon('send', '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>'),
  icon('play', '<path d="M8 5.5v13l11-6.5z"/>'),
  icon('search', '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  icon('sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4"/>'),
];

const GLASS = 'M36 44 C24 46 16 52 16 64 L16 166 C16 175 22 180 31 180 L109 180 C118 180 124 175 124 166 L124 64 C124 52 116 46 104 44 Z';

function jarBody(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 190" width="140" height="190">
<defs>
<clipPath id="i" clipPathUnits="userSpaceOnUse"><path d="${INNER}"/></clipPath>
<radialGradient id="kuki-cookie-shade" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2a1206" stop-opacity="0.32"/></radialGradient>
<linearGradient id="kuki-stick-shade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.25"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#2a1206" stop-opacity="0.28"/></linearGradient>
<radialGradient id="kuki-jam-shine" cx="0.35" cy="0.3" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.62"/><stop offset="0.14" stop-color="#fff" stop-opacity="0.14"/><stop offset="0.5" stop-color="#e8f2ea" stop-opacity="0.06"/><stop offset="0.86" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#fff" stop-opacity="0.5"/></linearGradient>
<radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2a1206" stop-opacity="0.34"/><stop offset="1" stop-color="#2a1206" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="70" cy="181" rx="60" ry="7" fill="url(#s)"/>
<path d="${GLASS}" fill="#eef3ec" fill-opacity="0.2"/>
<g clip-path="url(#i)">${fill}</g>
<path d="${GLASS}" fill="url(#g)" stroke="#3b1a0c" stroke-opacity="0.32" stroke-width="1.5"/>
<path d="M24 70 C24 62 27 57 32 54 L32 160 C27 158 24 154 24 148 Z" fill="#fff" fill-opacity="0.42"/>
<path d="M112 74 L112 150" stroke="#fff" stroke-opacity="0.38" stroke-width="2.5" stroke-linecap="round"/>
<ellipse cx="70" cy="174" rx="44" ry="3.2" fill="#fff" fill-opacity="0.28"/>
<rect x="36" y="36" width="68" height="10" rx="2.5" fill="#e6eee6" fill-opacity="0.55" stroke="#3b1a0c" stroke-opacity="0.28" stroke-width="1.2"/>
</svg>
`;
}

const forms: Record<string, string> = {
  thumbprint: roundCookies('thumbprint', 11),
  malt_round: roundCookies('malt_round', 23),
  leaf_crust: roundCookies('leaf_crust', 37),
  chunk: roundCookies('chunk', 41),
  nut_crust: roundCookies('nut_crust', 53),
  stick: sticks(67),
  empty: crumbs(71),
};
for (const [form, fill] of Object.entries(forms)) {
  const svg = jarBody(fill);
  writeFileSync(`theme/assets/jar-${form}.svg`, svg);
  console.log(`jar-${form}.svg ${(svg.length / 1024).toFixed(1)} KB`);
}

// Single cookies for the 2D reveal (one lifts out of the jar and turns to face you).
function singleCookie(form: string): string {
  const rand = rng(900 + form.length * 7);
  const defs = `<defs><radialGradient id="kuki-cookie-shade" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.24"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2a1206" stop-opacity="0.34"/></radialGradient><radialGradient id="kuki-jam-shine" cx="0.35" cy="0.3" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="kuki-stick-shade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.25"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#2a1206" stop-opacity="0.28"/></linearGradient></defs>`;
  if (form === 'stick') {
    const seeds: string[] = [];
    for (let i = 0; i < 18; i++) {
      const sx = 4 + rand() * 12;
      const sy = 6 + rand() * 88;
      seeds.push(`<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="1.3" ry="0.75" transform="rotate(${f(rand() * 180)} ${f(sx)} ${f(sy)})" fill="#6c5c30"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -6 100 112" width="100" height="112">${defs}<g transform="rotate(-8 10 50)"><rect width="20" height="100" rx="7" fill="#dcae67"/>${seeds.join('')}<rect width="20" height="100" rx="7" fill="url(#kuki-stick-shade)"/><rect x="0.6" y="0.6" width="18.8" height="98.8" rx="6.5" fill="none" stroke="rgb(59 26 12 / 0.3)" stroke-width="1.2"/></g></svg>`;
  }
  const R = 17;
  const body = `<circle r="${R}" fill="${DOUGH[form as RoundForm]}"/>${cookieDetails(form as RoundForm, R, rand)}<circle r="${R}" fill="url(#kuki-cookie-shade)"/><circle r="${R - 0.4}" fill="none" stroke="rgb(59 26 12 / 0.3)" stroke-width="0.8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-18.5 -18.5 37 37" width="100" height="100">${defs}<g>${body}</g></svg>`;
}

for (const form of ['thumbprint', 'malt_round', 'leaf_crust', 'chunk', 'nut_crust', 'stick']) {
  writeFileSync(`theme/assets/cookie-${form}.svg`, singleCookie(form));
}

const sprite = `{%- comment -%} Generated by scripts/gen-svg-sprite.ts. Do not edit by hand. {%- endcomment -%}
<svg class="svg-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<defs>
<clipPath id="kuki-lid-clip" clipPathUnits="userSpaceOnUse"><rect x="28" y="8" width="84" height="30" rx="6"/></clipPath>
<pattern id="kuki-twine" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="6" height="6" fill="#fff6ea"/><rect width="3" height="6" fill="#b3261e"/></pattern>
</defs>
<symbol id="kuki-lid-ridges" viewBox="0 0 176 40" width="176" height="40" overflow="visible">${ridges}</symbol>
${icons.join('\n')}
</svg>
`;

writeFileSync('theme/snippets/svg-sprite.liquid', sprite);
console.log(`svg-sprite.liquid written (${(sprite.length / 1024).toFixed(1)} KB)`);
