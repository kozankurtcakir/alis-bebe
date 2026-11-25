import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { newTag, removeCategory, seed, uploadImage } from "./urunler";
import {
  newEmail,
  PASSWORD,
  signIn,
  signOut,
  signUpAndConfirm,
  sql,
} from "./yardim";

const run = promisify(execFile);
const tag = newTag();
const category = `test-${tag}`;
const name = `Sepetlik Zıbın ${tag}`;
const url = `/urun/zibin-${tag}`;
const otherUrl = `/urun/obur-${tag}`;

test.beforeAll(async () => {
  const [a, b] = await Promise.all(["#f4b942", "#cfe8e1"].map(uploadImage));
  sql(`begin;
    insert into public.categories (name, slug, sort_order) values ('Test ${tag}', '${category}', 900);
    ${seed(category, {
      name,
      slug: `zibin-${tag}`,
      images: [{ path: a, alt: "Önden" }],
      variants: [
        ["hardal", "3-6A", 19990, null, 50],
        ["hardal", "6-9A", 25000, null, 2],
        ["hardal", "9-12A", 25000, null, 0],
      ],
    })}
    ${seed(category, {
      name: `Öbür Ürün ${tag}`,
      slug: `obur-${tag}`,
      images: [{ path: b, alt: "Önden" }],
      variants: [["mavi", "3-6A", 10000, null, 50]],
    })}
    commit;`);
});

test.afterAll(() => removeCategory(category));

const variant = (size: string) =>
  `(select v.id from public.product_variants v join public.products p on p.id = v.product_id
    join public.sizes s on s.id = v.size_id where p.slug = 'zibin-${tag}' and s.code = '${size}')`;

const status = (page: Page) => page.getByRole("main").getByRole("status");
const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const badge = (page: Page) =>
  page.getByRole("banner").getByRole("link", { name: /^Sepet/ });
const cartCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "sepet");
const button = (page: Page, label: string | RegExp) =>
  page.getByRole("button", { name: label });

async function add(page: Page, path = url, size = "3-6 Ay") {
  await page.goto(path);
  await page.getByRole("radio", { name: size, exact: true }).check();
  await button(page, "Sepete ekle").click();
  await expect(
    status(page).filter({ hasText: "Sepete eklendi." }),
  ).toBeVisible();
}

const quantity = (page: Page, text: string) =>
  page
    .getByRole("listitem")
    .filter({ hasText: text })
    .getByText(/^Adet /)
    .locator("..");

