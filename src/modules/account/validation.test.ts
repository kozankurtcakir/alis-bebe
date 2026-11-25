import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cities } from "./cities";
import {
  addressSchema,
  consentSchema,
  formatPhone,
  parsePhone,
  profileSchema,
} from "./validation";

test.each([
  "05550001122",
  "5550001122",
  "0555 000 11 22",
  "(0555) 000-11-22",
  "+90 555 000 11 22",
  "905550001122",
  "0090 555 000 11 22",
])("cep telefonu tek biçime çevrilir: %s", (text) => {
  expect(parsePhone(text)).toBe("+905550001122");
});

test.each([
  "",
  "0222 000 11 22",
  "0555 000 11",
  "0555 000 11 222",
  "+1 555 000 1122",
  "0555 000 11 2a",
  "+90+905550001122",
])("cep telefonu olmayan reddedilir: %s", (text) => {
  expect(parsePhone(text)).toBeNull();
});

test("telefon okunur biçimde gösterilir", () => {
  expect(formatPhone("+905550001122")).toBe("0555 000 11 22");
});

test("il listesi veritabanındakiyle aynı", () => {
  const sql = readFileSync(
    "supabase/migrations/20261125110000_uyelik_ve_sepet.sql",
    "utf8",
  );
  const check = /city text not null check \(city in \(([^)]+)\)/.exec(sql)![1];
  expect([...check.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(cities);
  expect(new Set(cities).size).toBe(81);
});

const address = {
  id: "",
  title: " Ev ",
  recipient: "Deneme  Kişi",
  phone: "0555 000 11 22",
  city: "Eskişehir",
  district: "Odunpazarı",
  line: "Deneme Mah.\nÖrnek Sok. No: 1",
  postal_code: " ",
};

test("adres temizlenir", () => {
  expect(addressSchema.parse(address)).toEqual({
    id: null,
    title: "Ev",
    recipient: "Deneme Kişi",
    phone: "+905550001122",
    city: "Eskişehir",
    district: "Odunpazarı",
    line: "Deneme Mah. Örnek Sok. No: 1",
    postal_code: null,
    is_default: false,
  });
  expect(
    addressSchema.parse({ ...address, is_default: "on", postal_code: "26000" }),
  ).toMatchObject({ is_default: true, postal_code: "26000" });
});

describe("geçersiz adres", () => {
  test.each([
    [{ id: "1" }],
    [{ title: "  " }],
    [{ title: "a".repeat(41) }],
    [{ recipient: "a" }],
    [{ phone: "0222 000 11 22" }],
    [{ city: "Atlantis" }],
    [{ city: "" }],
    [{ district: "" }],
    [{ line: "kısa" }],
    [{ line: "a".repeat(301) }],
    [{ line: `kısa${"\n".repeat(20)}` }],
    [{ postal_code: "2600" }],
    [{ is_default: "evet" }],
    [{ title: undefined }],
  ])("%j", (change) => {
    expect(addressSchema.safeParse({ ...address, ...change }).success).toBe(
      false,
    );
  });
});

test("profil: telefon isteğe bağlı, ad zorunlu", () => {
  expect(profileSchema.parse({ full_name: " Ad ", phone: "" })).toEqual({
    full_name: "Ad",
    phone: null,
  });
  for (const bad of [
    { full_name: " a ", phone: "" },
    { full_name: "Ad", phone: "123" },
    { full_name: "a".repeat(101), phone: "" },
  ]) {
    expect(profileSchema.safeParse(bad).success).toBe(false);
  }
});

test("hata iletileri Türkçe", () => {
  for (const result of [
    profileSchema.safeParse({ full_name: "Ad", phone: "123" }),
    profileSchema.safeParse({}),
    addressSchema.safeParse({}),
    addressSchema.safeParse({ ...address, id: "1", city: "x" }),
    addressSchema.safeParse({ ...address, postal_code: "1", phone: "1" }),
    addressSchema.safeParse({ ...address, is_default: "evet" }),
  ]) {
    expect(result.error!.issues.map((i) => i.message).join()).not.toMatch(
      /invalid|expected/i,
    );
  }
});

test("izin türü ve seçimi bilinmeyen değer almaz", () => {
  expect(
    consentSchema.parse({ kind: "email_marketing", granted: "false" }),
  ).toEqual({ kind: "email_marketing", granted: false });
  for (const bad of [
    { kind: "push", granted: "true" },
    { kind: "toString", granted: "true" },
    { kind: "email_marketing", granted: "1" },
  ]) {
    expect(consentSchema.safeParse(bad).success).toBe(false);
  }
});
