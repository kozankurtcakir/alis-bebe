import { describe, expect, it } from "vitest";
import {
  canCancel,
  historyText,
  nextSteps,
  orderStatuses,
  type OrderStatus,
} from "./labels";
import { composeMail, jobSchema } from "./mail-text";
import { previewTotal } from "./totals";
import {
  holidayInput,
  parseCheckout,
  settingsSchema,
  transferSchema,
  vatInput,
} from "./validation";

const DOC = "11111111-1111-4111-8111-111111111111";

function form(over: Record<string, string | null> = {}) {
  const f = new FormData();
  const values: Record<string, string | null> = {
    key: "22222222-2222-4222-8222-222222222222",
    name: "Deneme Kişi",
    email: "deneme@ornek.test",
    phone: "0555 000 00 00",
    delivery: "shipping",
    payment: "transfer",
    expected_total: "30000",
    same: "on",
    d_city: "Eskişehir",
    d_district: "Odunpazarı",
    d_line: "Deneme Mahallesi 1",
    d_postal_code: "",
    documents: DOC,
    ...over,
  };
  for (const [k, v] of Object.entries(values)) if (v !== null) f.append(k, v);
  return f;
}

describe("parseCheckout", () => {
  it("geçerli misafir siparişini çevirir", () => {
    const { data } = parseCheckout(form(), true);
    expect(data).toMatchObject({
      email: "deneme@ornek.test",
      phone: "+905550000000",
      gift: false,
      expected_total: 30000,
      documents: [DOC],
      address: {
        recipient: "Deneme Kişi",
        phone: "+905550000000",
        city: "Eskişehir",
        postal_code: null,
      },
      invoice: { recipient: "Deneme Kişi", line: "Deneme Mahallesi 1" },
    });
  });

  it("üyenin gönderdiği e-postayı okumaz", () => {
    expect(parseCheckout(form(), false).data?.email).toBeUndefined();
    expect(parseCheckout(form({ email: null }), false).error).toBeUndefined();
  });

  it("formdan gelen fiyat ve ücret alanlarını taşımaz", () => {
    const { data } = parseCheckout(
      form({ total: "1", shipping_fee: "0", user_id: "x", discount: "9" }),
      true,
    );
    expect(Object.keys(data!).sort()).toEqual([
      "address",
      "delivery",
      "documents",
      "email",
      "expected_total",
      "gift",
      "invoice",
      "key",
      "name",
      "payment",
      "phone",
    ]);
  });

  it("başka alıcıyı yalnızca teslimata yazar", () => {
    const { data } = parseCheckout(
      form({
        other: "on",
        d_recipient: "Öbür Kişi",
        d_phone: "0555 111 11 11",
      }),
      true,
    );
    expect(data?.address).toMatchObject({
      recipient: "Öbür Kişi",
      phone: "+905551111111",
    });
    expect(data?.invoice).toMatchObject({
      recipient: "Deneme Kişi",
      phone: "+905550000000",
    });
  });

  it("mağazadan teslimde teslimat adresi almaz, fatura adresi ister", () => {
    const pickup = { delivery: "pickup", payment: "store" };
    expect(parseCheckout(form(pickup), true).error).toContain("Fatura adresi:");
    const { data } = parseCheckout(
      form({
        ...pickup,
        f_city: "Bursa",
        f_district: "Nilüfer",
        f_line: "Fatura Sokak No 1",
        f_postal_code: "",
      }),
      true,
    );
    expect(data?.address).toBeUndefined();
    expect(data?.invoice).toMatchObject({ city: "Bursa" });
  });

  it("ayrı fatura adresini kullanır", () => {
    const { data } = parseCheckout(
      form({
        same: null,
        f_city: "Bursa",
        f_district: "Nilüfer",
        f_line: "Fatura Sokak No 1",
        f_postal_code: "16000",
      }),
      true,
    );
    expect(data?.address).toMatchObject({ city: "Eskişehir" });
    expect(data?.invoice).toMatchObject({ city: "Bursa" });
  });

  it("kurumsal fatura bilgisini yalnızca istenince alır", () => {
    const firm = {
      company: "Şirket A.Ş.",
      tax_office: "Odunpazarı",
      tax_no: "1234567890",
    };
    expect(parseCheckout(form(firm), true).data?.invoice).not.toHaveProperty(
      "tax_no",
    );
    expect(
      parseCheckout(form({ ...firm, corporate: "on" }), true).data?.invoice,
    ).toMatchObject(firm);
    expect(
      parseCheckout(form({ ...firm, corporate: "on", tax_no: "123" }), true)
        .error,
    ).toBe("Vergi numarası 10 rakam olmalı.");
  });

  it.each([
    [{ documents: null }, "Sözleşmeleri"],
    [{ documents: "x" }, "Sözleşmeleri"],
    [{ email: "eposta" }, "Geçerli bir e-posta yazın."],
    [{ email: null }, "Geçersiz istek."],
    [{ phone: "0222 000 00 00" }, "cep telefonu"],
    [{ delivery: "drone" }, "Teslimat yöntemini seçin."],
    [{ payment: "puan" }, "Ödeme yöntemini seçin."],
    [{ key: "x" }, "Geçersiz istek."],
    [{ expected_total: "-1" }, "Geçersiz istek."],
    [{ expected_total: "1.5" }, "Geçersiz istek."],
    [{ d_city: "Atlantis" }, "Teslimat adresi: İl seçin."],
    [{ other: "on" }, "Teslim alacak kişi:"],
    [{ gift: "1" }, "Geçersiz istek."],
  ])("reddeder: %j", (over, message) => {
    const result = parseCheckout(form(over), true);
    expect(result.data).toBeUndefined();
    expect(result.error).toContain(message);
  });
});

