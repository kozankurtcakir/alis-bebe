import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Yerel Supabase açık olmalı: npm run db:start
const MAIL = "http://127.0.0.1:54324/api/v1";
const PASSWORD = "gardirop123";

const newEmail = () => `test-${randomUUID()}@ornek.test`;

function sql(query: string) {
  return execFileSync(
    "docker",
    ["exec", "supabase_db_alis-bebe", "psql", "-U", "postgres", "-qAtc", query],
    { encoding: "utf8" },
  ).trim();
}

/** Yerel posta kutusundaki son iletinin bağlantısı. */
async function mailLink(
  request: APIRequestContext,
  email: string,
  type: string,
) {
  let link = "";
  await expect
    .poll(async () => {
      const search = await request.get(`${MAIL}/search`, {
        params: { query: `to:"${email}"` },
      });
      for (const { ID } of (await search.json()).messages) {
        const { HTML } = await (
          await request.get(`${MAIL}/message/${ID}`)
        ).json();
        link = /href="([^"]+)"/.exec(HTML)?.[1].replaceAll("&amp;", "&") ?? "";
        if (link.includes(`type=${type}`)) return true;
      }
      return false;
    })
    .toBe(true);
  return link;
}

/** Doğrulama uygulamasının ürettiği 6 haneli kod (RFC 6238). */
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}

async function signUp(page: Page, email: string) {
  await page.goto("/kayit");
  await page.getByLabel("Ad soyad").fill("Deneme Kişi");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Üye ol" }).click();
  await expect(page.getByRole("status")).toContainText("doğrulama bağlantısı");
}

