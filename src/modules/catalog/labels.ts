import { priceInput } from "@/lib/money";

export const audienceLabels = {
  baby: "Bebek",
  child: "Çocuk",
  adult: "Yetişkin",
} as const;

export const genderLabels = {
  unisex: "Unisex",
  female: "Kız / Kadın",
  male: "Erkek",
} as const;

export const productTypeLabels = {
  clothing: "Giyim",
  personal_care: "Kişisel bakım",
} as const;

export const statusLabels = {
  draft: "Taslak",
  published: "Yayında",
  archived: "Arşivde",
} as const;

export const sizeGroupLabels = {
  baby: "Bebek (ay)",
  child: "Çocuk (yaş)",
  adult: "Yetişkin",
  volume: "Hacim",
  one_size: "Standart",
} as const;

export const keysOf = <T extends object>(labels: T) =>
  Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]];

export const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

const entityLabels: Record<string, string> = {
  categories: "Kategori",
  brands: "Marka",
  colors: "Renk",
  sizes: "Beden",
  size_charts: "Beden tablosu",
  products: "Ürün",
  product_categories: "Ürün kategorisi",
  product_variants: "Varyant",
  variant_costs: "Maliyet",
  product_images: "Görsel",
  carriers: "Kargo firması",
};

const verbLabels: Record<string, string> = {
  insert: "eklendi",
  update: "değişti",
  delete: "silindi",
};

/** "products.update" → "Ürün değişti"; katalog işlemi değilse null. */
export function catalogActionLabel(action: string) {
  const [entity, verb] = action.split(".");
  return entityLabels[entity] && verbLabels[verb]
    ? `${entityLabels[entity]} ${verbLabels[verb]}`
    : null;
}

const fieldLabels: Record<string, string> = {
  name: "Ad",
  slug: "Adres",
  status: "Durum",
  price: "Fiyat",
  compare_at_price: "Eski fiyat",
  cost: "Maliyet",
  critical_level: "Kritik seviye",
  sku: "SKU",
  barcode: "Barkod",
  vat_bps: "KDV (baz puan)",
  is_active: "Aktif",
  sort_order: "Sıra",
  alt: "Görsel açıklaması",
  hex: "Renk kodu",
  code: "Kod",
  product_type: "Tür",
  is_primary: "Ana kategori",
  url_template: "Takip adresi",
};

const show = (field: string, value: unknown) => {
  if (value === null || value === undefined) return "boş";
  if (typeof value === "boolean") return value ? "evet" : "hayır";
  if (
    typeof value === "number" &&
    ["price", "compare_at_price", "cost"].includes(field)
  ) {
    return priceInput(value);
  }
  if (field === "status") {
    return statusLabels[value as keyof typeof statusLabels] ?? String(value);
  }
  return String(value);
};

type Change = Record<string, unknown> | null;

/** Güncellemede değişen alanlar: "Fiyat: 249,90 → 199,90" */
export function describeChange(before: Change, after: Change) {
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((f) => fieldLabels[f])
    .map(
      (f) => `${fieldLabels[f]}: ${show(f, before[f])} → ${show(f, after[f])}`,
    );
}
