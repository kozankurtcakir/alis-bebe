import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Yerel Supabase açık olmalı: npm run db:start
const MAIL = "http://127.0.0.1:54324/api/v1";
export const PASSWORD = "gardirop123";

export const newEmail = () => `test-${randomUUID()}@ornek.test`;

export function sql(query: string) {
  return execFileSync(
    "docker",
    // Sorgu standart girdiden gider; komut satırının uzunluk sınırına takılmaz.
    [
      ...["exec", "-i", "supabase_db_alis-bebe", "psql", "-U", "postgres"],
      ...["-qAt", "-v", "ON_ERROR_STOP=1"],
    ],
    { encoding: "utf8", input: query },
  ).trim();
}

/** Yerel posta kutusundaki son iletinin bağlantısı. */
export async function mailLink(
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
export function totp(secret: string) {
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

export async function signUp(page: Page, email: string) {
  await page.goto("/kayit");
  await page.getByLabel("Ad soyad").fill("Deneme Kişi");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Üye ol" }).click();
  await expect(page.getByRole("status")).toContainText("doğrulama bağlantısı");
}

export async function signUpAndConfirm(page: Page, email: string) {
  await signUp(page, email);
  await page.goto(await mailLink(page.request, email, "email"));
  await page.getByRole("button", { name: "E-postamı doğrula" }).click();
  await expect(page).toHaveURL("/hesap");
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

export const signOut = (page: Page) =>
  page.getByRole("button", { name: "Çıkış yap" }).click();

/** Rolü doğrudan veritabanına yazar; yalnızca test hazırlığı içindir. */
export function grantRole(email: string, role: string) {
  sql(`insert into public.user_roles (user_id, role_id)
       select u.id, r.id from auth.users u, public.roles r
       where u.email = '${email}' and r.key = '${role}'`);
}

/** Test Super Admin'ini temizler; son Super Admin koruması yalnızca burada atlanır. */
export function removeSuperAdmin(email: string) {
  sql(`begin;
       alter table public.user_roles disable trigger user_roles_guard;
       delete from public.user_roles
       where user_id = (select id from auth.users where email = '${email}')
         and role_id = (select id from public.roles where key = 'super_admin');
       alter table public.user_roles enable trigger user_roles_guard;
       commit;`);
}

/** Giriş yapmış personelin ilk iki adımlı doğrulama kurulumu. */
export async function setUpMfa(page: Page) {
  await page.goto("/iki-adim");
  await page.getByRole("button", { name: "Kurulumu başlat" }).click();
  const secret = await page.getByTestId("mfa-anahtar").innerText();
  await page.getByLabel("6 haneli kod").fill(totp(secret));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL("/yonetim");
  return secret;
}

/** Paralel testler de kayıt yazar; aranan kayıt sonraki sayfalara kaymış olabilir. */
export async function expectInHistory(
  page: Page,
  subject: string,
  text: string,
) {
  const entry = page
    .getByRole("listitem")
    .filter({ hasText: subject })
    .getByText(text);
  for (let n = 1; n <= 20; n++) {
    await page.goto(`/yonetim/islem-gecmisi?sayfa=${n}`);
    await expect(
      page.getByRole("heading", { name: "İşlem geçmişi" }),
    ).toBeVisible();
    if ((await entry.count()) > 0) return expect(entry).toBeVisible();
  }
  throw new Error(`İşlem geçmişinde bulunamadı: ${text}`);
}
