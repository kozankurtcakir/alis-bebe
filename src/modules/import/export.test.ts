import { expect, test } from "vitest";
import { mapColumns } from "./columns";
import { buildWorkbook } from "./export";
import { lookupKeys, planProducts, planStock, type Existing } from "./plan";
import type { ExportRow } from "./queries";
import { readXlsx } from "./xlsx";

const variant: ExportRow = {
  sku: "00-AB-1",
  barcode: "0012345678905",
  price: 24990,
  compare_at_price: 29999,
  desi: 0.75,
  is_active: true,
  colors: { name: "Hardal" },
  sizes: { name: "3-6 Ay" },
  products: {
    product_no: 7,
    name: "=1+1 & <Zıbın>",
    product_type: "clothing",
    audience: "baby",
    gender: "female",
    vat_bps: 1050,
    description: "bir\r\niki",
    material: "%100 pamuk",
    care: null,
    brands: { name: "Minik" },
    product_categories: [
      { category_id: "y", is_primary: false },
      { category_id: "t", is_primary: true },
    ],
  },
  inventory: { on_hand: 12 },
};
const categories = [
  { id: "b", name: "Bebek", parent_id: null },
  { id: "t", name: "Tişört", parent_id: "b" },
  { id: "y", name: "Yeni", parent_id: null },
];
const lists = {
  categories,
  brands: [{ id: "m", name: "Minik" }],
  colors: [{ id: "h", name: "Hardal", code: "HAR" }],
  sizes: [{ id: "s", name: "3-6 Ay", code: "3-6A" }],
};
const existing: Existing = {
  variants: [
    {
      id: "v",
      product_id: "p",
      color_id: "h",
      size_id: "s",
      sku: "00-AB-1",
      barcode: "0012345678905",
      price: 24990,
      compare_at_price: 29999,
      desi: 0.75,
      is_active: true,
      on_hand: 12,
      reserved: 0,
    },
  ],
  products: [
    {
      id: "p",
      product_no: 7,
      name: "=1+1 & <Zıbın>",
      product_type: "clothing",
      audience: "baby",
      gender: "female",
      brand_id: "m",
      vat_bps: 1050,
      description: "bir\r\niki",
      material: "%100 pamuk",
      care: null,
      primary_category: "t",
      combos: ["h|s"],
    },
  ],
  barcodes: { "0012345678905": "v" },
  slugs: [],
};

async function roundTrip(kind: "products" | "stock", rows: ExportRow[] | null) {
  const bytes = await buildWorkbook(kind, rows, categories);
  return mapColumns(kind, readXlsx(bytes));
}

test("indirilen ürün dosyası değiştirilmeden yüklenirse hiçbir şey değişmez", async () => {
  const mapped = await roundTrip("products", [variant]);
  if ("error" in mapped) throw new Error(mapped.error);
  expect(lookupKeys(mapped.rows)).toMatchObject({
    skus: ["00-AB-1"],
    barcodes: ["0012345678905"],
    productNos: [7],
  });
  expect(planProducts(mapped.rows, lists, existing)).toMatchObject([
    { row_no: 2, action: "skip", errors: [], summary: [] },
  ]);
});

test("indirilen stok dosyası değiştirilmeden yüklenirse hiçbir şey değişmez", async () => {
  const mapped = await roundTrip("stock", [variant]);
  if ("error" in mapped) throw new Error(mapped.error);
  for (const mode of ["purchase", "adjustment"] as const) {
    expect(planStock(mapped.rows, mode, existing)).toMatchObject([
      { action: "skip", errors: [] },
    ]);
  }
});

test.each(["products", "stock"] as const)(
  "boş %s şablonu geçerli ve boştur",
  async (kind) => {
    expect(await roundTrip(kind, null)).toEqual({
      error: "Dosyada veri satırı yok.",
    });
  },
);

test("1.000 satırlık uzun dosya yükleme sınırlarına sığar", async () => {
  const long = {
    ...variant,
    products: { ...variant.products, description: "uzun açıklama ".repeat(60) },
  };
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    ...long,
    sku: `AB-${i}`,
  }));
  const mapped = await roundTrip("products", rows);
  expect("rows" in mapped && mapped.rows.length).toBe(1000);
});