async function accessible(page: Page) {
  // Yenilenen sayfada başlık bir an yoktur; gelmezse burada düşer.
  await expect(page).toHaveTitle(/.+/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`),
    page.url(),
  ).toEqual([]);
}

async function narrow(page: Page) {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
    page.url(),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize(size);
}

/** Ayrı bir tarayıcı gibi: çerezleri öbür sayfayla paylaşmaz. */
async function separate(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test("misafir sepeti: ekleme, adet, tutar ve değişen stok", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/sepet");
  await expect(page.getByText("Sepetiniz boş.")).toBeVisible();
  await accessible(page);
  expect(await page.context().cookies()).toEqual([]);

  // Beden seçilmeden eklenmez, çerez oluşmaz.
  await page.goto(url);
  await button(page, "Sepete ekle").click();
  await expect(alert(page)).toHaveText("Önce beden seçin.");
  expect(await cartCookie(page)).toBeUndefined();
  await page.getByRole("radio", { name: "3-6 Ay" }).check();
  await expect(alert(page)).toHaveCount(0);

  await add(page);
  await expect(badge(page)).toHaveText("Sepet1 ürün");
  const cookie = (await cartCookie(page))!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(cookie.value).toMatch(/^[0-9a-f]{64}$/);
  const days = (cookie.expires - Date.now() / 1000) / 86_400;
  expect(days).toBeGreaterThan(29);
  expect(days).toBeLessThanOrEqual(30);
  expect(
    sql(
      `select count(*) from public.carts where token_hash = '${cookie.value}'`,
    ),
  ).toBe("0");

  // Stok 2: üçüncü adet reddedilir.
  await add(page, url, "6-9 Ay");
  await add(page, url, "6-9 Ay");
  await button(page, "Sepete ekle").click();
  await expect(alert(page)).toHaveText("Bu üründen istediğiniz kadar kalmadı.");
  await expect(badge(page)).toHaveText("Sepet3 ürün");

  await badge(page).click();
  await expect(page.getByRole("heading", { name: "Sepetim" })).toBeVisible();
  const total = page.getByTestId("ara-toplam");
  await expect(total).toHaveText("₺699,90");
  await expect(page.getByRole("img", { name: "Önden" }).first()).toBeVisible();

  const more = button(page, `Adedi artır: ${name}, Hardal, 3-6 Ay`);
  const less = button(page, `Adedi azalt: ${name}, Hardal, 3-6 Ay`);
  await expect(less).toHaveAttribute("aria-disabled", "true");
  await more.click();
  await expect(quantity(page, "3-6 Ay")).toHaveText("Adet 2");
  await expect(more).toBeFocused();
  await expect(total).toHaveText("₺899,80");
  await less.click();
  await expect(total).toHaveText("₺699,90");
  // Kapalı düğme bir şey yapmaz.
  await less.click({ force: true });
  await expect(quantity(page, "3-6 Ay")).toHaveText("Adet 1");
  await button(page, `Adedi artır: ${name}, Hardal, 6-9 Ay`).click();
  await expect(alert(page)).toHaveText("Bu üründen istediğiniz kadar kalmadı.");
  await accessible(page);
  await narrow(page);

  // Fiyat ve stok her açılışta veritabanından gelir.
  sql(`update public.product_variants set price = 5000 where id = ${variant("3-6A")};
       update public.inventory set on_hand = 1 where variant_id = ${variant("6-9A")}`);
  await page.reload();
  await expect(total).toHaveText("₺550,00");
  await expect(page.getByText("adedi azaltın")).toBeVisible();
  sql(
    `update public.inventory set on_hand = 0 where variant_id = ${variant("6-9A")}`,
  );
  await page.reload();
  await expect(page.getByText("toplama eklenmedi")).toBeVisible();
  await expect(total).toHaveText("₺50,00");
  sql(
    `update public.products set status = 'draft' where slug = 'zibin-${tag}'`,
  );
  await page.reload();
  await expect(page.getByText("Bu ürün artık satışta değil.")).toHaveCount(2);
  await expect(page.getByText(name)).toHaveCount(0);
  await expect(total).toHaveText("₺0,00");
  await accessible(page);
  sql(`update public.products set status = 'published' where slug = 'zibin-${tag}';
       update public.product_variants set price = 19990 where id = ${variant("3-6A")};
       update public.inventory set on_hand = 2 where variant_id = ${variant("6-9A")}`);

  // Kaldırınca klavye odağı kaybolmaz.
  await page.reload();
  for (const left of [1, 0]) {
    await button(page, /^Kaldır/)
      .first()
      .click();
    await expect(button(page, /^Kaldır/)).toHaveCount(left);
    await expect(page.getByRole("heading", { name: "Sepetim" })).toBeFocused();
  }
  await expect(page.getByText("Sepetiniz boş.")).toBeVisible();
  await expect(badge(page)).toHaveText("Sepet");
  expect(errors).toEqual([]);
});

test("girişte sepet birleşir, çıkışta kalmaz", async ({ page }) => {
  test.slow();
  const email = newEmail();

  // Üye olurken: misafir sepeti yeni üyeye geçer.
  await add(page);
  await add(page);
  const first = (await cartCookie(page))!.value;
  await signUpAndConfirm(page, email);
  await expect(badge(page)).toHaveText("Sepet2 ürün");
  expect(await cartCookie(page)).toBeUndefined();

  await page.goto("/hesap");
  await signOut(page);
  await expect(page).toHaveURL("/giris");
  await page.goto("/sepet");
  await expect(page.getByText("Sepetiniz boş.")).toBeVisible();

  // Aynı ürün 1, başka ürün 1: büyük adet kalır, yeni ürün eklenir.
  await add(page);
  await add(page, otherUrl);
  await expect(badge(page)).toHaveText("Sepet2 ürün");
  await signIn(page, email);
  await expect(page).toHaveURL("/hesap");
  await expect(badge(page)).toHaveText("Sepet3 ürün");
  expect(await cartCookie(page)).toBeUndefined();
  await page.goto("/sepet");
  await expect(quantity(page, name)).toHaveText("Adet 2");
  await expect(quantity(page, "Öbür Ürün")).toHaveText("Adet 1");
  await expect(page.getByTestId("ara-toplam")).toHaveText("₺499,80");

  // Birleşmiş sepetin eski kodu artık hiçbir şey açmaz.
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "sepet",
      value: first,
      url: new URL(page.url()).origin,
      httpOnly: true,
    },
  ]);
  await page.goto("/sepet");
  await expect(page.getByText("Sepetiniz boş.")).toBeVisible();

  // Hesap kapatılınca sepet de açılmaz.
  await signIn(page, email);
  await expect(badge(page)).toHaveText("Sepet3 ürün");
  const user = `(select id from auth.users where email = '${email}')`;
  sql(`update public.profiles set is_active = false where id = ${user}`);
  await page.goto("/sepet");
  await expect(page.getByText("Sepetiniz boş.")).toBeVisible();
  await page.goto(url);
  await page.getByRole("radio", { name: "3-6 Ay" }).check();
  await button(page, "Sepete ekle").click();
  await expect(alert(page)).toHaveText(
    "Oturumunuz kapanmış. Yeniden giriş yapın.",
  );
});

test("bir üye öbürünün verisine arayüzden ve API'den ulaşamaz", async ({
  page,
  browser,
}) => {
  test.slow();
  const [emailA, emailB] = [newEmail(), newEmail()];
  const other = await separate(browser);
  await signUpAndConfirm(page, emailA);
  await signUpAndConfirm(other, emailB);

  await add(page);
  await page.goto(url);
  await button(page, "Favorilere ekle").click();
  await expect(button(page, "Favorilerden çıkar")).toBeVisible();
  const userA = `(select id from auth.users where email = '${emailA}')`;
  sql(`insert into public.addresses (user_id, title, recipient, phone, city, district, line, is_default)
       values (${userA}, 'Gizli Ev', 'A Kişi', '+905550000000', 'Bursa', 'Nilüfer', 'Deneme Mah. 1', true);
       insert into public.consents (user_id, kind, granted, source) values (${userA}, 'email_marketing', true, 'account')`);

  await other.goto("/sepet");
  await expect(other.getByText("Sepetiniz boş.")).toBeVisible();
  await other.goto("/hesap/adresler");
  await expect(other.getByText("Kayıtlı adresiniz yok.")).toBeVisible();
  await other.goto("/hesap/favoriler");
  await expect(other.getByText("Henüz favoriniz yok.")).toBeVisible();
  await other.goto("/hesap/izinler");
  await expect(other.getByText("İzin yok.")).toHaveCount(2);
  await other.context().close();

  // Aynı denemeler sitemizi atlayıp doğrudan Supabase'e yapılır.
  const env = readFileSync(".env.local", "utf8");
  const read = (key: string) =>
    new RegExp(`^${key}="?([^"\r\n]+)`, "m").exec(env)![1];
  const api = read("SUPABASE_URL");
  const apikey = read("SUPABASE_PUBLISHABLE_KEY");
  const login = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey, "content-type": "application/json" },
    body: JSON.stringify({ email: emailB, password: PASSWORD }),
  });
  const { access_token } = await login.json();
  const as = (token: string | null) => (path: string, body?: unknown) =>
    fetch(`${api}/rest/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        apikey,
        ...(token && { authorization: `Bearer ${token}` }),
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const b = as(access_token);
  const visitor = as(null);
  const address = sql(
    `select id from public.addresses where user_id = ${userA}`,
  );

  for (const table of ["addresses", "consents"]) {
    const response = await b(table);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect((await visitor(table)).status).toBe(401);
  }
  for (const table of ["carts", "cart_items", "favorites"]) {
    expect((await b(table)).status, table).toBe(403);
    expect((await visitor(table)).status, table).toBe(401);
  }
  const userId = sql(`select ${userA}`);
  expect(
    (
      await b("consents", {
        user_id: userId,
        kind: "sms_marketing",
        granted: true,
        source: "account",
      })
    ).status,
  ).toBe(403);
  const changed = await b("rpc/save_address", {
    p_id: address,
    p_title: "Çalıntı",
    p_recipient: "B Kişi",
    p_phone: "+905551111111",
    p_city: "Bursa",
    p_district: "Nilüfer",
    p_line: "Deneme Mah. 1",
    p_postal_code: null,
    p_default: true,
  });
  expect((await changed.json()).message).toBe("Adres bulunamadı.");
  const deleted = await b("rpc/delete_address", { p_id: address });
  expect((await deleted.json()).message).toBe("Adres bulunamadı.");
  for (const [fn, args] of [
    ["list_favorites", {}],
    ["cart_merge", { p_token: "0".repeat(64) }],
    ["set_consent", { p_kind: "email_marketing", p_granted: true }],
  ] as const) {
    expect((await visitor(`rpc/${fn}`, args)).status, fn).toBe(401);
  }
  expect(
    sql(`select title from public.addresses where user_id = ${userA}`),
  ).toBe("Gizli Ev");

  await page.goto("/sepet");
  await expect(quantity(page, name)).toHaveText("Adet 1");
});

