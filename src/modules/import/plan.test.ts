import { expect, test } from "vitest";
import {
  mapColumns,
  productColumns,
  stockColumns,
  type Column,
  type DataRow,
} from "./columns";
import {
  lookupKeys,
  planProducts,
  planStock,
  type Existing,
  type Lists,
} from "./plan";
import type { Cell, SheetRow } from "./xlsx";

const lists: Lists = {
  categories: [
    { id: "bebek", name: "Bebek", parent_id: null },
    { id: "b-tisort", name: "Tişört", parent_id: "bebek" },
    { id: "yetiskin", name: "Yetişkin", parent_id: null },
    { id: "y-tisort", name: "Tişört", parent_id: "yetiskin" },
  ],
  brands: [{ id: "marka", name: "Minik" }],
  colors: [
    { id: "har", name: "Hardal", code: "HAR" },
    { id: "lil", name: "Lila", code: "LIL" },
  ],
  sizes: [
    { id: "3-6", name: "3-6 Ay", code: "3-6A" },
    { id: "36", name: "36", code: "36" },
  ],
};

const existing: Existing = {
  variants: [
    {
      id: "v1",
      product_id: "p1",
      color_id: "har",
      size_id: "3-6",
      sku: "AB-0001-HAR",
      barcode: "0012",
      price: 10000,
      compare_at_price: null,
      desi: 1.5,
      is_active: true,
      on_hand: 10,
      reserved: 2,
    },
  ],
  products: [
    {
      id: "p1",
      product_no: 1,
      name: "Zıbın",
      product_type: "clothing",
      audience: "baby",
      gender: "unisex",
      brand_id: null,
      vat_bps: 1000,
      description: "bir\r\niki",
      material: "",
      care: null,
      primary_category: "bebek",
      combos: ["har|3-6"],
    },
  ],
  barcodes: { "0012": "v1" },
  slugs: ["zibin"],
};

type Value = string | number | Cell;
const toCell = (v: Value): Cell =>
  typeof v === "object"
    ? v
    : typeof v === "number"
      ? { kind: "number", value: String(v) }
      : { kind: "text", value: v };
const rows = (...list: Partial<Record<Column, Value>>[]): DataRow[] =>
  list.map((cells, i) => ({
    no: i + 2,
    cells: Object.fromEntries(
      Object.entries(cells).map(([k, v]) => [k, toCell(v)]),
    ),
  }));
const plan = (...list: Partial<Record<Column, Value>>[]) =>
  planProducts(rows(...list), lists, existing);
const stock = (
  mode: "purchase" | "adjustment",
  ...list: Partial<Record<Column, Value>>[]
) => planStock(rows(...list), mode, existing);

const fresh = {
  product: "zibin1",
  name: "Zıbın",
  audience: "bebek",
  gender: "Kız",
  vat: "10",
  sku: "YENI-1",
  price: "249,90",
};

test("sütun başlıkları", () => {
  const sheet = (header: string[], ...data: string[][]): SheetRow[] =>
    [header, ...data].map((cells, i) => ({
      no: i + 1,
      cells: new Map(
        cells.flatMap((v, c) => (v ? [[c, toCell(v)] as const] : [])),
      ),
    }));
  expect(
    mapColumns("products", sheet(["fiyat", " sku "], ["1", "A-1"])),
  ).toEqual({
    rows: [{ no: 2, cells: { price: toCell("1"), sku: toCell("A-1") } }],
  });
  const error = (kind: "products" | "stock", s: SheetRow[]) =>
    (mapColumns(kind, s) as { error: string }).error;
  expect(error("products", [])).toMatch(/başlık/);
  expect(error("products", sheet(["SKU", "Fiyyat"], ["a"]))).toMatch(/Fiyyat/);
  expect(error("products", sheet(["SKU", "Sku"], ["a"]))).toMatch(/iki kez/);
  expect(error("products", sheet(["Fiyat"], ["1"]))).toMatch(/SKU/);
  expect(error("stock", sheet(["SKU"], ["1"]))).toMatch(/Miktar/);
  expect(error("stock", sheet(["SKU", "Fiyat"], ["1"]))).toMatch(/Fiyat/);
  expect(error("products", sheet(["SKU"]))).toMatch(/veri satırı/);
  expect(error("products", sheet(["SKU", ""], ["a", "b"]))).toMatch(/Satır 2/);
  expect(Object.values(productColumns)).toHaveLength(19);
  expect(Object.values(stockColumns)).toHaveLength(7);
});