async function signUpAndConfirm(page: Page, email: string) {
  await signUp(page, email);
  await page.goto(await mailLink(page.request, email, "email"));
  await page.getByRole("button", { name: "E-postamı doğrula" }).click();
  await expect(page).toHaveURL("/hesap");
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

const signOut = (page: Page) =>
  page.getByRole("button", { name: "Çıkış yap" }).click();

test("giriş yapmayan kişi korunan sayfaları açamaz", async ({ page }) => {
  for (const path of ["/hesap", "/sifre-yenile", "/iki-adim", "/yonetim"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/giris");
  }
});

test("müşteri üye olur, girer, panele giremez", async ({ page, context }) => {
  const email = newEmail();
  await signUp(page, email);

  await signIn(page, email);
  await expect(page.getByRole("alert").first()).toContainText(
    "e-posta adresinizi doğrulayın",
  );

  await page.goto(await mailLink(page.request, email, "email"));
  await page.getByRole("button", { name: "E-postamı doğrula" }).click();
  await expect(page).toHaveURL("/hesap");
  await expect(page.getByText(email)).toBeVisible();

  const session = (await context.cookies()).filter((c) =>
    c.name.startsWith("sb-"),
  );
  expect(session.length).toBeGreaterThan(0);
  expect(session.every((c) => c.httpOnly && c.sameSite === "Lax")).toBe(true);

  for (const path of ["/yonetim", "/iki-adim"]) {
    await page.goto(path);
    await expect(page.getByText("404")).toBeVisible();
  }

  await page.goto("/hesap");
  await signOut(page);
  await expect(page).toHaveURL("/giris");
  await page.goto("/hesap");
  await expect(page).toHaveURL("/giris");

  await signIn(page, email, "yanlis-sifre1");
  await expect(page.getByText("E-posta veya şifre hatalı.")).toBeVisible();
  await signIn(page, email);
  await expect(page).toHaveURL("/hesap");
});

test("kayıtlı e-posta belli olmaz, zayıf şifre reddedilir", async ({
  page,
}) => {
  const email = newEmail();
  await signUpAndConfirm(page, email);
  await signUp(page, email);

  await page.goto("/kayit");
  await page.getByLabel("Ad soyad").fill("Deneme Kişi");
  await page.getByLabel("E-posta").fill(newEmail());
  await page.getByLabel("Şifre").fill("kisa1");
  await page.getByRole("button", { name: "Üye ol" }).click();
  await expect(page.getByText("Şifre en az 10 karakter olmalı.")).toBeVisible();
  await expect(page.getByLabel("Şifre")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("şifre yenilenir, bağlantı ikinci kez çalışmaz", async ({ page }) => {
  const email = newEmail();
  await signUpAndConfirm(page, email);
  await signOut(page);
  await expect(page).toHaveURL("/giris");

  await page.goto("/sifremi-unuttum");
  await page.getByLabel("E-posta").fill(email);
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await expect(page.getByRole("status")).toContainText("kayıtlıysa");

  const link = await mailLink(page.request, email, "recovery");
  await page.goto(link);
  await page.getByRole("button", { name: "Şifremi yenile" }).click();
  await expect(page).toHaveURL("/sifre-yenile");
  await page.getByLabel("Yeni şifre").fill("yenigardirop456");
  await page.getByRole("button", { name: "Şifreyi kaydet" }).click();
  await expect(page).toHaveURL("/hesap");

  await page.goto(link);
  await page.getByRole("button", { name: "Şifremi yenile" }).click();
  await expect(page.getByText("geçersiz veya süresi dolmuş")).toBeVisible();

  await signIn(page, email);
  await expect(page.getByText("E-posta veya şifre hatalı.")).toBeVisible();
  await signIn(page, email, "yenigardirop456");
  await expect(page).toHaveURL("/hesap");
});

test("personel iki adımı geçmeden panele giremez, pasif olunca çıkarılır", async ({
  page,
}) => {
  const email = newEmail();
  await signUpAndConfirm(page, email);
  await signOut(page);
  await expect(page).toHaveURL("/giris");
  const user = `(select id from auth.users where email = '${email}')`;
  sql(`insert into public.user_roles (user_id, role_id)
       select ${user}, id from public.roles where key = 'customer_service'`);

  await signIn(page, email);
  await expect(page).toHaveURL("/iki-adim");
  await page.goto("/yonetim");
  await expect(page).toHaveURL("/iki-adim");

  await page.getByRole("button", { name: "Kurulumu başlat" }).click();
  const secret = await page.getByTestId("mfa-anahtar").innerText();
  await page.getByLabel("6 haneli kod").fill("000000");
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page.getByText("Kod hatalı veya süresi dolmuş.")).toBeVisible();
  await page.getByLabel("6 haneli kod").fill(totp(secret));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL("/yonetim");
  await expect(page.getByText("8 izin")).toBeVisible();

  await signOut(page);
  await expect(page).toHaveURL("/giris");
  await signIn(page, email);
  await expect(page).toHaveURL("/iki-adim");
  await expect(
    page.getByRole("button", { name: "Kurulumu başlat" }),
  ).toHaveCount(0);
  await page.getByLabel("6 haneli kod").fill(totp(secret));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL("/yonetim");

  // Şifre yenileme de ikinci adımı atlatmaz.
  await signOut(page);
  await expect(page).toHaveURL("/giris");
  await page.goto("/sifremi-unuttum");
  await page.getByLabel("E-posta").fill(email);
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await page.goto(await mailLink(page.request, email, "recovery"));
  await page.getByRole("button", { name: "Şifremi yenile" }).click();
  await page.getByLabel("Yeni şifre").fill("yenigardirop456");
  await page.getByRole("button", { name: "Şifreyi kaydet" }).click();
  await expect(page).toHaveURL("/iki-adim?sonra=sifre");
  await page.getByLabel("6 haneli kod").fill(totp(secret));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL("/sifre-yenile");
  await page.getByLabel("Yeni şifre").fill("yenigardirop456");
  await page.getByRole("button", { name: "Şifreyi kaydet" }).click();
  await expect(page).toHaveURL("/hesap");

  sql(`update public.profiles set is_active = false where id = ${user}`);
  await page.goto("/yonetim");
  await expect(page).toHaveURL("/giris");
  await signIn(page, email, "yenigardirop456");
  await expect(page.getByText("Hesabınız kullanıma kapalı.")).toBeVisible();
});
