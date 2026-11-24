import { expect, test } from "vitest";
import {
  flattenTree,
  formatRows,
  parseRows,
  slugify,
  suggestSku,
} from "./text";

test.each([
  ["Müslin Zıbın", "muslin-zibin"],
  ["ÇĞİÖŞÜ IŞIK", "cgiosu-isik"],
  ["  %100 Pamuk -- Âlâ  ", "100-pamuk-ala"],
  ["!!!", ""],
])("slugify: %s → %s", (input, expected) => {
  expect(slugify(input)).toBe(expected);
});

test("uzun adresin sonunda tire kalmaz", () => {
  expect(slugify("a".repeat(99) + " b")).toBe("a".repeat(99));
});

test("SKU önerisi", () => {
  expect(suggestSku(1, "HAR", "3-6A")).toBe("AB-0001-HAR-3-6A");
  expect(suggestSku(12345)).toBe("AB-12345");
});

test("beden tablosu metni", () => {
  const rows = parseRows("Beden; Boy\r\n\n3-6 Ay ;62-68\n");
  expect(rows).toEqual([
    ["Beden", "Boy"],
    ["3-6 Ay", "62-68"],
  ]);
  expect(parseRows(formatRows(rows))).toEqual(rows);
});

test("kategori ağacı sıralanır", () => {
  const tree = flattenTree([
    { id: "a", parent_id: null },
    { id: "b", parent_id: null },
    { id: "c", parent_id: "a" },
    { id: "d", parent_id: "c" },
  ]);
  expect(tree.map((t) => [t.id, t.depth])).toEqual([
    ["a", 0],
    ["c", 1],
    ["d", 2],
    ["b", 0],
  ]);
});
