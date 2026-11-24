import { expect, test } from "vitest";
import { isManual, isReversible, stockState } from "./labels";

test.each([
  [0, 3, true, "Tükendi"],
  [0, 0, true, "Tükendi"],
  [1, 3, true, "Kritik"],
  [3, 3, true, "Kritik"],
  [4, 3, true, null],
  [1, 0, true, null],
  [0, 3, false, "Satışta değil"],
])(
  "satılabilir %i, kritik %i, satışta %s → %s",
  (available, critical_level, is_sellable, expected) => {
    expect(stockState({ available, critical_level, is_sellable })).toBe(
      expected,
    );
  },
);

test("sipariş hareketleri elle yapılamaz", () => {
  expect(isManual("purchase")).toBe(true);
  for (const reason of ["sale", "cancel", "return", "import", "reversal"]) {
    expect(isManual(reason)).toBe(false);
  }
  expect(isReversible("import")).toBe(true);
  for (const reason of ["sale", "cancel", "return", "reversal"]) {
    expect(isReversible(reason)).toBe(false);
  }
});