test("favoriler: misafir girişe gider, dönünce ekler", async ({ page }) => {
  test.slow();
  const email = newEmail();
  await signUpAndConfirm(page, email);
  await signOut(page);
  await expect(page).toHaveURL("/giris");

  await page.goto(otherUrl);
  await page.getByRole("link", { name: "Favorilere ekle" }).click();
  await expect(page).toHaveURL(`/giris?sonra=${otherUrl}`);
  await page.getByLabel("E-posta").fill(email);
  // Yanlış şifreden sonra da dönülecek sayfa unutulmaz.
  await page.getByLabel("Şifre").fill("yanlis-sifre1");
  await button(page, "Giriş yap").click();
  await expect(page.getByText("E-posta veya şifre hatalı.")).toBeVisible();
  await page.getByLabel("Şifre").fill(PASSWORD);
  await button(page, "Giriş yap").click();
  await expect(page).toHaveURL(otherUrl);

  await button(page, "Favorilere ekle").click();
  await expect(button(page, "Favorilerden çıkar")).toBeFocused();
  await accessible(page);
  await page.goto("/hesap/favoriler");
  await expect(page.getByRole("link", { name: "Öbür Ürün" })).toBeVisible();
  await accessible(page);
  await narrow(page);

  sql(`update public.products set status = 'draft' where slug = 'obur-${tag}'`);
  await page.reload();
  await expect(page.getByText("Henüz favoriniz yok.")).toBeVisible();
  sql(
    `update public.products set status = 'published' where slug = 'obur-${tag}'`,
  );

  await page.goto(otherUrl);
  await button(page, "Favorilerden çıkar").click();
  await expect(button(page, "Favorilere ekle")).toBeVisible();
  await page.goto("/hesap/favoriler");
  await expect(page.getByText("Henüz favoriniz yok.")).toBeVisible();

  // Dönülecek adres başka bir siteyi gösteremez.
  await page.goto("/hesap");
  await signOut(page);
  await expect(page).toHaveURL("/giris");
  await page.goto("/giris?sonra=//kotu.example");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await button(page, "Giriş yap").click();
  await expect(page).toHaveURL("/hesap");
});

