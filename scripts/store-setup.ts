/**
 * Creates the store-side pieces the theme expects, via the Admin GraphQL API through
 * Shopify CLI (`shopify store execute`). Safe to re-run: definitions are looked up first,
 * entries are upserted by handle.
 *
 *   node scripts/store-setup.ts                 # dry run: prints every query, changes nothing
 *   node scripts/store-setup.ts --apply         # runs it against the store
 *   node scripts/store-setup.ts --apply --only=definitions,seed,pages,menus,fixes
 *
 * Before --apply, authenticate once (opens a browser to approve):
 *   shopify store auth --store quxv3b-ze.myshopify.com --scopes \
 *     read_products,write_products,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_pages,write_online_store_pages,read_online_store_navigation,write_online_store_navigation
 *
 * Reads: store/setup/definitions.json, store/setup/seed.json, store/setup/content.json
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STORE = process.env.KUKI_STORE ?? 'quxv3b-ze.myshopify.com';
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] ?? 'definitions,seed,pages,menus,fixes').split(',');

const definitions = JSON.parse(readFileSync('store/setup/definitions.json', 'utf8'));
const seed = JSON.parse(readFileSync('store/setup/seed.json', 'utf8'));
const content = JSON.parse(readFileSync('store/setup/content.json', 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'kuki-setup-'));

let step = 0;
function gql<T = any>(label: string, query: string, variables: Record<string, unknown> = {}, mutation = false): T | null {
  step += 1;
  console.log(`\n── ${step}. ${label}${mutation ? ' (mutation)' : ''}`);
  if (!APPLY) {
    console.log(query.trim());
    if (Object.keys(variables).length) console.log('variables:', JSON.stringify(variables, null, 2));
    return null;
  }
  const qf = join(tmp, `q${step}.graphql`);
  const vf = join(tmp, `v${step}.json`);
  writeFileSync(qf, query);
  writeFileSync(vf, JSON.stringify(variables));
  const args = ['store', 'execute', '--store', STORE, '--query-file', qf, '--variable-file', vf, '--json'];
  if (mutation) args.push('--allow-mutations');
  const out = execFileSync('shopify', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const json = JSON.parse(out);
  const data = json.data ?? json;
  const errors = JSON.stringify(data).match(/"userErrors":\[(?!\])[^\]]*\]/g);
  if (errors) console.warn('  userErrors:', errors.join(' '));
  return data as T;
}

// ---------- 1. Definitions ----------

const defIds: Record<string, string> = {};

if (ONLY.includes('definitions') || ONLY.includes('seed')) {
  const existing = gql<{ metaobjectDefinitions: { nodes: { id: string; type: string }[] } }>(
    'Look up existing metaobject definitions',
    `query { metaobjectDefinitions(first: 50) { nodes { id type } } }`,
  );
  for (const n of existing?.metaobjectDefinitions.nodes ?? []) defIds[n.type] = n.id;
}

if (ONLY.includes('definitions')) {
  for (const def of definitions.metaobjects) {
    if (defIds[def.type]) {
      console.log(`  ${def.type} already exists (${defIds[def.type]}), skipping create.`);
      continue;
    }
    const res = gql<{ metaobjectDefinitionCreate: { metaobjectDefinition: { id: string } } }>(
      `Create metaobject definition "${def.type}"`,
      `mutation Create($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition { id type }
          userErrors { field message code }
        }
      }`,
      {
        definition: {
          type: def.type,
          name: def.name,
          description: def.description,
          displayNameKey: def.displayNameKey,
          access: def.access,
          fieldDefinitions: def.fields.map((f: any) => ({
            key: f.key,
            name: f.name,
            description: f.description,
            type: f.type,
            required: Boolean(f.required),
            validations: f.validations ?? [],
          })),
        },
      },
      true,
    );
    const id = res?.metaobjectDefinitionCreate.metaobjectDefinition?.id;
    if (id) defIds[def.type] = id;
  }

  for (const mf of definitions.metafields) {
    gql(
      `Create product metafield definition ${mf.namespace}.${mf.key}`,
      `mutation Create($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message code }
        }
      }`,
      {
        definition: {
          name: mf.name,
          namespace: mf.namespace,
          key: mf.key,
          description: mf.description,
          type: mf.type,
          ownerType: mf.ownerType,
          pin: true,
          access: mf.access,
          validations: [{ name: 'metaobject_definition_id', value: defIds[mf.metaobjectType] ?? `<id of ${mf.metaobjectType}>` }],
        },
      },
      true,
    );
  }
}

// ---------- 2. Products (handles → ids) ----------

const productIds: Record<string, string> = {};
if (ONLY.includes('seed') || ONLY.includes('fixes')) {
  const res = gql<{ products: { nodes: { id: string; handle: string; options: { id: string; name: string; optionValues: { id: string; name: string }[] }[] }[] } }>(
    'Look up products',
    `query { products(first: 100) { nodes { id handle options { id name optionValues { id name } } } } }`,
  );
  for (const p of res?.products.nodes ?? []) productIds[p.handle] = p.id;
  (globalThis as any).__products = res?.products.nodes ?? [];
}

// ---------- 3. Seed entries + link each product ----------

function fieldValue(type: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (type.startsWith('list.')) return JSON.stringify(value);
  return String(value);
}

if (ONLY.includes('seed')) {
  const def = definitions.metaobjects.find((d: any) => d.type === 'flavour_story');
  for (const entry of seed.flavour_story) {
    const fields = Object.entries(entry.fields)
      .map(([key, value]) => {
        const f = def.fields.find((x: any) => x.key === key);
        const v = fieldValue(f?.type ?? 'single_line_text_field', value);
        return v === null ? null : { key, value: v };
      })
      .filter(Boolean);
    const res = gql<{ metaobjectUpsert: { metaobject: { id: string } } }>(
      `Upsert flavour_story "${entry.handle}" (only the known facts; blanks stay blank)`,
      `mutation Upsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
        metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message code }
        }
      }`,
      { handle: { type: 'flavour_story', handle: entry.handle }, metaobject: { fields } },
      true,
    );
    const metaobjectId = res?.metaobjectUpsert.metaobject?.id ?? `<flavour_story/${entry.handle}>`;
    gql(
      `Link ${entry.product} → flavour_story/${entry.handle}`,
      `mutation Link($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message code }
        }
      }`,
      {
        metafields: [
          {
            ownerId: productIds[entry.product] ?? `<product ${entry.product}>`,
            namespace: 'custom',
            key: 'flavour_story',
            type: 'metaobject_reference',
            value: metaobjectId,
          },
        ],
      },
      true,
    );
  }
}

// ---------- 4. Pages ----------

if (ONLY.includes('pages')) {
  for (const page of content.pages) {
    gql(
      `Create page /pages/${page.handle} (template: page.${page.template_suffix})`,
      `mutation Create($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page { id handle }
          userErrors { field message code }
        }
      }`,
      { page: { title: page.title, handle: page.handle, templateSuffix: page.template_suffix, isPublished: true, body: '' } },
      true,
    );
  }
}

// ---------- 5. Menus ----------

if (ONLY.includes('menus')) {
  const res = gql<{ menus: { nodes: { id: string; handle: string }[] } }>('Look up menus', `query { menus(first: 20) { nodes { id handle } } }`);
  const menuIds: Record<string, string> = {};
  for (const m of res?.menus.nodes ?? []) menuIds[m.handle] = m.id;
  for (const menu of content.menus) {
    const items = menu.links.map((l: any) => ({ title: l.title, type: 'HTTP', url: l.url }));
    if (menuIds[menu.handle] || !APPLY) {
      gql(
        `Update menu "${menu.handle}"`,
        `mutation Update($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
          menuUpdate(id: $id, title: $title, items: $items) {
            menu { id handle }
            userErrors { field message code }
          }
        }`,
        { id: menuIds[menu.handle] ?? `<menu ${menu.handle}>`, title: menu.title, items },
        true,
      );
    } else {
      gql(
        `Create menu "${menu.handle}"`,
        `mutation Create($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
          menuCreate(title: $title, handle: $handle, items: $items) {
            menu { id handle }
            userErrors { field message code }
          }
        }`,
        { title: menu.title, handle: menu.handle, items },
        true,
      );
    }
  }
}

// ---------- 6. Product data fixes (Rose Gulkand's sizes say "100"/"250") ----------

if (ONLY.includes('fixes')) {
  const products: any[] = (globalThis as any).__products ?? [];
  for (const fix of content.productFixes) {
    const product = products.find((p) => p.handle === fix.product);
    for (const [optionName, renames] of Object.entries(fix.renameOptionValues ?? {})) {
      const option = product?.options.find((o: any) => o.name === optionName);
      const values = Object.entries(renames as Record<string, string>).map(([from, to]) => ({
        id: option?.optionValues.find((v: any) => v.name === from)?.id ?? `<${optionName} ${from}>`,
        name: to,
      }));
      gql(
        `Rename ${fix.product} ${optionName} values`,
        `mutation Rename($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!]) {
          productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate) {
            product { id }
            userErrors { field message code }
          }
        }`,
        { productId: product?.id ?? `<product ${fix.product}>`, option: { id: option?.id ?? `<option ${optionName}>` }, optionValuesToUpdate: values },
        true,
      );
    }
    if (fix.productType) {
      gql(
        `Set ${fix.product} product type`,
        `mutation Update($product: ProductUpdateInput!) {
          productUpdate(product: $product) { product { id productType } userErrors { field message } }
        }`,
        { product: { id: product?.id ?? `<product ${fix.product}>`, productType: fix.productType } },
        true,
      );
    }
  }
}

console.log(APPLY ? '\nDone.' : '\nDry run only. Re-run with --apply after `shopify store auth` to make these changes.');
