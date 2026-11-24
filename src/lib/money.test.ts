import { describe, expect, it } from "vitest";
import { formatPrice } from "./money";

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
