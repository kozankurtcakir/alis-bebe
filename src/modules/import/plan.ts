import { parsePrice, priceInput } from "@/lib/money";
import {
  audienceLabels,
  genderLabels,
  productTypeLabels,
} from "@/modules/catalog/labels";
import { slugify } from "@/modules/catalog/text";
import {
  fold,
  productColumns,
  stockColumns,
  type Column,
  type DataRow,
  type StockMode,
} from "./columns";

/** Dosya satırlarını mevcut kayıtlarla karşılaştırıp yapılacak işi çıkarır; hiçbir şey yazmaz. */

export type Lists = {
  categories: { id: string; name: string; parent_id: string | null }[];
  brands: { id: string; name: string }[];
  colors: { id: string; name: string; code: string }[];
  sizes: { id: string; name: string; code: string }[];
};

type Variant = {
  id: string;
  product_id: string;
  color_id: string | null;
  size_id: string | null;
  sku: string;
  barcode: string | null;
  price: number;
  compare_at_price: number | null;
  desi: number | null;
  is_active: boolean;
  on_hand: number | null;
  reserved: number | null;
};

type Product = {
  id: string;
  product_no: number;
  name: string;
  product_type: string;
  audience: string;
  gender: string;
  brand_id: string | null;
  vat_bps: number;
  description: string;
  material: string;
  care: string | null;
  primary_category: string | null;
  combos: string[];
};

export type Existing = {
  variants: Variant[];
  products: Product[];
  barcodes: Record<string, string>;
  slugs: string[];
};

type Fields = Record<string, string | number | boolean | null>;

export type Change = { field: string; old: string | null; new: string };

export type PlannedRow = {
  row_no: number;
  action: "create" | "update" | "skip" | "error";
  raw: Record<string, string>;
  parsed: Record<string, unknown>;
  before: Record<string, unknown>;
  summary: Change[];
  errors: string[];
};

// ---------------------------------------------------------------------------
// Hücreler
// ---------------------------------------------------------------------------

const SKU = /^[A-Z0-9][A-Z0-9-]{1,38}[A-Z0-9]$/;
const BARCODE = /^[0-9A-Za-z-]{4,32}$/;
const PRODUCT_NO = /^AB-(\d{4,12})$/i;

/** Bir satırın hücrelerini okur; sorunları biriktirir. Boş hücre undefined döner. */
class Reader {
  errors: string[] = [];

  constructor(
    private row: DataRow,
    private titles: Record<string, string>,
  ) {}

  fail(column: Column, message: string) {
    const text = `${this.titles[column]}: ${message}`;
    if (!this.errors.includes(text)) this.errors.push(text);
    return undefined;
  }

  private cell(column: Column) {
    const cell = this.row.cells[column];
    if (cell?.kind === "invalid") return this.fail(column, cell.reason);
    return cell;
  }

  /** Excel sayıya çevirirse baştaki sıfır kaybolur; bu yüzden yalnızca metin kabul edilir. */
  strictText(column: Column) {
    const cell = this.cell(column);
    if (cell?.kind === "number") {
      return this.fail(
        column,
        "hücre sayı biçiminde; metin biçimine çevirip yeniden yazın.",
      );
    }
    return cell?.value;
  }

  text(column: Column, max: number) {
    const cell = this.cell(column);
    if (!cell) return undefined;
    if (cell.kind === "number" && !/^\d{1,15}$/.test(cell.value)) {
      return this.fail(column, "metin olmalı.");
    }
    if (cell.value.length > max) {
      return this.fail(column, `en fazla ${max} karakter olabilir.`);
    }
    return cell.value;
  }

  number(column: Column, parse: (text: string) => number | null) {
    const cell = this.cell(column);
    if (!cell) return undefined;
    return cell.kind === "number" ? Number(cell.value) : parse(cell.value);
  }