test("hesap: bilgiler, adresler ve ileti izinleri", async ({ page }) => {
  test.slow();
  for (const path of [
    "/hesap/adresler",
    "/hesap/favoriler",
    "/hesap/izinler",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL("/giris");
  }
  await signUpAndConfirm(page, newEmail());

  // SMS izni telefon ister; e-posta izni verilip geri alınır.
  await page.goto("/hesap/izinler");
  const granted = page.getByText(/^İzin verdiniz/);
  await expect(page.getByText("İzin yok.")).toHaveCount(2);
  await button(page, "İzin ver (SMS)").click();
  await expect(alert(page)).toContainText("önce telefon numaranızı ekleyin");
  await button(page, "İzin ver (E-posta)").click();
  await expect(granted).toHaveCount(1);
  await accessible(page);
  await button(page, "İzni kaldır (E-posta)").click();
  await expect(granted).toHaveCount(0);

  await page.goto("/hesap");
  await page.getByLabel("Ad soyad").fill("Yeni Ad");
  await page.getByLabel("Cep telefonu").fill("0222 000 00 00");
  await button(page, "Kaydet").click();
  await expect(alert(page)).toContainText("Geçerli bir cep telefonu");
  await expect(page.getByLabel("Ad soyad")).toHaveValue("Yeni Ad");
  await page.getByLabel("Cep telefonu").fill("0555 000 11 22");
  await button(page, "Kaydet").click();
  await expect(status(page)).toHaveText("Bilgileriniz kaydedildi.");
  await page.reload();
  await expect(page.getByLabel("Ad soyad")).toHaveValue("Yeni Ad");
  await expect(page.getByLabel("Cep telefonu")).toHaveValue("0555 000 11 22");
  await accessible(page);
  await narrow(page);

  await page.goto("/hesap/adresler");
  const form = page.getByRole("region", { name: "Yeni adres" });
  const fill = async (title: string) => {
    await form.getByLabel("Adres adı").fill(title);
    await form.getByLabel("Alıcının adı soyadı").fill("Deneme Kişi");
    await form.getByLabel("Cep telefonu").fill("0555 000 11 22");
    await form.getByLabel("İl", { exact: true }).selectOption("Eskişehir");
    await form.getByLabel("İlçe").fill("Odunpazarı");
    await form.getByLabel("Açık adres").fill("Deneme Mah. <b>Örnek</b> No: 1");
  };
  await fill("Ev");
  await form.getByLabel("Posta kodu").fill("260");
  await button(page, "Adresi ekle").click();
  await expect(alert(page)).toHaveText("Posta kodu 5 rakam olmalı.");
  await expect(form.getByLabel("Adres adı")).toHaveValue("Ev");
  await form.getByLabel("Posta kodu").fill("26000");
  await button(page, "Adresi ekle").click();
  const item = (title: string) =>
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: title }) });
  const isDefault = (title: string) =>
    item(title).getByText("Varsayılan", { exact: true });
  await expect(isDefault("Ev")).toBeVisible();
  // Yazılan etiket metin olarak kalır.
  await expect(item("Ev").getByText("<b>Örnek</b>").first()).toBeVisible();
  await expect(form.getByLabel("Adres adı")).toHaveValue("");

  await fill("İş");
  await form.getByLabel("Varsayılan adresim olsun").check();
  await button(page, "Adresi ekle").click();
  await expect(isDefault("İş")).toBeVisible();
  await expect(isDefault("Ev")).toHaveCount(0);
  await accessible(page);
  await narrow(page);

  await page.getByText("Düzenle (Ev)").click();
  await item("Ev").getByLabel("Adres adı").fill("Yazlık");
  await button(page, "Kaydet (Ev)").click();
  await expect(item("Yazlık")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await button(page, "Sil (İş)").click();
  await expect(item("İş")).toHaveCount(0);
  await expect(isDefault("Yazlık")).toBeVisible();
});