test("boş hücre değiştirmez; aynı değer atlanır", () => {
  const [row] = plan({
    sku: "ab-0001-har",
    name: "Zıbın",
    price: "100,00",
    barcode: "0012",
    desi: "1,5",
    description: "bir\niki",
    category: "Bebek",
    active: "evet",
  });
  expect(row).toMatchObject({ action: "skip", errors: [], summary: [] });
});

test("güncelleme eski değerleri saklar", () => {
  const [row] = plan({
    sku: "AB-0001-HAR",
    price: 120.5,
    name: "Yeni Ad",
    category: "Bebek > Tişört",
    active: "Hayır",
  });
  expect(row).toMatchObject({
    action: "update",
    parsed: {
      product_id: "p1",
      variant_id: "v1",
      product: { name: "Yeni Ad" },
      primary_category: "b-tisort",
      variant: { price: 12050, is_active: false },
    },
    before: {
      product: { name: "Zıbın" },
      primary_category: "bebek",
      variant: { price: 10000, is_active: true },
    },
  });
  expect(row.summary).toContainEqual({
    field: "Fiyat",
    old: "100,00",
    new: "120,50",
  });
});

test("yeni ürünün satırları tek üründe birleşir", () => {
  const [a, b] = plan(
    { ...fresh, color: "har", size: 36, type: "giyim", brand: "minik" },
    {
      product: "ZIBIN1",
      sku: "YENI-2",
      price: 250,
      color: "lil",
      barcode: "0099",
    },
  );
  expect(a).toMatchObject({
    action: "create",
    parsed: {
      product_key: "zibin1",
      product: {
        name: "Zıbın",
        slug: "zibin-2",
        gender: "female",
        brand_id: "marka",
        vat_bps: 1000,
      },
      variant: { sku: "YENI-1", price: 24990, color_id: "har", size_id: "36" },
    },
  });
  expect(b).toMatchObject({
    action: "create",
    parsed: {
      product_key: "zibin1",
      variant: { sku: "YENI-2", price: 25000, barcode: "0099" },
    },
  });
  expect(b.parsed.product).toBeUndefined();
});

test("mevcut ürüne numarasıyla varyant eklenir", () => {
  const [row] = plan({
    product: "ab-0001",
    sku: "X-LIL",
    price: "1,00",
    color: "Lila",
    size: "3-6 ay",
  });
  expect(row).toMatchObject({
    action: "create",
    parsed: { product_id: "p1", variant: { color_id: "lil", size_id: "3-6" } },
  });
  expect(row.parsed.product_key).toBeUndefined();
});

