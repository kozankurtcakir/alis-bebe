import { expect, test } from "vitest";
import { pickVariant, uniqueBy } from "./selection";

test("ilk görülen sıra korunur", () => {
  const items = ["b1", "a1", "b2", "c1", "a2"];
  expect(uniqueBy(items, (i) => i[0])).toEqual(["b1", "a1", "c1"]);
});

const size = (code: string) => ({ size: { code } });

test("beden seçilmeden varyant belirlenmez", () => {
  expect(pickVariant([size("S"), size("M")], null)).toBeUndefined();
  expect(pickVariant([size("S")], null)).toBeUndefined();
  expect(pickVariant([size("S"), size("M")], "M")).toEqual(size("M"));
  expect(pickVariant([size("S")], "XL")).toBeUndefined();
});

test("bedensiz tek varyant kendiliğinden seçilir", () => {
  expect(pickVariant([{ size: null }], null)).toEqual({ size: null });
});
