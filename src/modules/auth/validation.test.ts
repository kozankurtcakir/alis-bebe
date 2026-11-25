import { describe, expect, test } from "vitest";
import {
  codeSchema,
  emailLinkSchema,
  newPasswordSchema,
  nextPath,
  signUpSchema,
} from "./validation";

const ok = (password: string) =>
  newPasswordSchema.safeParse({ password }).success;

describe("şifre", () => {
  test("kurala uyan şifre kabul edilir", () => {
    expect(ok("gardirop123")).toBe(true);
  });
  test.each(["kisa1", "yalnizcaharf", "1234567890", "a1".repeat(40)])(
    "%s reddedilir",
    (p) => expect(ok(p)).toBe(false),
  );
});

describe("kayıt", () => {
  const valid = {
    full_name: " Deneme Kişi ",
    email: " Deneme@Ornek.TEST ",
    password: "gardirop123",
  };

  test("boşluk ve büyük harf düzeltilir", () => {
    expect(signUpSchema.parse(valid)).toMatchObject({
      full_name: "Deneme Kişi",
      email: "deneme@ornek.test",
    });
  });
  test("fazladan alan (rol) alınmaz", () => {
    expect(
      signUpSchema.parse({ ...valid, role: "super_admin" }),
    ).not.toHaveProperty("role");
  });
  test.each([{ email: "bozuk" }, { full_name: " " }, { email: null }])(
    "%o reddedilir",
    (change) =>
      expect(signUpSchema.safeParse({ ...valid, ...change }).success).toBe(
        false,
      ),
  );
});

test("doğrulama kodundaki boşluk silinir, harf reddedilir", () => {
  expect(codeSchema.parse({ code: "123 456" }).code).toBe("123456");
  expect(codeSchema.safeParse({ code: "12a456" }).success).toBe(false);
});

test("e-posta bağlantısında yalnızca bilinen türler geçer", () => {
  const token_hash = "abcDEF123456";
  expect(
    emailLinkSchema.safeParse({ token_hash, type: "recovery" }).success,
  ).toBe(true);
  expect(
    emailLinkSchema.safeParse({ token_hash, type: "invite" }).success,
  ).toBe(false);
});

describe("girişten sonra dönülecek sayfa", () => {
  test.each(["/sepet", "/urun/isikli-zibin-2"])("%s kabul edilir", (path) => {
    expect(nextPath(path)).toBe(path);
  });
  test.each([
    "",
    "/",
    "//kotu.example",
    "https://kotu.example",
    "/urun/../yonetim",
    "/urun//kotu.example",
    "/urun/a?x=//kotu.example",
    "/sepet/..",
    "/sepet%0A",
    `/sepet${String.fromCharCode(10)}`,
    "/yonetim",
    null,
    undefined,
    ["/sepet"],
  ])("%j reddedilir", (path) => {
    expect(nextPath(path)).toBeNull();
  });
});