  price(column: Column) {
    const cell = this.cell(column);
    if (!cell) return undefined;
    let kurus: number | null;
    if (cell.kind === "number") {
      const exact = Number(cell.value) * 100;
      kurus = Math.round(exact);
      // Excel 249,90'ı 249.90000000000001 saklayabilir; gerçek üçüncü hane reddedilir.
      if (!Number.isFinite(exact) || Math.abs(exact - kurus) > 1e-4) {
        kurus = null;
      }
    } else {
      kurus = parsePrice(cell.value);
    }
    if (kurus === null || kurus < 1 || kurus > 100_000_000) {
      return this.fail(column, "249,90 biçiminde yazın.");
    }
    return kurus;
  }

  choice<T>(column: Column, find: (text: string) => T | T[] | undefined) {
    const text = this.text(column, 200);
    if (text === undefined) return undefined;
    const found = find(text);
    if (Array.isArray(found)) {
      if (found.length === 1) return found[0];
      return this.fail(
        column,
        found.length === 0
          ? `"${text.slice(0, 60)}" bulunamadı.`
          : `"${text.slice(0, 60)}" birden fazla kayıtla eşleşiyor; tam yolu yazın.`,
      );
    }
    return found ?? this.fail(column, `"${text.slice(0, 60)}" bulunamadı.`);
  }

  sku() {
    const sku = this.strictText("sku")?.toUpperCase();
    if (sku === undefined) {
      if (this.errors.length === 0) this.fail("sku", "zorunlu.");
      return undefined;
    }
    return SKU.test(sku)
      ? sku
      : this.fail("sku", "3-40 karakter; Türkçe harfsiz harf, rakam ve tire.");
  }
}

const decimal = (text: string) =>
  /^\d{1,6}([.,]\d{1,4})?$/.test(text) ? Number(text.replace(",", ".")) : null;

const whole = (text: string) => (/^\d{1,7}$/.test(text) ? Number(text) : null);

const labelFinder = (labels: Record<string, string>) => {
  const map = new Map<string, string>();
  for (const [key, label] of Object.entries(labels)) {
    map.set(fold(label), key);
    // "Kız / Kadın" için "Kız" veya "Kadın" da yazılabilir.
    for (const part of label.split("/")) map.set(fold(part), key);
  }
  return (text: string) => map.get(fold(text));
};

const findAudience = labelFinder(audienceLabels);
const findGender = labelFinder(genderLabels);
const findType = labelFinder(productTypeLabels);
const findActive = labelFinder({ yes: "Evet", no: "Hayır" });

const byNameOrCode =
  <T extends { id: string; name: string; code?: string }>(items: T[]) =>
  (text: string) => {
    const key = fold(text);
    const byCode = items.filter((i) => i.code && fold(i.code) === key);
    return (
      byCode.length > 0 ? byCode : items.filter((i) => fold(i.name) === key)
    ).map((i) => i.id);
  };

/** "Bebek > Tişört" biçimindeki tam yol. */
export function categoryPaths(categories: Lists["categories"]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return new Map(
    categories.map((c) => {
      const names = [c.name];
      let parent = c.parent_id;
      while (parent && names.length < 20) {
        const up = byId.get(parent);
        if (!up) break;
        names.unshift(up.name);
        parent = up.parent_id;
      }
      return [c.id, names.join(" > ")];
    }),
  );
}

const rawOf = (row: DataRow, titles: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(row.cells).map(([column, cell]) => [
      titles[column],
      (cell.kind === "invalid" ? "—" : cell.value).slice(0, 200),
    ]),
  );

/** Panelden yazılan metindeki satır sonu farkı değişiklik sayılmaz. */
const isSame = (a: Fields[string] | undefined, b: Fields[string]) =>
  typeof a === "string" && typeof b === "string"
    ? a.replace(/\r\n?/g, "\n").trim() === b
    : a === b;