test.each<[string, Partial<Record<Column, Value>>[], RegExp]>([
  ["SKU yok", [{ price: "1,00" }], /SKU: zorunlu/],
  ["SKU biçimi", [{ sku: "ç-1" }], /SKU: 3-40/],
  ["sayı SKU", [{ sku: 12345 }], /SKU: hücre sayı/],
  [
    "sayı barkod",
    [{ sku: "AB-0001-HAR", barcode: 8.69e12 }],
    /Barkod: hücre sayı/,
  ],
  [
    "bozulmuş barkod",
    [{ sku: "AB-0001-HAR", barcode: "8,69E+12" }],
    /Barkod: 4-32/,
  ],
  [
    "formül",
    [{ sku: "AB-0001-HAR", price: { kind: "invalid", reason: "Formül" } }],
    /Fiyat: Formül/,
  ],
  [
    "formül SKU",
    [{ sku: { kind: "invalid", reason: "Formül" } }],
    /^SKU: Formül$/,
  ],
  ["noktalı fiyat", [{ sku: "AB-0001-HAR", price: "249.90" }], /Fiyat: 249,90/],
  ["üç haneli kuruş", [{ sku: "AB-0001-HAR", price: 1.005 }], /Fiyat/],
  ["sıfır fiyat", [{ sku: "AB-0001-HAR", price: 0 }], /Fiyat/],
  ["eksi fiyat", [{ sku: "AB-0001-HAR", price: -5 }], /Fiyat/],
  [
    "küçük eski fiyat",
    [{ sku: "AB-0001-HAR", compareAt: "100,00" }],
    /Eski fiyat: fiyattan büyük/,
  ],
  ["yüzde biçimli KDV", [{ ...fresh, vat: 0.1 }], /KDV %: oranı/],
  ["yüksek KDV", [{ ...fresh, vat: 101 }], /KDV/],
  [
    "bilinmeyen renk",
    [{ ...fresh, color: "Hardl" }],
    /Renk: "Hardl" bulunamadı/,
  ],
  ["belirsiz kategori", [{ ...fresh, category: "Tişört" }], /birden fazla/],
  ["bilinmeyen marka", [{ ...fresh, brand: "x" }], /Marka/],
  ["bilinmeyen kime", [{ ...fresh, audience: "toString" }], /Kime/],
  ["eksi desi", [{ ...fresh, desi: -1 }], /Desi/],
  ["ürün yok", [{ sku: "YENI-1", price: "1,00" }], /Ürün: yeni varyant/],
  [
    "ürün numarası yok",
    [{ sku: "YENI-1", price: "1,00", product: "AB-0099" }],
    /AB-0099 bulunamadı/,
  ],
  [
    "fiyatsız yeni varyant",
    [{ product: "k", name: "Zıbın", sku: "YENI-1" }],
    /Fiyat: yeni varyant/,
  ],
  [
    "adsız yeni ürün",
    [{ product: "k", sku: "YENI-1", price: "1,00" }],
    /Ürün adı: yeni ürün/,
  ],
  ["harfsiz ad", [{ ...fresh, name: "!!" }], /harf içermeli/],
  [
    "yinelenen SKU",
    [fresh, { ...fresh, color: "lil" }],
    /SKU: dosyada birden fazla/,
  ],
  [
    "yinelenen barkod",
    [
      { ...fresh, barcode: "0099" },
      { ...fresh, sku: "Y-2", color: "lil", barcode: "0099" },
    ],
    /Barkod: dosyada/,
  ],
  ["başkasının barkodu", [{ ...fresh, barcode: "0012" }], /Barkod: başka/],
  [
    "kayıtlı renk ve beden",
    [
      {
        product: "AB-0001",
        sku: "Y-1",
        price: "1,00",
        color: "HAR",
        size: "3-6A",
      },
    ],
    /Beden: bu ürünün/,
  ],
  [
    "dosyada aynı beden",
    [fresh, { ...fresh, sku: "YENI-2" }],
    /Beden: bu ürünün/,
  ],
  [
    "rengi değişen varyant",
    [{ sku: "AB-0001-HAR", color: "lil" }],
    /Renk: kayıtlı varyantta/,
  ],
  [
    "çelişen ürün bilgisi",
    [fresh, { ...fresh, sku: "YENI-2", color: "lil", name: "Başka" }],
    /Ürün adı: aynı ürünün/,
  ],
  [
    "çelişen kategori",
    [
      { ...fresh, category: "Bebek" },
      { ...fresh, sku: "YENI-2", color: "lil", category: "Yetişkin" },
    ],
    /Ana kategori: aynı/,
  ],
  [
    "kayıtlı satırla paylaşılan geçici ad",
    [{ sku: "AB-0001-HAR", product: "zibin1" }, fresh],
    /ürün numarasını/,
  ],
  ["uzun ad", [{ ...fresh, name: "a".repeat(151) }], /en fazla 150/],
])("%s hatadır", (_, list, message) => {
  const planned = plan(...list);
  const bad = planned.filter((r) => r.action === "error");
  expect(bad.length).toBeGreaterThan(0);
  expect(bad.flatMap((r) => r.errors).join("\n")).toMatch(message);
  for (const row of bad) {
    expect(row).toMatchObject({ parsed: {}, before: {}, summary: [] });
  }
});