describe("previewTotal", () => {
  const fees = {
    shipping_fee: 20000,
    free_shipping_from: 100000,
    gift_fee: 500,
    cod_fee: 1500,
  };
  const choice = { delivery: "shipping", payment: "transfer", gift: false };

  it.each([
    [99999, choice, 119999],
    [100000, choice, 100000],
    [99999, { ...choice, gift: true }, 120499],
    [10000, { ...choice, payment: "cod" }, 31500],
    [10000, { ...choice, delivery: "pickup", payment: "store" }, 10000],
  ])("%i %j → %i", (subtotal, c, total) => {
    expect(previewTotal(subtotal, c, fees).total).toBe(total);
  });
});

describe("settingsSchema", () => {
  const valid = {
    shipping_fee: "200,00",
    free_shipping_from: "1.000,00",
    gift_fee: "5",
    shipping_vat_bps: "20",
    gift_vat_bps: "",
    cod_vat_bps: "1,5",
    bank_holder: " Deneme ",
    bank_iban: "tr33 0006 1005 1978 6457 8413 26",
    transfer_days: "2",
    holidays: "01.01.2027\n29.10.2026, 01.01.2027",
    cod_limit: "0",
    cod_fee: "0",
    pickup_days: "7",
    pickup_address: "Eskişehir",
    max_unpaid: "3",
    link_days: "90",
    pickup_enabled: "on",
    card_minutes: "30",
  };

  it("formu veritabanı değerlerine çevirir", () => {
    expect(settingsSchema.parse(valid)).toMatchObject({
      shipping_fee: 20000,
      free_shipping_from: 100000,
      gift_fee: 500,
      shipping_vat_bps: 2000,
      gift_vat_bps: null,
      cod_vat_bps: 150,
      bank_holder: "Deneme",
      bank_iban: "TR330006100519786457841326",
      holidays: ["2026-10-29", "2027-01-01"],
      pickup_enabled: true,
      cod_enabled: false,
      card_enabled: false,
      card_minutes: 30,
      test_mode: false,
    });
  });

  it.each([
    { shipping_fee: "-1" },
    { shipping_fee: "249.90" },
    { shipping_vat_bps: "101" },
    { shipping_vat_bps: "x" },
    { bank_iban: "TR12" },
    { transfer_days: "1,5" },
    { holidays: "31.02.2027" },
    { holidays: "2027-01-01" },
    { holidays: "32.01.2027" },
    { cod_enabled: "true" },
    { card_enabled: "true" },
    { card_minutes: "1,5" },
  ])("reddeder: %j", (over) => {
    expect(settingsSchema.safeParse({ ...valid, ...over }).success).toBe(false);
  });

  it("değerleri forma geri yazar", () => {
    expect([null, 2000, 150].map(vatInput)).toEqual(["", "20", "1,50"]);
    expect(holidayInput(["2027-01-01"])).toBe("01.01.2027");
  });
});

