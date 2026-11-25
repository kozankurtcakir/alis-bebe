import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import sharp from "sharp";
import { sql } from "./yardim";

/** Rakamsız ve benzersiz: paralel çalışan testlerin ürünleriyle karışmaz. */
export const newTag = () =>
  "q" +
  randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 9)
    .padEnd(9, "z");

// Bu test dosyasının yüklediği görseller; her çalışan süreçte ayrıdır.
const images: string[] = [];

/** Depoya doğrudan yazar; yalnızca test hazırlığı ve temizliği içindir. */
let serviceKey: string | undefined;
async function storage(path: string, method: string, body?: BodyInit) {
  serviceKey ??= execFileSync(
    "docker",
    ["exec", "supabase_storage_alis-bebe", "printenv", "SERVICE_KEY"],
    { encoding: "utf8" },
  ).trim();
  const response = await fetch(
    `http://127.0.0.1:54321/storage/v1/object/product-images/${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${serviceKey}`,
        "content-type": "image/webp",
      },
      body,
    },
  );
  expect(response.ok).toBe(true);
}

export async function uploadImage(color: string) {
  const path = `${randomUUID()}.webp`;
  // Gürültü, görseli gerçek fotoğraf ağırlığına yaklaştırır.
  const image = await sharp({
    create: {
      width: 1200,
      height: 1500,
      channels: 3,
      background: color,
      noise: { type: "gaussian", mean: 128, sigma: 12 },
    },
  })
    .webp({ quality: 82 })
    .toBuffer();
  await storage(path, "POST", new Uint8Array(image));
  images.push(path);
  return path;
}

export type Seed = {
  name: string;
  slug: string;
  status?: string;
  published?: string;
  images: { path: string; color?: string; alt: string }[];
  /** renk, beden kodu, fiyat, eski fiyat, stok */
  variants: [string, string, number, number | null, number][];
};

const text = (v: string) => `'${v.replaceAll("'", "''")}'`;

/** Ürünü bütün parçalarıyla tek işlemde ekler; yalnızca test hazırlığı içindir. */
export function seed(category: string, p: Seed) {
  const id = randomUUID();
  return [
    `insert into public.products (id, name, slug, audience, gender, vat_bps, description, material, status, published_at)
     values ('${id}', ${text(p.name)}, '${p.slug}', 'baby', 'unisex', 1000, '<b>Yumuşak</b> <script>window.sizdi=1</script>', '%100 pamuk',
       '${p.status ?? "published"}', ${p.published ? `'${p.published}'` : "null"});`,
    `insert into public.product_categories (product_id, category_id, is_primary)
     select '${id}', id, true from public.categories where slug = '${category}';`,
    ...p.images.map(
      (i, n) =>
        `insert into public.product_images (product_id, color_id, path, width, height, alt, sort_order)
         values ('${id}', (select id from public.colors where slug = '${i.color ?? ""}'), '${i.path}', 1200, 1500, ${text(i.alt)}, ${n});`,
    ),
    ...p.variants.map(
      ([color, size, price, old, stock]) =>
        `insert into public.product_variants (product_id, color_id, size_id, sku, barcode, price, compare_at_price)
           select '${id}', c.id, s.id, upper('GZL-${randomUUID().slice(0, 12)}'), '0${randomUUID().slice(0, 23)}', ${price}, ${old}
           from public.colors c, public.sizes s where c.slug = '${color}' and s.code = '${size}';
         update public.inventory set on_hand = ${stock} where variant_id = (
           select v.id from public.product_variants v
           join public.colors c on c.id = v.color_id join public.sizes s on s.id = v.size_id
           where v.product_id = '${id}' and c.slug = '${color}' and s.code = '${size}');`,
    ),
  ].join("\n");
}

/** Kategoriyi ürünleri, görselleri ve sepet kayıtlarıyla birlikte siler. */
export async function removeCategory(category: string) {
  const products = "(select product_id from silinecek)";
  const variants = `(select id from public.product_variants where product_id in ${products})`;
  sql(`begin;
    create temp table silinecek on commit drop as
      select pc.product_id from public.product_categories pc
      join public.categories c on c.id = pc.category_id where c.slug = '${category}';
    delete from public.cart_items where variant_id in ${variants};
    delete from public.favorites where product_id in ${products};
    update public.products set status = 'draft' where id in ${products};
    set constraints all immediate;
    alter table public.price_history disable trigger price_history_append_only;
    delete from public.price_history where variant_id in ${variants};
    alter table public.price_history enable trigger price_history_append_only;
    delete from public.product_images where product_id in ${products};
    delete from public.product_categories where product_id in ${products};
    delete from public.inventory where variant_id in ${variants};
    delete from public.product_variants where product_id in ${products};
    delete from public.products where id in ${products};
    delete from public.categories where slug = '${category}';
    commit;`);
  for (const path of images.splice(0)) await storage(path, "DELETE");
}