test("bu SKU başka ürüne ait", () => {
  const two = {
    ...existing,
    products: [
      ...existing.products,
      { ...existing.products[0], id: "p2", product_no: 2 },
    ],
  };
  const [row] = planProducts(
    rows({ sku: "AB-0001-HAR", product: "AB-0002" }),
    lists,
    two,
  );
  expect(row.errors).toEqual(["Ürün: bu SKU başka bir ürüne ait."]);
});

test("Excel'in ondalık yuvarlaması kabul edilir", () => {
  const cell: Cell = { kind: "number", value: "249.90000000000001" };
  const [row] = plan({ sku: "AB-0001-HAR", price: cell });
  expect(row.parsed.variant).toEqual({ price: 24990 });
});

test("mal girişi eklenir, sayım toplamı yazar", () => {
  expect(
    stock("purchase", { sku: "AB-0001-HAR", quantity: 5, note: "fatura" })[0],
  ).toMatchObject({
    action: "update",
    parsed: { variant_id: "v1", quantity: 5, note: "fatura" },
    before: { on_hand: 10 },
    summary: [{ field: "Stok", old: "10", new: "15" }],
  });
  expect(
    stock("adjustment", { sku: "AB-0001-HAR", quantity: "4", current: 10 })[0],
  ).toMatchObject({
    action: "update",
    summary: [{ field: "Stok", old: "10", new: "4" }],
  });
  for (const quantity of [undefined, 10]) {
    expect(
      stock("adjustment", {
        sku: "AB-0001-HAR",
        ...(quantity && { quantity }),
      })[0].action,
    ).toBe("skip");
  }
});

test.each<
  [string, "purchase" | "adjustment", Partial<Record<Column, Value>>[], RegExp]
>([
  ["olmayan SKU", "purchase", [{ sku: "YOK-1", quantity: 1 }], /bulunamadı/],
  [
    "yinelenen SKU",
    "purchase",
    [
      { sku: "AB-0001-HAR", quantity: 1 },
      { sku: "ab-0001-har", quantity: 1 },
    ],
    /birden fazla/,
  ],
  ["eksi miktar", "purchase", [{ sku: "AB-0001-HAR", quantity: -1 }], /Miktar/],
  [
    "kesirli miktar",
    "purchase",
    [{ sku: "AB-0001-HAR", quantity: 1.5 }],
    /Miktar/,
  ],
  [
    "yazı miktar",
    "purchase",
    [{ sku: "AB-0001-HAR", quantity: "beş" }],
    /Miktar/,
  ],
  [
    "çok büyük miktar",
    "purchase",
    [{ sku: "AB-0001-HAR", quantity: 100001 }],
    /Miktar/,
  ],
  [
    "ayrılmış stok",
    "adjustment",
    [{ sku: "AB-0001-HAR", quantity: 1 }],
    /ayrılmış/,
  ],
  [
    "eski dosya",
    "adjustment",
    [{ sku: "AB-0001-HAR", quantity: 5, current: 8 }],
    /şimdi 10/,
  ],
])("stokta %s hatadır", (_, mode, list, message) => {
  const errors = stock(mode, ...list).flatMap((r) => r.errors);
  expect(errors.join("\n")).toMatch(message);
});

test("aranacak anahtarlar", () => {
  expect(
    lookupKeys(
      rows(
        { sku: "ab-1", product: "AB-0012", barcode: "00", name: "Çıtçıt" },
        { sku: "AB-1", product: "zibin1" },
      ),
    ),
  ).toEqual({
    skus: ["AB-1", "AB-1"],
    barcodes: ["00"],
    productNos: [12],
    slugs: ["citcit"],
  });
});