/** Değer → dosyada kaç kez geçtiği. */
function countBy(values: (string | undefined)[]) {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

/** Veritabanında aranacak anahtarlar. */
export function lookupKeys(rows: DataRow[]) {
  const text = (row: DataRow, column: Column) => {
    const cell = row.cells[column];
    return cell && cell.kind !== "invalid" ? cell.value : undefined;
  };
  const all = (column: Column) => [
    ...new Set(rows.map((r) => text(r, column)).filter((v) => v !== undefined)),
  ];
  return {
    skus: all("sku").map((s) => s.toUpperCase()),
    barcodes: all("barcode"),
    productNos: all("product")
      .map((p) => PRODUCT_NO.exec(p)?.[1])
      .filter((n) => n !== undefined)
      .map(Number),
    slugs: all("name").map(slugify).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Ürün
// ---------------------------------------------------------------------------

type Parsed = {
  row: DataRow;
  reader: Reader;
  sku?: string;
  /** Aynı ürüne ait satırların ortak anahtarı. */
  group?: string;
  existing?: Variant;
  product: Fields;
  category?: string;
  variant: Fields;
};

const productTitles: Record<string, string> = {
  name: productColumns.name,
  product_type: productColumns.type,
  audience: productColumns.audience,
  gender: productColumns.gender,
  brand_id: productColumns.brand,
  vat_bps: productColumns.vat,
  description: productColumns.description,
  material: productColumns.material,
  care: productColumns.care,
};

const variantTitles: Record<string, string> = {
  sku: productColumns.sku,
  color_id: productColumns.color,
  size_id: productColumns.size,
  barcode: productColumns.barcode,
  price: productColumns.price,
  compare_at_price: productColumns.compareAt,
  desi: productColumns.desi,
  is_active: productColumns.active,
};

const defined = (fields: Record<string, Fields[string] | undefined>) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Fields;

export function planProducts(
  rows: DataRow[],
  lists: Lists,
  existing: Existing,
): PlannedRow[] {
  const variantBySku = new Map(existing.variants.map((v) => [v.sku, v]));
  const productById = new Map(existing.products.map((p) => [p.id, p]));
  const productByNo = new Map(existing.products.map((p) => [p.product_no, p]));
  const paths = categoryPaths(lists.categories);
  const findColor = byNameOrCode(lists.colors);
  const findSize = byNameOrCode(lists.sizes);
  const findBrand = byNameOrCode(lists.brands);
  const findCategory = (text: string) => {
    const key = fold(
      text
        .split(">")
        .map((p) => p.trim())
        .join(" > "),
    );
    const matches = lists.categories.filter(
      (c) => fold(paths.get(c.id)!) === key,
    );
    return (
      matches.length > 0
        ? matches
        : lists.categories.filter((c) => fold(c.name) === key)
    ).map((c) => c.id);
  };

  const parsed: Parsed[] = rows.map((row) => {
    const reader = new Reader(row, productColumns);
    const sku = reader.sku();
    const found = sku ? variantBySku.get(sku) : undefined;
    const key = reader.text("product", 60);
    const no = key ? PRODUCT_NO.exec(key)?.[1] : undefined;
    const named = no ? productByNo.get(Number(no)) : undefined;
    if (no && !named) reader.fail("product", `${key} bulunamadı.`);
    if (found && named && named.id !== found.product_id) {
      reader.fail("product", "bu SKU başka bir ürüne ait.");
    }
    if (!found && sku && !key) {
      reader.fail("product", "yeni varyant için zorunlu.");
    }

    const name = reader.text("name", 150);
    if (name !== undefined && (name.length < 2 || !slugify(name))) {
      reader.fail("name", "en az 2 karakter olmalı ve harf içermeli.");
    }
    const vat = reader.number("vat", (t) => decimal(t.replace("%", "").trim()));
    // Yüzde biçimli hücre %10'u 0.1 saklar; %0,1 ile karışmasın diye reddedilir.
    if (
      vat !== undefined &&
      (vat === null ||
        !(vat === 0 || (vat >= 1 && vat <= 100)) ||
        !Number.isInteger(Math.round(vat * 1e6) / 1e4))
    ) {
      reader.fail("vat", "oranı 10 gibi yazın.");
    }
    const desi = reader.number("desi", decimal);
    if (
      desi !== undefined &&
      !(desi !== null && desi >= 0.01 && desi <= 9999)
    ) {
      reader.fail("desi", "0,5 gibi yazın.");
    }
    const barcode = reader.strictText("barcode");
    if (barcode !== undefined && !BARCODE.test(barcode)) {
      reader.fail("barcode", "4-32 harf, rakam veya tire olmalı.");
    }
    const active = reader.choice("active", findActive);

    return {
      row,
      reader,
      sku,
      existing: found,
      group: found
        ? found.product_id
        : (named?.id ?? (no ? undefined : key && fold(key))),
      product: defined({
        name,
        product_type: reader.choice("type", findType),
        audience: reader.choice("audience", findAudience),
        gender: reader.choice("gender", findGender),
        brand_id: reader.choice("brand", findBrand),
        vat_bps: typeof vat === "number" ? Math.round(vat * 100) : undefined,
        description: reader.text("description", 10_000),
        material: reader.text("material", 500),
        care: reader.text("care", 1000),
      }),
      category: reader.choice("category", findCategory),
      variant: defined({
        color_id: reader.choice("color", findColor),
        size_id: reader.choice("size", findSize),
        barcode,
        price: reader.price("price"),
        compare_at_price: reader.price("compareAt"),
        desi:
          typeof desi === "number" ? Math.round(desi * 100) / 100 : undefined,
        is_active: active === undefined ? undefined : active === "yes",
      }),
    };
  });

  checkUnique(parsed, existing);

  // Aynı ürünün satırları tek ürün bilgisinde birleşir.
  const groups = new Map<string, Parsed[]>();
  for (const p of parsed) {
    if (p.group) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  }
  const owners = new Map<string, { product: Fields; category?: string }>();
  for (const [key, members] of groups) {
    owners.set(key, mergeProduct(members));
  }

  // Geçici ad, dosyada zaten kayıtlı bir SKU ile birlikte kullanılmış olamaz.
  const usedKeys = new Set(
    parsed
      .filter((p) => p.existing)
      .map((p) => p.row.cells.product)
      .filter((c) => c && c.kind !== "invalid" && !PRODUCT_NO.test(c.value))
      .map((c) => fold((c as { value: string }).value)),
  );

  const slugs = new Set(existing.slugs);
  const combos = new Map(
    existing.products.map((p) => [p.id, new Set(p.combos)]),
  );

  const describe = (field: string, value: Fields[string]) => {
    if (value === null || value === undefined) return "boş";
    switch (field) {
      case "color_id":
        return lists.colors.find((c) => c.id === value)?.name ?? "?";
      case "size_id":
        return lists.sizes.find((s) => s.id === value)?.name ?? "?";
      case "brand_id":
        return lists.brands.find((b) => b.id === value)?.name ?? "?";
      case "price":
      case "compare_at_price":
        return priceInput(Number(value));
      case "vat_bps":
        return `%${String(Number(value) / 100).replace(".", ",")}`;
      case "is_active":
        return value ? "Evet" : "Hayır";
      case "audience":
        return audienceLabels[value as keyof typeof audienceLabels];
      case "gender":
        return genderLabels[value as keyof typeof genderLabels];
      case "product_type":
        return productTypeLabels[value as keyof typeof productTypeLabels];
      default: {
        const text = String(value);
        return text.length > 80 ? `${text.slice(0, 80)}…` : text;
      }
    }
  };

  const seen = new Set<string>();
  return parsed.map((p) => {
    const { reader, row, existing: variant, group } = p;
    const out: PlannedRow = {
      row_no: row.no,
      action: "skip",
      raw: rawOf(row, productColumns),
      parsed: {},
      before: {},
      summary: [],
      errors: reader.errors,
    };
    const isFirst = group !== undefined && !seen.has(group);
    if (group) seen.add(group);
    const owner = group ? productById.get(group) : undefined;
    const shared = group ? owners.get(group) : undefined;

    if (owner) {
      out.parsed.product_id = owner.id;
      if (isFirst && shared) {
        const current = owner as unknown as Fields;
        const changes = Object.entries(shared.product).filter(
          ([f, v]) => !isSame(current[f], v),
        );
        if (changes.length > 0) {
          out.parsed.product = Object.fromEntries(changes);
          out.before.product = Object.fromEntries(
            changes.map(([f]) => [f, current[f]]),
          );
          for (const [f, v] of changes) {
            out.summary.push({
              field: productTitles[f],
              old: describe(f, current[f]),
              new: describe(f, v),
            });
          }
        }
        if (shared.category && shared.category !== owner.primary_category) {
          out.parsed.primary_category = shared.category;
          out.before.primary_category = owner.primary_category;
          out.summary.push({
            field: productColumns.category,
            old: owner.primary_category
              ? (paths.get(owner.primary_category) ?? "?")
              : "boş",
            new: paths.get(shared.category)!,
          });
        }
      }
    } else if (group && shared && !variant) {
      out.parsed.product_key = group;
      if (usedKeys.has(group)) {
        reader.fail(
          "product",
          "bu ad, kayıtlı bir ürünün satırlarında da var; ürün numarasını (AB-0001) yazın.",
        );
      }
      if (isFirst) {
        for (const f of ["name", "audience", "gender", "vat_bps"]) {
          if (shared.product[f] === undefined) {
            const column = {
              name: "name",
              audience: "audience",
              gender: "gender",
              vat_bps: "vat",
            }[f];
            reader.fail(column as Column, "yeni ürün için zorunlu.");
          }
        }
        const base = slugify(String(shared.product.name ?? ""))
          .slice(0, 150)
          .replace(/-+$/, "");
        let slug = base;
        for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
        slugs.add(slug);
        out.parsed.product = { ...shared.product, slug };
        for (const [f, v] of Object.entries(shared.product)) {
          out.summary.push({
            field: productTitles[f],
            old: null,
            new: describe(f, v),
          });
        }
        if (shared.category) {
          out.parsed.primary_category = shared.category;
          out.summary.push({
            field: productColumns.category,
            old: null,
            new: paths.get(shared.category)!,
          });
        }
      }
    }

    if (variant) {
      out.parsed.variant_id = variant.id;
      const current = variant as unknown as Fields;
      for (const f of ["color_id", "size_id"] as const) {
        if (p.variant[f] !== undefined && p.variant[f] !== variant[f]) {
          reader.fail(
            f === "color_id" ? "color" : "size",
            "kayıtlı varyantta değiştirilemez; yeni SKU ile yeni satır ekleyin.",
          );
        }
      }
      const changes = Object.entries(p.variant).filter(
        ([f, v]) => f !== "color_id" && f !== "size_id" && current[f] !== v,
      );
      if (changes.length > 0) {
        out.parsed.variant = Object.fromEntries(changes);
        out.before.variant = Object.fromEntries(
          changes.map(([f]) => [f, current[f]]),
        );
        for (const [f, v] of changes) {
          out.summary.push({
            field: variantTitles[f],
            old: describe(f, current[f]),
            new: describe(f, v),
          });
        }
      }
      if (out.summary.length > 0) out.action = "update";
    } else if (p.sku) {
      out.action = "create";
      if (
        p.variant.price === undefined &&
        !reader.errors.some((e) => e.startsWith(productColumns.price))
      ) {
        reader.fail("price", "yeni varyant için zorunlu.");
      }
      const combo = `${p.variant.color_id ?? ""}|${p.variant.size_id ?? ""}`;
      if (group) {
        const taken = combos.get(group) ?? new Set();
        if (taken.has(combo)) {
          reader.fail("size", "bu ürünün aynı renk ve bedeni zaten var.");
        }
        combos.set(group, taken.add(combo));
      }
      out.parsed.variant = { sku: p.sku, ...p.variant };
      for (const [f, v] of Object.entries({ sku: p.sku, ...p.variant })) {
        out.summary.push({
          field: variantTitles[f],
          old: null,
          new: describe(f, v),
        });
      }
    }

    const price = (p.variant.price ?? variant?.price) as number | undefined;
    const compareAt = (p.variant.compare_at_price ??
      variant?.compare_at_price) as number | null | undefined;
    if (price !== undefined && compareAt && compareAt <= price) {
      reader.fail("compareAt", "fiyattan büyük olmalı.");
    }
    return finish(out);
  });
}

/** Hatalı satırın planı saklanmaz. */
function finish(out: PlannedRow): PlannedRow {
  if (out.errors.length > 0) {
    return { ...out, action: "error", parsed: {}, before: {}, summary: [] };
  }
  return out;
}

function checkUnique(parsed: Parsed[], existing: Existing) {
  const barcodes = countBy(
    parsed.map((p) => p.variant.barcode as string | undefined),
  );
  const skus = countBy(parsed.map((p) => p.sku));
  for (const p of parsed) {
    if (p.sku && skus.get(p.sku)! > 1) {
      p.reader.fail("sku", "dosyada birden fazla kez var.");
    }
    const code = p.variant.barcode as string | undefined;
    if (!code) continue;
    if (barcodes.get(code)! > 1) {
      p.reader.fail("barcode", "dosyada birden fazla kez var.");
    }
    const owner = existing.barcodes[code];
    if (owner && owner !== p.existing?.id) {
      p.reader.fail("barcode", "başka bir varyantta kullanılıyor.");
    }
  }
}

/** Boş hücre "aynısı" demektir; dolu hücreler birbirini tutmalıdır. */
function mergeProduct(members: Parsed[]) {
  const product: Fields = {};
  let category: string | undefined;
  for (const p of members) {
    for (const [f, v] of Object.entries(p.product)) {
      if (product[f] === undefined) product[f] = v;
      else if (product[f] !== v) {
        const column = Object.entries(productColumns).find(
          ([, title]) => title === productTitles[f],
        )![0];
        p.reader.fail(
          column as Column,
          "aynı ürünün önceki satırından farklı.",
        );
      }
    }
    if (p.category && category && p.category !== category) {
      p.reader.fail("category", "aynı ürünün önceki satırından farklı.");
    }
    category ??= p.category;
  }
  return { product, category };
}

// ---------------------------------------------------------------------------
// Stok
// ---------------------------------------------------------------------------

export function planStock(
  rows: DataRow[],
  mode: StockMode,
  existing: Existing,
): PlannedRow[] {
  const variantBySku = new Map(existing.variants.map((v) => [v.sku, v]));
  const parsed = rows.map((row) => {
    const reader = new Reader(row, stockColumns);
    return { row, reader, sku: reader.sku() };
  });

  const skus = countBy(parsed.map((p) => p.sku));

  return parsed.map(({ row, reader, sku }) => {
    const out: PlannedRow = {
      row_no: row.no,
      action: "skip",
      raw: rawOf(row, stockColumns),
      parsed: {},
      before: {},
      summary: [],
      errors: reader.errors,
    };
    if (sku && skus.get(sku)! > 1) {
      reader.fail("sku", "dosyada birden fazla kez var.");
    }
    const variant = sku ? variantBySku.get(sku) : undefined;
    if (sku && !variant) reader.fail("sku", `${sku} bulunamadı.`);
    const quantity = reader.number("quantity", whole);
    const note = reader.text("note", 300);
    const current = reader.number("current", whole);
    if (
      quantity !== undefined &&
      (quantity === null ||
        !Number.isInteger(quantity) ||
        quantity < 0 ||
        quantity > 100_000)
    ) {
      reader.fail("quantity", "0 ile 100.000 arasında tam sayı olmalı.");
    }
    if (reader.errors.length > 0 || !variant || typeof quantity !== "number") {
      return finish(out);
    }

    const onHand = variant.on_hand ?? 0;
    const after = mode === "adjustment" ? quantity : onHand + quantity;
    if (
      mode === "adjustment" &&
      typeof current === "number" &&
      current !== onHand
    ) {
      reader.fail(
        "current",
        `dosya indirildikten sonra stok değişmiş (şimdi ${onHand}).`,
      );
    }
    if (after < (variant.reserved ?? 0)) {
      reader.fail(
        "quantity",
        `${variant.reserved} adet siparişlere ayrılmış; altına inemez.`,
      );
    }
    if (after !== onHand) {
      out.action = "update";
      out.parsed = { variant_id: variant.id, quantity, ...(note && { note }) };
      out.before = { on_hand: onHand };
      out.summary = [
        { field: "Stok", old: String(onHand), new: String(after) },
      ];
    }
    return finish(out);
  });
}