it("havale tutarını kuruşa çevirir", () => {
  const input = { id: DOC, key: DOC, amount: "1.249,90", reference: " R-1 " };
  expect(transferSchema.parse(input)).toMatchObject({
    amount: 124990,
    reference: "R-1",
  });
  expect(transferSchema.safeParse({ ...input, reference: " " }).success).toBe(
    false,
  );
});

describe("etiketler", () => {
  const all = Object.keys(orderStatuses) as OrderStatus[];

  it("mağaza ve kargo adımlarını karıştırmaz", () => {
    expect(nextSteps("preparing", "pickup")).toEqual(["ready_for_pickup"]);
    expect(nextSteps("preparing", "shipping")).toEqual([]);
    expect(nextSteps("shipped", "shipping")).toEqual([]);
    expect(
      (["awaiting_approval", "cancelled", "delivered"] as const).flatMap((s) =>
        nextSteps(s, "shipping"),
      ),
    ).toEqual([]);
  });

  it("kargodan sonra iptal düğmesi yok", () => {
    expect(all.filter((s) => !canCancel(s))).toEqual([
      "shipped",
      "delivered",
      "cancelled",
      "returned_to_sender",
    ]);
  });

  it("geçmişi okunur yazar", () => {
    expect(
      historyText({ field: "order_status", from: "approved", to: "preparing" }),
    ).toBe("Sipariş: Onaylandı → Hazırlanıyor");
    expect(
      historyText({ field: "payment_status", from: null, to: "cancelled" }),
    ).toBe("Ödeme: Ödeme iptal");
  });
});

describe("composeMail", () => {
  const job = jobSchema.parse({
    id: DOC,
    kind: "order_placed",
    status: null,
    email: "a@ornek.test",
    name: "Deneme",
    order_no: "AB23456789AB",
    total: 30000,
    payment_method: "transfer",
    delivery_method: "shipping",
    token: "f".repeat(64),
    shipment: null,
  });

  it("misafire gizli bağlantı verir", () => {
    expect(composeMail(job, "http://localhost:3000")?.text).toContain(
      `http://localhost:3000/siparis/AB23456789AB/ac?kod=${"f".repeat(64)}`,
    );
  });

  it("üyeye kodsuz bağlantı verir", () => {
    const text = composeMail({ ...job, token: null }, "http://localhost")?.text;
    expect(text).toContain("http://localhost/siparis/AB23456789AB");
    expect(text).not.toContain("kod=");
  });

  it("haber verilmeyen durumda ileti üretmez", () => {
    const status = { ...job, kind: "order_status" as const };
    expect(composeMail({ ...status, status: "preparing" }, "http://x")).toBe(
      null,
    );
    expect(
      composeMail({ ...status, status: "shipped" }, "http://x")?.text,
    ).toContain("kargoya verildi");
  });

  it("kargoya verilince takip bilgisini yazar", () => {
    const shipped = {
      ...job,
      kind: "order_status" as const,
      status: "shipped",
      shipment: {
        carrier: "Deneme",
        tracking_no: "AB1",
        url: "https://k.test/AB1",
      },
    };
    expect(composeMail(shipped, "http://x")?.text).toContain(
      "Kargo firması: Deneme\nTakip numarası: AB1\nKargonuzu izleyin: https://k.test/AB1",
    );
    const noLink = { ...shipped, shipment: { ...shipped.shipment, url: null } };
    expect(composeMail(noLink, "http://x")?.text).not.toContain("izleyin");
    expect(
      composeMail({ ...shipped, status: "delivered" }, "http://x")?.text,
    ).not.toContain("Takip numarası");
  });
});
