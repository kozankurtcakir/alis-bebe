import writeXlsxFile from "write-excel-file/node";
import {
  audienceLabels,
  genderLabels,
  productTypeLabels,
} from "@/modules/catalog/labels";
import { suggestSku } from "@/modules/catalog/text";
import { productColumns, stockColumns, type Kind } from "./columns";
import { categoryPaths, type Lists } from "./plan";
import type { ExportRow } from "./queries";

type Value = string | number | null;

/** Metin sütunları Excel'de de metin kalır; baştaki sıfır ve "3-6" bozulmaz. */
const numeric = new Set<string>([
  "price",
  "compareAt",
  "desi",
  "vat",
  "quantity",
  "current",
]);
const wide = new Set<string>([
  "name",
  "category",
  "description",
  "material",
  "care",
  "sku",
  "note",
]);

const label = (labels: Record<string, string>, key: string) =>
  labels[key] ?? key;

function productRow(
  v: ExportRow,
  paths: Map<string, string>,
): Record<keyof typeof productColumns, Value> {
  const p = v.products;
  const primary = p.product_categories.find((c) => c.is_primary);
  return {
    product: suggestSku(p.product_no),
    name: p.name,
    category: primary ? (paths.get(primary.category_id) ?? null) : null,
    audience: label(audienceLabels, p.audience),
    gender: label(genderLabels, p.gender),
    type: label(productTypeLabels, p.product_type),
    brand: p.brands?.name ?? null,
    vat: p.vat_bps / 100,
    description: p.description || null,
    material: p.material || null,
    care: p.care,
    sku: v.sku,
    color: v.colors?.name ?? null,
    size: v.sizes?.name ?? null,
    barcode: v.barcode,
    price: v.price / 100,
    compareAt: v.compare_at_price === null ? null : v.compare_at_price / 100,
    desi: v.desi,
    active: v.is_active ? "Evet" : "Hayır",
  };
}

const stockRow = (v: ExportRow): Record<keyof typeof stockColumns, Value> => ({
  sku: v.sku,
  quantity: null,
  note: null,
  current: v.inventory?.on_hand ?? null,
  name: v.products.name,
  color: v.colors?.name ?? null,
  size: v.sizes?.name ?? null,
});

/** Boş şablonda kaç satırın hücreleri metin biçimli hazırlanır. */
const TEMPLATE_ROWS = 300;

export function buildWorkbook(
  kind: Kind,
  variants: ExportRow[] | null,
  categories: Lists["categories"],
) {
  const titles: Record<string, string> =
    kind === "products" ? productColumns : stockColumns;
  const keys = Object.keys(titles);
  const paths = categoryPaths(categories);
  const rows: Record<string, Value>[] = variants
    ? variants.map((v) =>
        kind === "products" ? productRow(v, paths) : stockRow(v),
      )
    : Array.from({ length: TEMPLATE_ROWS }, () => ({}));

  const header = keys.map((key) => ({
    value: titles[key],
    fontWeight: "bold" as const,
    backgroundColor: "#CFE8E1",
  }));
  const data = rows.map((row) =>
    keys.map((key) => {
      const value = row[key];
      if (numeric.has(key)) {
        return typeof value === "number"
          ? { value, type: Number, format: "0.##" }
          : undefined;
      }
      // Değer her zaman metin hücresidir; "=" ile başlasa da formül olmaz.
      return {
        type: String,
        format: "@",
        ...(typeof value === "string" && { value }),
      };
    }),
  );
  return writeXlsxFile([header, ...data], {
    sheet: kind === "products" ? "Ürünler" : "Stok",
    stickyRowsCount: 1,
    columns: keys.map((key) => ({ width: wide.has(key) ? 28 : 14 })),
  }).toBuffer();
}
