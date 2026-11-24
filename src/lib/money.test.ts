import { describe, expect, it } from "vitest";
import { formatPrice, parsePrice, priceInput } from "./money";

describe("formatPrice", () => {
  it.each([
    [0, "₺0,00"],
    [5, "₺0,05"],
    [24990, "₺249,90"],
    [123456789, "₺1.234.567,89"],
  ])("%i kuruşu %s olarak yazar", (kurus, expected) => {
    expect(formatPrice(kurus)).toBe(expected);
  });

  it.each([249.9, NaN, Infinity])(
    "tam sayı olmayan %d tutarını reddeder",
    (value) => {
      expect(() => formatPrice(value)).toThrow(RangeError);
    },
  );
});

describe("parsePrice", () => {
  it.each([
    ["249,90", 24990],
    ["249,9", 24990],
    [" 249 ", 24900],
    ["1.249,90", 124990],
    ["0,05", 5],
    ["1.234.567,89", 123456789],
  ])("%s → %i kuruş", (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  it.each([
    "",
    "249.90",
    "1,234.50",
    "-5",
    "12,345",
    "1e5",
    "abc",
    "1.23",
    ",",
  ])("%s reddedilir", (text) => {
    expect(parsePrice(text)).toBeNull();
  });

  it.each([1, 5, 24990, 100000000])("%i kuruş gidip gelir", (kurus) => {
    expect(parsePrice(priceInput(kurus))).toBe(kurus);
  });
});
