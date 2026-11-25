import { describe, expect, it, test } from "vitest";
import { eventText, shipmentSteps } from "./labels";
import { manualProvider } from "./provider";
import { carrierSchema, codSchema, trackingSchema } from "./validation";

const ID = "11111111-1111-4111-8111-111111111111";
const carrier = { id: "", name: " Deneme Kargo ", url: " ", active: "on" };

describe("kargo firması", () => {
  it("temizlenir", () => {
    expect(carrierSchema.parse(carrier)).toEqual({
      id: null,
      name: "Deneme Kargo",
      url: "",
      active: true,
    });
    expect(
      carrierSchema.parse({ ...carrier, id: ID, active: undefined }),
    ).toMatchObject({ id: ID, active: false });
  });

  test.each([
    "https://kargo.test/takip?no={no}",
    "https://www.kargo.test/{no}/durum",
  ])("takip adresi: %s", (url) => {
    expect(carrierSchema.safeParse({ ...carrier, url }).success).toBe(true);
  });

  test.each([
    "http://kargo.test/{no}",
    "javascript:alert(1)//{no}",
    "https://kargo.test/takip",
    "https://{no}.kargo.test/",
    "https://kargo.test{no}",
    "https://kisi@kargo.test/{no}",
    "https://kargo.test/a b{no}",
    'https://kargo.test/"{no}',
    "https://kargo.test/{no}{no}",
    `https://kargo.test/{no}${"a".repeat(300)}`,
  ])("geçersiz takip adresi: %s", (url) => {
    expect(carrierSchema.safeParse({ ...carrier, url }).success).toBe(false);
  });

  test.each([{ name: "x" }, { name: "a".repeat(61) }, { id: "1" }])(
    "geçersiz: %j",
    (change) => {
      expect(carrierSchema.safeParse({ ...carrier, ...change }).success).toBe(
        false,
      );
    },
  );
});

describe("takip numarası", () => {
  const parse = (tracking: string) =>
    trackingSchema.safeParse({ id: ID, carrier: ID, tracking });

  it("boşluk ve küçük harf düzelir", () => {
    expect(parse(" ab 123-45 ").data?.tracking).toBe("AB123-45");
  });

  test.each([
    "",
    "1234",
    "ABC_12",
    "ÇA12345",
    "ıabcde",
    "AB/12345",
    "1".repeat(41),
  ])("geçersiz: %s", (v) => {
    expect(parse(v).success).toBe(false);
  });
});

it("tahsilat: düzeltme eksi yazılır", () => {
  const row = { id: ID, key: ID, amount: "249,90", reference: "D1" };
  expect(codSchema.parse({ ...row, kind: "in" }).amount).toBe(24990);
  expect(codSchema.parse({ ...row, kind: "fix" }).amount).toBe(-24990);
  expect(codSchema.safeParse({ ...row, kind: "x" }).success).toBe(false);
  expect(
    codSchema.safeParse({ ...row, kind: "in", amount: "-1" }).success,
  ).toBe(false);
});

it("düğmeler duruma göre", () => {
  expect(shipmentSteps("created", false)).toEqual(["cancelled"]);
  expect(shipmentSteps("created", true)).toEqual(["handed_over", "cancelled"]);
  expect(shipmentSteps("handed_over", true)).toEqual(["delivered", "returned"]);
  for (const s of ["delivered", "returned", "cancelled"] as const)
    expect(shipmentSteps(s, true)).toEqual([]);
});

it("geçmişi okunur yazar", () => {
  expect(
    eventText({ field: "status", from: "created", to: "handed_over" }),
  ).toBe("Gönderi: Oluşturuldu → Kargoya verildi");
  expect(eventText({ field: "tracking_no", from: "A1", to: "B2" })).toBe(
    "Takip numarası: A1 → B2",
  );
  expect(eventText({ field: "carrier", from: null, to: "X" })).toBe("Firma: X");
});

it("manuel sağlayıcı firmaya bağlanmaz", async () => {
  expect(await manualProvider.open(ID)).toBeNull();
});
