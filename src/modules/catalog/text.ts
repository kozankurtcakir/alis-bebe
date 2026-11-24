const turkish: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

/** "Müslin Zıbın" → "muslin-zibin" */
export function slugify(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => turkish[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 100)
    .replace(/-+$/, "");
}

/** SKU önerisi: "AB-0001-HAR-3-6A". Personel kaydetmeden değiştirebilir. */
export function suggestSku(
  productNo: number,
  colorCode?: string,
  sizeCode?: string,
) {
  return ["AB", String(productNo).padStart(4, "0"), colorCode, sizeCode]
    .filter(Boolean)
    .join("-");
}

/** Her satır bir tablo satırı; hücreler noktalı virgülle ayrılır. */
export const parseRows = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(";").map((cell) => cell.trim()));

export const formatRows = (rows: string[][]) =>
  rows.map((row) => row.join("; ")).join("\n");

/** Alt kategoriler, üst kategorisinin hemen altında ve derinliğiyle sıralanır. */
export function flattenTree<T extends { id: string; parent_id: string | null }>(
  items: T[],
  parent: string | null = null,
  depth = 0,
): (T & { depth: number })[] {
  return items
    .filter((i) => i.parent_id === parent)
    .flatMap((i) => [{ ...i, depth }, ...flattenTree(items, i.id, depth + 1)]);
}