test("eşzamanlı ekleme ve birleştirme kayıp veya fazla yazmaz", async ({
  page,
}, info) => {
  // Veritabanı bağlantı sınırını aşmamak için tek tarayıcıda çalışır.
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const email = newEmail();
  await signUpAndConfirm(page, email);
  const claims =
    sql(`select json_build_object('sub', u.id, 'role', 'authenticated',
      'aal', 'aal1', 'session_id', s.id) from auth.users u
      join auth.sessions s on s.user_id = u.id where u.email = '${email}' limit 1`);
  const big = sql(`select v.id from public.product_variants v
    join public.products p on p.id = v.product_id where p.slug = 'obur-${tag}'`);

  /** Aynı anda 20 ayrı bağlantı; `as` boşsa misafir. */
  const burst = async (call: string, as = claims) => {
    const statement = `select set_config('request.jwt.claims', '${as || '{"role":"anon"}'}', false);
      set role ${as ? "authenticated" : "anon"}; select 'OK ' || (${call})::text;`;
    const { stdout } = await run("docker", [
      "exec",
      "-e",
      `Q=${statement}`,
      "supabase_db_alis-bebe",
      "bash",
      "-c",
      'for i in $(seq 20); do psql -U postgres -qAtc "$Q" 2>&1 & done; wait',
    ]);
    return stdout;
  };
  const count = (text: string, pattern: RegExp) =>
    (text.match(pattern) ?? []).length;
  const guest = (pieces: number) => {
    const out =
      sql(`select set_config('request.jwt.claims', '{"role":"anon"}', false);
        set role anon; select public.cart_add(null, '${big}', ${pieces})`);
    return JSON.parse(out.split("\n").at(-1)!).token as string;
  };
  const member = `(select id from public.carts where user_id = (select id from auth.users where email = '${email}'))`;
  const lines = () =>
    sql(
      `select string_agg(quantity::text, ',') from public.cart_items where cart_id = ${member}`,
    );

  // Üyenin ilk sepeti: 20 ekleme, sınır 10; tek sepet ve tek satır oluşur.
  const added = await burst(`public.cart_add(null, '${big}', 1)`);
  expect(count(added, /^OK /gm)).toBe(10);
  expect(count(added, /en fazla 10 adet/g)).toBe(10);
  expect(lines()).toBe("10");
  sql(`delete from public.cart_items where cart_id = ${member}`);

  // Misafir sepeti 4 adet; 20 birleştirmeden yalnızca biri işler.
  const merged = await burst(`public.cart_merge('${guest(4)}')`);
  expect(count(merged, /^OK true$/gm)).toBe(1);
  expect(count(merged, /^OK false$/gm)).toBe(19);
  expect(lines()).toBe("4");

  // Aynı koda 20 misafir eklemesi: hepsi tek sepette toplanır.
  const token = guest(1);
  const more = await burst(`public.cart_add('${token}', '${big}', 1)`, "");
  expect(count(more, /^OK /gm)).toBe(9);
  expect(count(more, new RegExp(token, "g"))).toBe(9);
  expect(
    sql(`select quantity from public.cart_items where cart_id = (
      select id from public.carts where token_hash = encode(sha256(convert_to('${token}', 'UTF8')), 'hex'))`),
  ).toBe("10");
});
