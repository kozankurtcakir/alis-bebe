import { describe, expect, test } from "vitest";
import { filterUrl, parseFilter, parseQuery } from "./params";

const empty = parseFilter({});

/** "/a?x=1&x=2" → Next'in sayfaya verdiği nesne */
function readUrl(url: string) {
  const raw: Record<string, string[]> = {};
  for (const [k, v] of new URL(url, "http://x").searchParams) {
    (raw[k] ??= []).push(v);
  }
  return raw;
}

test("boş adres varsayılanları verir", () => {
  expect(empty).toEqual({
    sizes: [],
    colors: [],
    brands: [],
    genders: [],
    min: null,
    max: null,
    inStock: false,
    sort: "new",
    page: 1,
  });
  expect(filterUrl("/ara", undefined, empty)).toBe("/ara");
});

test("süzgeç adrese yazılıp aynen okunur", () => {
  const filter = {
    sizes: ["0-3A", "XL"],
    colors: ["hardal", "acik-mavi"],
    brands: ["alis-bebe"],
    genders: ["female" as const, "unisex" as const],
    min: 10050,
    max: 24990,
    inStock: true,
    sort: "price_desc" as const,
    page: 3,
  };
  const url = filterUrl("/ara", "müslin & zıbın", filter);
  expect(parseFilter(readUrl(url))).toEqual(filter);
  expect(parseQuery(readUrl(url))).toBe("müslin & zıbın");
});

describe("bozuk değer yok sayılır", () => {
  test.each([
    [{ beden: "<script>" }],
    [{ beden: "x".repeat(50) }],
    [{ renk: "Hardal'; drop" }],
    [{ marka: ["", "../x"] }],
    [{ cinsiyet: ["female", "toString", ""] }],
    [{ "en-az": "-5", "en-cok": "249.90" }],
    [{ "en-az": "99999999999" }],
    [{ "en-cok": "1.000.000,01" }],
    [{ stok: "1" }],
    [{ sirala: "constructor" }],
    [{ sayfa: "0" }],
    [{ sayfa: "-1" }],
    [{ sayfa: "1e9" }],
    [{ sayfa: "1000" }],
    [{ sirala: "" }],
  ])("%j", (raw) => {
    expect(parseFilter(raw)).toEqual(empty);
  });
});

test("tekrar ve sayı sınırlanır", () => {
  expect(parseFilter({ beden: ["S", "S", "M"] }).sizes).toEqual(["S", "M"]);
  const many = Array.from({ length: 200 }, (_, i) => `r${i}`);
  expect(parseFilter({ renk: many }).colors).toHaveLength(30);
});

test("arama metni kırpılır", () => {
  expect(parseQuery({ q: "  ışık\u0000 " })).toBe("ışık");
  expect(parseQuery({ q: "a".repeat(500) })).toHaveLength(100);
  expect(parseQuery({ q: ["a", "b"] })).toBe("a");
  expect(parseQuery({})).toBe("");
});
