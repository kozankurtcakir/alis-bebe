import type { Cell, SheetRow } from "./xlsx";

export type Kind = "products" | "stock";

export const kindLabels: Record<Kind, string> = {
  products: "Ürün",
  stock: "Stok",
};

export const modeLabels = {
  purchase: "Mal girişi (stoğa ekle)",
  adjustment: "Sayım (yeni toplam)",
} as const;

export type StockMode = keyof typeof modeLabels;

export const permissionFor = (kind: Kind) => `import.${kind}`;

/** Anahtar → Excel'deki sütun başlığı. */
export const productColumns = {
  product: "Ürün",
  name: "Ürün adı",
  category: "Ana kategori",
  audience: "Kime",
  gender: "Cinsiyet",
  type: "Tür",
  brand: "Marka",
  vat: "KDV %",
  description: "Açıklama",
  material: "Malzeme",
  care: "Bakım",
  sku: "SKU",
  color: "Renk",
  size: "Beden",
  barcode: "Barkod",
  price: "Fiyat",
  compareAt: "Eski fiyat",
  desi: "Desi",
  active: "Aktif",
} as const;

export const stockColumns = {
  sku: "SKU",
  quantity: "Miktar",
  note: "Not",
  // Bilgi sütunları; yüklenmez. "Mevcut stok" sayımda denetim için kullanılır.
  current: "Mevcut stok",
  name: "Ürün adı",
  color: "Renk",
  size: "Beden",
} as const;

export type Column = keyof typeof productColumns | keyof typeof stockColumns;
export type DataRow = { no: number; cells: Partial<Record<Column, Cell>> };

/** Büyük/küçük harf ve boşluk farkını yok sayar. */
export const fold = (text: string) =>
  text
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i");

/** Başlık satırını tanır. Bilinmeyen veya yinelenen başlık dosyayı durdurur. */
export function mapColumns(
  kind: Kind,
  rows: SheetRow[],
): { rows: DataRow[] } | { error: string } {
  const known = kind === "products" ? productColumns : stockColumns;
  const byTitle = new Map<string, Column>(
    Object.entries(known).map(([key, title]) => [fold(title), key as Column]),
  );
  const [header, ...data] = rows;
  if (!header || header.no !== 1) {
    return { error: "İlk satırda sütun başlıkları olmalı." };
  }

  const columns = new Map<number, Column>();
  for (const [index, cell] of header.cells) {
    const title = cell.kind === "invalid" ? "" : cell.value;
    const column = byTitle.get(fold(title));
    if (!column) {
      return { error: `Tanınmayan sütun: "${title.slice(0, 40)}".` };
    }
    if ([...columns.values()].includes(column)) {
      return { error: `"${title}" sütunu iki kez yazılmış.` };
    }
    columns.set(index, column);
  }
  const required: Column[] =
    kind === "products" ? ["sku"] : ["sku", "quantity"];
  for (const column of required) {
    if (![...columns.values()].includes(column)) {
      return { error: `"${known[column as "sku"]}" sütunu eksik.` };
    }
  }
  if (data.length === 0) return { error: "Dosyada veri satırı yok." };
  // Başlığı olmayan sütundaki veri sessizce atlanmaz.
  const stray = data.find((row) =>
    [...row.cells.keys()].some((index) => !columns.has(index)),
  );
  if (stray) {
    return { error: `Satır ${stray.no}: başlığı olmayan sütunda veri var.` };
  }
  return {
    rows: data.map((row) => ({
      no: row.no,
      cells: Object.fromEntries(
        [...row.cells].map(([index, cell]) => [columns.get(index)!, cell]),
      ),
    })),
  };
}
