import { execFile } from "node:child_process";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { newTag, removeCategory, seed, uploadImage } from "./urunler";
import {
  expectInHistory,
  grantRole,
  newEmail,
  removeSuperAdmin,
  setUpMfa,
  signUpAndConfirm,
  sql,
} from "./yardim";

const MAIL = "http://127.0.0.1:54324/api/v1";
const tag = newTag();
const category = `test-${tag}`;
const name = `Siparişlik Tulum ${tag}`;
const url = `/urun/tulum-${tag}`;

test.beforeAll(async () => {
  const image = await uploadImage("#cfe8e1");
  sql(`begin;
    insert into public.categories (name, slug, sort_order) values ('Test ${tag}', '${category}', 900);
    ${seed(category, {
      name,
      slug: `tulum-${tag}`,
      images: [{ path: image, alt: "Önden" }],
      variants: [
        ["mavi", "3-6A", 10000, null, 500],
        ["mavi", "6-9A", 100000, null, 500],
        ["mavi", "9-12A", 10000, null, 1],
        ["mavi", "0-3A", 10000, null, 500],
      ],
    })}
    commit;`);
});

test.afterAll(() => removeCategory(category));

const variant = (size: string) =>
  `(select v.id from public.product_variants v join public.products p on p.id = v.product_id
    join public.sizes s on s.id = v.size_id where p.slug = 'tulum-${tag}' and s.code = '${size}')`;
const stock = (size: string) =>
  sql(
    `select on_hand || '/' || reserved from public.inventory where variant_id = ${variant(size)}`,
  );
const newPhone = () => `0555${randomInt(1_000_000, 9_999_999)}`;
const button = (page: Page, label: string | RegExp) =>
  page.getByRole("button", { name: label });
const main = (page: Page) => page.getByRole("main");
const alert = (page: Page) => main(page).getByRole("alert");
const separate = async (browser: Browser) =>
  (await browser.newContext()).newPage();

async function accessible(page: Page) {
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

async function toCheckout(page: Page, size = "3-6 Ay") {
  await page.goto(url);
  await page.getByRole("radio", { name: size, exact: true }).check();
  await button(page, "Sepete ekle").click();
  await expect(
    main(page).getByRole("status").filter({ hasText: "Sepete eklendi." }),
  ).toBeVisible();
  await page.goto("/sepet");
  await page.getByRole("link", { name: "Siparişi tamamla" }).click();
  await expect(
    page.getByRole("heading", { name: "Siparişi tamamla" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Havale/EFT" }).check();
}

async function fillContact(page: Page, email?: string) {
  await page.getByLabel("Ad soyad").fill("Deneme Kişi");
  if (email) await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Cep telefonu").fill(newPhone());
}

async function fillAddress(page: Page) {
  await page.getByLabel("İl", { exact: true }).selectOption("Eskişehir");
  await page.getByLabel("İlçe").fill("Odunpazarı");
  await page.getByLabel("Açık adres").fill("Deneme Mahallesi 1");
}

async function accept(page: Page) {
  for (const box of await page
    .getByRole("checkbox", { name: /okudum ve onaylıyorum/ })
    .all()) {
    await box.check();
  }
}

const submit = (page: Page) => button(page, /^Siparişi ver/);

async function placed(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Siparişiniz alındı" }),
  ).toBeVisible();
  return /\/siparis\/(AB\w{10})/.exec(page.url())![1];
}

async function guestOrder(page: Page, email = newEmail()) {
  await toCheckout(page);
  await fillContact(page, email);
  await fillAddress(page);
  await accept(page);
  await submit(page).click();
  return placed(page);
}

async function staff(browser: Browser, role: string) {
  const page = await separate(browser);
  const email = newEmail();
  await signUpAndConfirm(page, email);
  grantRole(email, role);
  await setUpMfa(page);
  page.on("dialog", (d) => d.accept());
  return { page, email };
}

async function openInPanel(page: Page, no: string) {
  await page.goto(`/yonetim/siparisler?ara=${no}`);
  await page.getByRole("link", { name: no }).click();
  await expect(page.getByRole("heading", { name: no, level: 1 })).toBeVisible();
}

test("misafir EFT siparişi: tutar, gizli bağlantı, e-posta ve iptal", async ({
  page,
  browser,
}) => {
  test.slow();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const email = newEmail();

  // Boş sepetle ödeme sayfası açılmaz.
  await page.goto("/odeme");
  await expect(page).toHaveURL("/sepet");

  await toCheckout(page);
  await expect(page.getByText("Deneme modu:")).toBeVisible();
  await accessible(page);
  await narrow(page);

  // Tutar: kargo, hediye paketi ve kapıda ödeme ücreti.
  await expect(submit(page)).toContainText("₺300,00");
  await page.getByLabel(/^Hediye paketi/).check();
  await expect(submit(page)).toContainText("₺305,00");
  await page.getByRole("radio", { name: "Kapıda ödeme" }).check();
  await expect(submit(page)).toContainText("₺320,00");
  await page.getByRole("radio", { name: "Mağazadan teslim" }).check();
  await expect(submit(page)).toContainText("₺105,00");
  await expect(page.getByRole("radio", { name: "Kapıda ödeme" })).toHaveCount(
    0,
  );
  await page.getByRole("radio", { name: "Kargo" }).check();
  await page.getByRole("radio", { name: "Havale/EFT" }).check();

  // Sözleşmeler işaretsiz başlar ve zorunludur.
  await fillContact(page, email);
  await fillAddress(page);
  await submit(page).click();
  await expect(page).toHaveURL("/odeme");
  expect(
    sql(`select count(*) from public.orders where email = '${email}'`),
  ).toBe("0");

  await accept(page);
  const no = await (async () => {
    await submit(page).click();
    return placed(page);
  })();
  await expect(page.getByText("₺305,00").first()).toBeVisible();
  await expect(page.getByText("TR33 0006 1005 1978")).toBeVisible();
  await accessible(page);
  await narrow(page);
  await expect(
    page.getByRole("banner").getByRole("link", { name: /^Sepet/ }),
  ).toHaveText("Sepet");

  const cookie = (await page.context().cookies(page.url())).find(
    (c) => c.name === "siparis_kod",
  )!;
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    path: `/siparis/${no}`,
  });
  await page.reload();
  await expect(page.getByText(no).first()).toBeVisible();

  // Numarayı bilmek yetmez.
  const other = await separate(browser);
  await other.goto(`/siparis/${no}`);
  await expect(
    other.getByRole("heading", { name: "Sipariş açılamadı" }),
  ).toBeVisible();
  await expect(other.getByText("TR33")).toHaveCount(0);
  await other.goto(`/siparis/${no}/ac?kod=${"0".repeat(64)}`);
  await expect(
    other.getByRole("heading", { name: "Sipariş açılamadı" }),
  ).toBeVisible();
  await accessible(other);

  // E-postadaki bağlantı başka tarayıcıda açar; kod adreste kalmaz.
  let link = "";
  await expect
    .poll(async () => {
      const found = await page.request.get(`${MAIL}/search`, {
        params: { query: `to:"${email}"` },
      });
      for (const { ID } of (await found.json()).messages) {
        const { Text } = await (
          await page.request.get(`${MAIL}/message/${ID}`)
        ).json();
        link = /http\S+kod=\w+/.exec(Text)?.[0] ?? link;
      }
      return link;
    })
    .toContain(no);
  await other.goto(link);
  await expect(
    other.getByRole("heading", { name: "Siparişiniz" }),
  ).toBeVisible();
  expect(other.url()).not.toContain("kod");

  // Misafir bağlantısıyla iptal; stok serbest kalır.
  other.on("dialog", (d) => d.accept());
  await button(other, "Siparişi iptal et").click();
  await expect(other.getByText("İptal edildi")).toBeVisible();
  expect(
    sql(`select r.status from public.stock_reservations r join public.order_items i on i.id = r.order_item_id
         join public.orders o on o.id = i.order_id where o.order_no = '${no}'`),
  ).toBe("released");
  expect(errors).toEqual([]);
});

test("tutar sunucuda hesaplanır; oynanan veya eskiyen tutar reddedilir", async ({
  page,
}) => {
  const email = newEmail();
  await toCheckout(page, "0-3 Ay");
  await fillContact(page, email);
  await fillAddress(page);
  await accept(page);

  await page
    .locator('input[name="expected_total"]')
    .evaluate((e: HTMLInputElement) => (e.value = "1"));
  await submit(page).click();
  await expect(alert(page)).toContainText("Sepet tutarı değişti");
  // Yazılanlar kaybolmaz.
  await expect(page.getByLabel("E-posta")).toHaveValue(email);

  sql(
    `update public.product_variants set price = 15000 where id = ${variant("0-3A")}`,
  );
  await page.reload();
  await expect(submit(page)).toContainText("₺350,00");
  sql(
    `update public.product_variants set price = 10000 where id = ${variant("0-3A")}`,
  );
  await fillContact(page, email);
  await fillAddress(page);
  await accept(page);
  await submit(page).click();
  await expect(alert(page)).toContainText("Sepet tutarı değişti");
  await expect(submit(page)).toContainText("₺300,00");
  expect(
    sql(`select count(*) from public.orders where email = '${email}'`),
  ).toBe("0");
});

test("çift tıklama tek sipariş üretir", async ({ page }) => {
  const email = newEmail();
  await toCheckout(page);
  await fillContact(page, email);
  await fillAddress(page);
  await accept(page);
  await submit(page).evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  const first = await placed(page);
  expect(
    sql(`select count(*) from public.orders where email = '${email}'`),
  ).toBe("1");

  // Aynı sekmede, sayfa yenilenmeden ve form değiştirilmeden ikinci sipariş:
  // gizli tutulan eski form ilk siparişin isteğini yinelemez.
  await page.getByLabel("Ürün ara").fill(tag);
  await button(page, "Ara").click();
  await page.getByRole("link", { name }).first().click();
  await page.getByRole("radio", { name: "3-6 Ay", exact: true }).check();
  await button(page, "Sepete ekle").click();
  await page.getByRole("link", { name: "Sepete git" }).click();
  await page.getByRole("link", { name: "Siparişi tamamla" }).click();
  await expect(
    page.getByRole("heading", { name: "Siparişi tamamla" }),
  ).toBeVisible();
  if ((await page.getByLabel("E-posta").inputValue()) === "") {
    await fillContact(page, email);
    await fillAddress(page);
    await accept(page);
  }
  await page.getByRole("radio", { name: "Havale/EFT" }).check();
  await submit(page).click();
  await expect(page).not.toHaveURL("/odeme");
  expect(await placed(page)).not.toBe(first);
  expect(
    sql(`select count(*) from public.orders where email = '${email}'`),
  ).toBe("2");
});

test("üye: kayıtlı adres, mağazadan teslim, siparişlerim ve başkasının siparişi", async ({
  page,
  browser,
}) => {
  test.slow();
  const email = newEmail();
  await signUpAndConfirm(page, email);
  sql(`insert into public.addresses (user_id, title, recipient, phone, city, district, line, is_default)
       select id, 'Evim', 'Ev Kişisi', '+905551112233', 'Bursa', 'Nilüfer', 'Kayıtlı Sokak No 1', true
       from auth.users where email = '${email}'`);

  await page.goto("/hesap/siparisler");
  await expect(page.getByText("Siparişiniz yok.")).toBeVisible();
  await accessible(page);

  await toCheckout(page);
  await expect(page.getByLabel("E-posta")).toHaveCount(0);
  await expect(page.getByLabel("Açık adres")).toHaveValue("Kayıtlı Sokak No 1");
  await page
    .getByLabel("Kayıtlı adres")
    .selectOption({ label: "Yeni adres yaz" });
  await expect(page.getByLabel("Açık adres")).toHaveValue("");

  await page.getByRole("radio", { name: "Mağazadan teslim" }).check();
  await page.getByRole("radio", { name: "Mağazada ödeme" }).check();
  await page.getByLabel("Kurumsal fatura istiyorum").check();
  await page.getByLabel("Şirket unvanı").fill("Deneme A.Ş.");
  await page.getByLabel("Vergi dairesi").fill("Odunpazarı");
  await page.getByLabel("Vergi numarası").fill("1234567890");
  await page.getByLabel("Cep telefonu").fill(newPhone());
  await fillAddress(page);
  await accept(page);
  await accessible(page);
  await submit(page).click();
  const no = await placed(page);
  await expect(
    page.getByText("Aliş Bebe, Eskişehir", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.context().cookies(page.url())).some(
      (c) => c.name === "siparis_kod",
    ),
  ).toBe(false);

  await page.goto("/hesap/siparisler");
  await page.getByRole("link", { name: no }).click();
  await expect(
    page.getByRole("heading", { name: "Siparişiniz" }),
  ).toBeVisible();

  const other = await separate(browser);
  await signUpAndConfirm(other, newEmail());
  await other.goto(`/siparis/${no}`);
  await expect(
    other.getByRole("heading", { name: "Sipariş açılamadı" }),
  ).toBeVisible();
  await other.goto("/hesap/siparisler");
  await expect(other.getByText(no)).toHaveCount(0);
  for (const path of ["/yonetim/siparisler", "/yonetim/ayarlar"]) {
    await other.goto(path);
    await expect(
      other.getByRole("heading", { name: "Sayfa bulunamadı" }),
    ).toBeVisible();
  }
});

test("panel: EFT onayı, sipariş onayı, kargo ve teslim", async ({
  page,
  browser,
}) => {
  test.slow();
  const [no, cancelled] = [await guestOrder(page), await guestOrder(page)];
  const { page: admin } = await staff(browser, "admin");
  const before = stock("3-6A").split("/").map(Number);

  await openInPanel(admin, no);
  await accessible(admin);
  await narrow(admin);
  await expect(button(admin, "Siparişi onayla")).toHaveCount(0);

  // Eksik havale incelemeye düşer, kalanı gelince ödendi sayılır.
  for (const [amount, reference] of [
    ["100,00", `R1-${no}`],
    ["200,00", `R2-${no}`],
  ]) {
    await admin.getByLabel("Gelen tutar (TL)").fill(amount);
    await admin.getByLabel("Banka işlem numarası").fill(reference);
    await button(admin, "Havaleyi yaz").click();
    await button(admin, `Havaleyi onayla (${reference})`).click();
    await expect(admin.getByText(/Onaylayan:/)).not.toHaveCount(0);
    await expect(
      admin
        .getByText(
          amount === "100,00" ? "Tutar inceleniyor" : "Onay bekliyor",
          { exact: false },
        )
        .first(),
    ).toBeVisible();
  }

  await button(admin, "Siparişi onayla").click();
  await expect(button(admin, "Duruma geç: Hazırlanıyor")).toBeVisible();
  await button(admin, "Duruma geç: Hazırlanıyor").click();
  await button(admin, "Duruma geç: Kargoda").click();
  await expect(button(admin, "Siparişi iptal et")).toHaveCount(0);
  await button(admin, "Duruma geç: Teslim edildi").click();
  await expect(
    admin.getByText("Sipariş: Kargoda → Teslim edildi"),
  ).toBeVisible();
  await page.goto(`/siparis/${no}`);
  await expect(page.getByText("Teslim edildi")).toBeVisible();
  expect(
    sql(`select string_agg(delta::text, ',') from public.stock_movements m
         join public.orders o on o.id = m.order_id where o.order_no = '${no}'`),
  ).toBe("-1");
  // Paralel testler de aynı ürünü ayırabilir; en az bu sipariş kadar düşmüştür.
  expect(Number(stock("3-6A").split("/")[0])).toBeLessThan(before[0]);

  // Personel iptali neden ister ve geçmişe yazar.
  await openInPanel(admin, cancelled);
  await admin.getByLabel("İptal nedeni").fill("Müşteri vazgeçti");
  await button(admin, "Siparişi iptal et").click();
  await expect(admin.getByText("Mağaza iptal etti")).toBeVisible();
  await expect(admin.getByText("Müşteri vazgeçti").first()).toBeVisible();
});

test("panel: toplu inceleme, mağazada tahsilat ve rol sınırları", async ({
  page,
  browser,
}) => {
  test.slow();
  const pickup = async () => {
    await toCheckout(page);
    await fillContact(page, newEmail());
    await page.getByRole("radio", { name: "Mağazadan teslim" }).check();
    await page.getByRole("radio", { name: "Mağazada ödeme" }).check();
    await fillAddress(page);
    await accept(page);
    await submit(page).click();
    return placed(page);
  };
  const first = await pickup();
  const second = await pickup();

  // Kapıda ödeme: telefon doğrulanmadan toplu onaya giremez.
  await toCheckout(page);
  await fillContact(page, newEmail());
  await fillAddress(page);
  await page.getByRole("radio", { name: "Kapıda ödeme" }).check();
  await accept(page);
  await submit(page).click();
  const cod = await placed(page);

  const { page: manager } = await staff(browser, "order_manager");
  await manager.goto("/yonetim/siparisler?durum=awaiting_approval");
  await expect(
    manager.getByRole("listitem", { name: cod }).getByRole("checkbox"),
  ).toHaveCount(0);
  await expect(manager.getByRole("listitem", { name: cod })).toContainText(
    "Telefon doğrulanmadı",
  );
  await accessible(manager);
  await narrow(manager);
  await button(manager, "Seçilenleri onayla").click();
  await expect(alert(manager)).toHaveText("Önce sipariş seçin.");
  await manager.getByLabel(`Seç: ${first}`).check();
  await manager.getByLabel(`Seç: ${second}`).check();
  await button(manager, "Seçilenleri onayla").click();
  await expect(manager.getByRole("listitem", { name: first })).toHaveCount(0);
  expect(
    sql(
      `select count(*) from public.orders where order_no in ('${first}', '${second}') and order_status = 'approved'`,
    ),
  ).toBe("2");

  // Tahsilat yazılmadan teslim edilemez.
  await openInPanel(manager, first);
  await button(manager, "Duruma geç: Hazırlanıyor").click();
  await button(manager, "Duruma geç: Mağazada hazır").click();
  await button(manager, "Duruma geç: Teslim edildi").click();
  await expect(alert(manager)).toHaveText(
    "Tahsilat yazılmadan teslim edilemez.",
  );
  await manager.getByLabel("Tahsilat").selectOption({ label: "Nakit" });
  await button(manager, "Tahsilatı kaydet").click();
  await expect(manager.getByText("Ödeme: Ödenmedi → Ödendi")).toBeVisible();
  await button(manager, "Duruma geç: Teslim edildi").click();
  await expect(
    manager.getByText("Sipariş: Mağazada hazır → Teslim edildi"),
  ).toBeVisible();

  // Müşteri hizmetleri telefonu doğrular ve not yazar; onaylayamaz.
  const { page: support } = await staff(browser, "customer_service");
  await openInPanel(support, cod);
  await expect(button(support, "Siparişi onayla")).toHaveCount(0);
  await expect(button(support, "Siparişi iptal et")).toHaveCount(0);
  await button(support, "Telefonu doğruladım").click();
  await expect(support.getByText("Telefon doğrulandı").first()).toBeVisible();
  await support.getByLabel("Not", { exact: true }).fill("Arandı, doğrulandı");
  await button(support, "Not ekle").click();
  await expect(support.getByText("Arandı, doğrulandı")).toBeVisible();

  // Ürün yöneticisi siparişleri göremez.
  const { page: product } = await staff(browser, "product_manager");
  for (const path of ["/yonetim/siparisler", "/yonetim/ayarlar"]) {
    await product.goto(path);
    await expect(
      product.getByRole("heading", { name: "Sayfa bulunamadı" }),
    ).toBeVisible();
  }
  await manager.goto("/yonetim/ayarlar");
  await expect(
    manager.getByRole("heading", { name: "Sayfa bulunamadı" }),
  ).toBeVisible();
});

test("ayarlar: yalnızca Super Admin, doğrulama ve işlem geçmişi", async ({
  browser,
}, info) => {
  // Ayarlar ortaktır; iki proje aynı anda değiştirmesin.
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const { page, email } = await staff(browser, "super_admin");
  try {
    await page.goto("/yonetim/ayarlar");
    await accessible(page);
    await narrow(page);

    const days = page.getByLabel("Misafir bağlantısının süresi (gün)");
    await page.getByLabel("IBAN").fill("TR00");
    await button(page, "Ayarları kaydet").click();
    await expect(alert(page)).toContainText("IBAN");
    await page.getByLabel("IBAN").fill("TR33 0006 1005 1978 6457 8413 27");
    await button(page, "Ayarları kaydet").click();
    await expect(alert(page)).toContainText("Geçersiz ayar: bank_iban");

    await page.getByLabel("IBAN").fill("TR33 0006 1005 1978 6457 8413 26");
    await page.getByLabel("Deneme modu açık").uncheck();
    await button(page, "Ayarları kaydet").click();
    await expect(alert(page)).toContainText("Sahte kart ödemesi açıkken");
    // Kart kapansa da sözleşmeler taslakken deneme modu kapanmaz.
    const card = page.getByLabel("Kart ödemesi açık");
    await card.uncheck();
    await button(page, "Ayarları kaydet").click();
    await expect(alert(page)).toContainText("Deneme modu");

    await card.check();
    await page.getByLabel("Deneme modu açık").check();
    await page.getByLabel("Ödeme süresi (dakika)").fill("4");
    await button(page, "Ayarları kaydet").click();
    await expect(alert(page)).toContainText("Geçersiz ayar: card_minutes");
    await page.getByLabel("Ödeme süresi (dakika)").fill("30");
    const value = String(randomInt(91, 365));
    await days.fill(value);
    await button(page, "Ayarları kaydet").click();
    await expect(main(page).getByRole("status")).toHaveText(
      "Ayarlar kaydedildi.",
    );
    await page.reload();
    await expect(days).toHaveValue(value);
    await expectInHistory(page, email, "settings");
  } finally {
    removeSuperAdmin(email);
  }
});

// --- Eşzamanlılık: yalnızca bir kez, masaüstünde ----------------------------

const envValue = (key: string) =>
  new RegExp(`^${key}=(.+)$`, "m")
    .exec(readFileSync(".env.local", "utf8"))![1]
    .trim();

async function rpc(fn: string, body: unknown) {
  const response = await fetch(
    `${envValue("SUPABASE_URL")}/rest/v1/rpc/${fn}`,
    {
      method: "POST",
      headers: {
        apikey: envValue("SUPABASE_PUBLISHABLE_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return { ok: response.ok, data: await response.json() };
}

const psql = (query: string) =>
  new Promise<string>((resolve) => {
    const child = execFile(
      "docker",
      [
        ...["exec", "-i", "supabase_db_alis-bebe", "psql", "-U", "postgres"],
        ...["-qAt", "-v", "ON_ERROR_STOP=1"],
      ],
      (error, stdout, stderr) => resolve(error ? `HATA ${stderr}` : stdout),
    );
    child.stdin!.end(query);
  });

test("son ürüne 50 eşzamanlı sipariş: yalnızca biri olur", async ({}, info) => {
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const last = sql(`select ${variant("9-12A")}`);
  const documents = JSON.parse(
    sql("select jsonb_agg(id) from public.legal_documents"),
  );
  const carts = await Promise.all(
    Array.from({ length: 50 }, async () => {
      const { data } = await rpc("cart_add", {
        p_token: null,
        p_variant: last,
        p_quantity: 1,
      });
      return data.token as string;
    }),
  );

  const address = {
    recipient: "Deneme Kişi",
    phone: "+905550000000",
    city: "Eskişehir",
    district: "Odunpazarı",
    line: "Deneme Mahallesi 1",
  };
  const results = await Promise.all(
    carts.map((token) =>
      rpc("place_order", {
        p_token: token,
        p: {
          key: randomUUID(),
          email: newEmail(),
          phone: `+90555${randomInt(1_000_000, 9_999_999)}`,
          name: "Deneme Kişi",
          delivery: "shipping",
          payment: "transfer",
          expected_total: 30000,
          documents,
          address,
        },
      }),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  const messages = new Set(
    results.filter((r) => !r.ok).map((r) => r.data.message),
  );
  expect([...messages]).toEqual([
    "Sepetinizdeki bazı ürünler artık yeterli değil. Sepetinizi gözden geçirin.",
  ]);
  expect(stock("9-12A")).toBe("1/1");
});

test("süre bitimi ile havale yarışı: para da stok da kaybolmaz", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const { email } = await staff(browser, "admin");
  const claims =
    sql(`select json_build_object('sub', u.id, 'role', 'authenticated', 'aal', 'aal2', 'session_id', s.id)
    from auth.users u join auth.sessions s on s.user_id = u.id
    where u.email = '${email}' order by s.created_at desc limit 1`);
  const asAdmin = (query: string) =>
    psql(`begin; select set_config('request.jwt.claims', '${claims}', true); set local role authenticated;
          ${query}; commit;`);

  const outcomes = new Set<string>();
  for (let n = 0; n < 4; n++) {
    const no = await guestOrder(await separate(browser));
    const id = sql(`select id from public.orders where order_no = '${no}'`);
    sql(
      `update public.orders set payment_due_at = now() - interval '1 second' where id = '${id}'`,
    );
    const reference = `Y-${no}`;
    const [expired, matched] = await Promise.all([
      psql("select private.expire_orders()"),
      asAdmin(
        `select public.match_transfer('${id}', 30000, '${reference}', gen_random_uuid())`,
      ),
    ]);
    expect(expired).not.toContain("HATA");
    expect(matched).not.toContain("HATA");
    outcomes.add(
      sql(`select order_status from public.orders where id = '${id}'`),
    );

    // İki sırada da para onaylanınca sipariş sürer ve stok bir kez ayrılır.
    const confirmed = await asAdmin(
      `select public.confirm_transfer(id) from public.bank_transfers where reference = '${reference}'`,
    );
    expect(confirmed).toContain("paid");
    expect(
      sql(`select o.order_status || ':' || o.payment_status || ':' || string_agg(r.status, ',')
           from public.orders o join public.order_items i on i.order_id = o.id
           join public.stock_reservations r on r.order_item_id = i.id
           where o.id = '${id}' group by o.id`),
    ).toBe("awaiting_approval:paid:active");
  }
  // Yarışın hangi yöne gittiği şansa bağlıdır; yalnızca bilgi olarak yazılır.
  info.annotations.push({
    type: "yarış",
    description: [...outcomes].join(", "),
  });
  await page.close();
});

test("onay ve iptal aynı anda: yalnızca biri geçerli olur", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const { email } = await staff(browser, "admin");
  const claims =
    sql(`select json_build_object('sub', u.id, 'role', 'authenticated', 'aal', 'aal2', 'session_id', s.id)
    from auth.users u join auth.sessions s on s.user_id = u.id
    where u.email = '${email}' order by s.created_at desc limit 1`);
  const as = (query: string) =>
    psql(`begin; select set_config('request.jwt.claims', '${claims}', true); set local role authenticated;
          ${query}; commit;`);

  const no = await guestOrder(await separate(browser));
  const id = sql(`select id from public.orders where order_no = '${no}'`);
  await as(
    `select public.match_transfer('${id}', 30000, 'O-${no}', gen_random_uuid())`,
  );
  await as(
    `select public.confirm_transfer(id) from public.bank_transfers where reference = 'O-${no}'`,
  );

  // On onay aynı anda: stok bir kez düşer.
  const approvals = await Promise.all(
    Array.from({ length: 10 }, () =>
      as(`select public.approve_order('${id}')`),
    ),
  );
  expect(approvals.filter((r) => !r.startsWith("HATA"))).toHaveLength(1);
  // On iptal aynı anda: stok bir kez geri gelir.
  const cancels = await Promise.all(
    Array.from({ length: 10 }, () =>
      as(`select public.cancel_order('${id}', 'deneme')`),
    ),
  );
  expect(cancels.filter((r) => !r.startsWith("HATA"))).toHaveLength(1);
  expect(
    sql(
      `select string_agg(reason || delta, ',' order by seq) from public.stock_movements where order_id = '${id}'`,
    ),
  ).toBe("sale-1,cancel1");
});

// --- Kart ödemesi -----------------------------------------------------------

/** Kartla sipariş verir ve sahte bankanın sayfasında durur. */
async function guestCard(page: Page, email = newEmail()) {
  await toCheckout(page);
  await page.getByRole("radio", { name: "Kredi/banka kartı" }).check();
  await fillContact(page, email);
  await fillAddress(page);
  await accept(page);
  await submit(page).click();
  return atBank(page);
}

async function atBank(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Sahte banka" }),
  ).toBeVisible();
  const attempt = /sahte-odeme\/([0-9a-f-]{36})/.exec(page.url())![1];
  const no = /AB\w{10}/.exec(await main(page).innerText())![0];
  return { attempt, no };
}

const fact = (page: Page, text: string) =>
  expect(main(page).locator("dd").filter({ hasText: text })).toBeVisible();

const status = (no: string) =>
  sql(
    `select order_status || '/' || payment_status from public.orders where order_no = '${no}'`,
  );
const eventCount = (attempt: string) =>
  sql(
    `select count(*) from public.payment_events where attempt_id = '${attempt}'`,
  );

/** Sağlayıcının göndereceği bildirim. */
async function webhook(
  attempt: string,
  over: Record<string, unknown> = {},
  o: {
    secret?: string;
    signature?: string;
    provider?: string;
    body?: string;
  } = {},
) {
  const body =
    o.body ??
    JSON.stringify({
      event: `test-${attempt}`,
      attempt,
      ref: `S-${attempt}`,
      status: "paid",
      amount: 30000,
      currency: "TRY",
      code: null,
      ...over,
    });
  const response = await fetch(
    `http://localhost:3100/api/odeme/${o.provider ?? "fake"}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sahte-imza":
          o.signature ??
          createHmac("sha256", o.secret ?? envValue("FAKE_PAYMENT_SECRET"))
            .update(body)
            .digest("hex"),
      },
      body,
    },
  );
  return response.status;
}

test("kart: red, yeniden deneme, başarı ve panel", async ({
  page,
  browser,
}) => {
  test.slow();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const email = newEmail();

  const first = await guestCard(page, email);
  // Kart bilgisi istenmez: sayfada görünür giriş alanı yoktur.
  await expect(page.locator("input:visible")).toHaveCount(0);
  await accessible(page);
  await narrow(page);

  await button(page, "Kartı reddet").click();
  await expect(page.getByText("Kartınız reddedildi.")).toBeVisible();
  await expect(page).toHaveURL(`/siparis/${first.no}`);
  expect(status(first.no)).toBe("pending_payment/failed");
  await accessible(page);
  await narrow(page);

  await button(page, /^Kartla öde/).click();
  const second = await atBank(page);
  expect(second.no).toBe(first.no);
  expect(second.attempt).not.toBe(first.attempt);

  // Sonuçlanmadan sipariş sayfasına dönüp yeniden basmak aynı ödemeyi sürdürür.
  await page.goto(`/siparis/${first.no}`);
  await button(page, /^Kartla öde/).click();
  expect((await atBank(page)).attempt).toBe(second.attempt);

  await button(page, "Ödemeyi onayla").click();
  await fact(page, "Onay bekliyor");
  await fact(page, "Kredi/banka kartı · Ödendi");
  await expect(button(page, /^Kartla öde/)).toHaveCount(0);
  expect(
    sql(`select count(*) from public.orders where email = '${email}'`),
  ).toBe("1");
  expect(errors).toEqual([]);

  const { page: admin } = await staff(browser, "order_manager");
  await openInPanel(admin, first.no);
  const card = admin.getByRole("region", { name: "Kart ödemesi" });
  await expect(card.getByText("₺300,00 · Reddedildi")).toBeVisible();
  await expect(card.getByText("₺300,00 · Ödendi")).toBeVisible();
  await accessible(admin);
  await narrow(admin);
  await button(admin, "Siparişi onayla").click();
  await expect(button(admin, "Duruma geç: Hazırlanıyor")).toBeVisible();
});

test("kart: tarayıcının dönüşü kanıt değildir; bildirim gelmezse sağlayıcıya sorulur", async ({
  page,
  browser,
}) => {
  test.slow();
  const { attempt, no } = await guestCard(page);
  const bank = page.url();

  // Ödemeden dönüş adresine gitmek siparişi ödemez.
  await page.goto(`/siparis/${no}/odeme-donus?durum=basarili&tutar=30000`);
  await expect(page).toHaveURL(`/siparis/${no}`);
  await expect(page.getByText("Ödemeniz henüz görünmüyor.")).toBeVisible();
  expect(status(no)).toBe("pending_payment/pending");

  // Başkası dönüş adresinden siparişi göremez; banka sayfası imzasız açılmaz.
  const other = await separate(browser);
  await other.goto(`/siparis/${no}/odeme-donus`);
  await expect(
    other.getByRole("heading", { name: "Sipariş açılamadı" }),
  ).toBeVisible();
  await other.goto(`/sahte-odeme/${attempt}?imza=${"0".repeat(64)}`);
  await expect(
    other.getByRole("heading", { name: "Sayfa bulunamadı" }),
  ).toBeVisible();

  await page.goto(bank);
  await button(page, "Onayla, bildirim gönderme").click();
  await expect(page).toHaveURL(`/siparis/${no}`);
  // Sorgular arasında 5 saniye vardır.
  await expect(async () => {
    await page.goto(`/siparis/${no}/odeme-donus`);
    await fact(page, "Kredi/banka kartı · Ödendi");
  }).toPass({ timeout: 20_000 });
  expect(eventCount(attempt)).toBe("1");
  // Bildirim sonradan da gelse bir kez işlenir.
  expect(await webhook(attempt, { event: `olay-${attempt}` })).toBe(200);
  expect(status(no)).toBe("awaiting_approval/paid");
  expect(eventCount(attempt)).toBe("1");
});

test("kart: eksik tutar incelemeye düşer; panel sorgular ve iadeyi gösterir", async ({
  page,
  browser,
}) => {
  test.slow();
  const wrong = await guestCard(page);
  await button(page, "Eksik tutarla onayla").click();
  await fact(page, "Tutar inceleniyor");
  await expect(button(page, /^Kartla öde/)).toHaveCount(0);
  expect(status(wrong.no)).toBe("pending_payment/review");

  const { page: admin } = await staff(browser, "admin");
  await openInPanel(admin, wrong.no);
  await expect(admin.getByText("Tutar farklı (gelen ₺299,99)")).toBeVisible();
  await expect(button(admin, "Siparişi onayla")).toHaveCount(0);
  await admin.getByLabel("İptal nedeni").fill("Eksik tutar");
  await button(admin, "Siparişi iptal et").click();
  await fact(admin, "İade bekliyor");
  await admin.goto(`/yonetim/siparisler?durum=refund&ara=${wrong.no}`);
  await expect(admin.getByRole("link", { name: wrong.no })).toBeVisible();
  await accessible(admin);

  // Bildirimi gelmeyen ödemeyi personel sorgular.
  const silent = await guestCard(await separate(browser));
  await openInPanel(admin, silent.no);
  await button(admin, "Ödemeyi sorgula").click();
  await expect(admin.getByText("Ödeme sorgulandı.")).toBeVisible();
  expect(status(silent.no)).toBe("pending_payment/pending");
});

test("kart: sahte, bozuk ve başkasına ait bildirim reddedilir", async ({
  page,
}) => {
  test.slow();
  const { attempt, no } = await guestCard(page);
  const statuses = await Promise.all([
    webhook(attempt, {}, { signature: "" }),
    webhook(attempt, {}, { signature: "0".repeat(64) }),
    webhook(attempt, {}, { secret: "x".repeat(32) }),
    webhook(attempt, { status: "refunded" }),
    webhook(attempt, {}, { body: "{" }),
    webhook(attempt, {}, { body: "x".repeat(70_000) }),
    webhook(attempt, {}, { provider: "iyzico" }),
    webhook(randomUUID()),
    webhook(attempt, { event: "baska", ref: "S-baska" }),
  ]);
  expect(statuses).toEqual([401, 401, 401, 401, 401, 413, 404, 404, 409]);
  const get = await page.request.get("/api/odeme/fake");
  expect(get.status()).toBe(405);
  expect(status(no)).toBe("pending_payment/pending");
  expect(eventCount(attempt)).toBe("0");

  // Veritabanı fonksiyonu dışarıdan çağrılamaz.
  const direct = await rpc("record_card_event", {
    p_provider: "fake",
    p_event: "x",
    p_attempt: attempt,
    p_ref: `S-${attempt}`,
    p_status: "paid",
    p_amount: 30000,
    p_currency: "TRY",
  });
  expect(direct.ok).toBe(false);
  expect(direct.data.code).toBe("42501");
  expect(status(no)).toBe("pending_payment/pending");
});

test("kart: geç gelen para ve 50 eşzamanlı aynı bildirim", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "masaustu");
  test.slow();

  // Süre dolup sipariş düştükten sonra gelen para: stok varsa sipariş sürer.
  const late = await guestCard(await separate(browser));
  sql(
    `update public.orders set payment_due_at = now() - interval '1 second' where order_no = '${late.no}'`,
  );
  sql("select private.expire_orders()");
  expect(status(late.no)).toBe("cancelled/cancelled");
  expect(await webhook(late.attempt)).toBe(200);
  expect(status(late.no)).toBe("awaiting_approval/paid");

  const { attempt, no } = await guestCard(await separate(browser));
  const answers = await Promise.all(
    Array.from({ length: 50 }, () => webhook(attempt)),
  );
  expect(new Set(answers)).toEqual(new Set([200]));
  expect(status(no)).toBe("awaiting_approval/paid");
  expect(eventCount(attempt)).toBe("1");
  expect(
    sql(`select count(*) from public.order_status_history h join public.orders o on o.id = h.order_id
         where o.order_no = '${no}' and h.field = 'order_status' and h.to_value = 'awaiting_approval'`),
  ).toBe("1");

  // Aynı ödemenin 20 farklı numaralı haberi de ikinci kez ödeme sayılmaz.
  const other = await guestCard(await separate(browser));
  await Promise.all(
    Array.from({ length: 20 }, (_, n) =>
      webhook(other.attempt, { event: `haber-${n}-${other.attempt}` }),
    ),
  );
  expect(
    sql(`select string_agg(distinct result, ',' order by result) || ':' || count(*) filter (where result = 'paid')
         from public.payment_events where attempt_id = '${other.attempt}'`),
  ).toBe("ignored,paid:1");
});

test("kart: süre bitimi ile bildirim yarışı; para da stok da kaybolmaz", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const results = new Set<string>();
  for (let n = 0; n < 4; n++) {
    const { attempt, no } = await guestCard(await separate(browser));
    sql(
      `update public.orders set payment_due_at = now() - interval '1 second' where order_no = '${no}'`,
    );
    const [expired, answer] = await Promise.all([
      psql("select private.expire_orders()"),
      webhook(attempt),
    ]);
    expect(expired).not.toContain("HATA");
    expect(answer).toBe(200);
    results.add(
      sql(`select string_agg(to_value, '>' order by seq) from public.order_status_history h
           join public.orders o on o.id = h.order_id where o.order_no = '${no}' and field = 'order_status'`),
    );
    expect(
      sql(`select o.order_status || ':' || o.payment_status || ':' || string_agg(r.status, ',')
           from public.orders o join public.order_items i on i.order_id = o.id
           join public.stock_reservations r on r.order_item_id = i.id
           where o.order_no = '${no}' group by o.id`),
    ).toBe("awaiting_approval:paid:active");
  }
  info.annotations.push({
    type: "yarış",
    description: [...results].join(", "),
  });
});

test("kart: üye, mağazadan teslim siparişini kartla öder", async ({ page }) => {
  test.slow();
  await signUpAndConfirm(page, newEmail());
  await toCheckout(page);
  await page.getByRole("radio", { name: "Kredi/banka kartı" }).check();
  await page.getByRole("radio", { name: "Mağazadan teslim" }).check();
  await expect(
    page.getByRole("radio", { name: "Kredi/banka kartı" }),
  ).toBeChecked();
  await page.getByLabel("Ad soyad").fill("Deneme Kişi");
  await page.getByLabel("Cep telefonu").fill(newPhone());
  await fillAddress(page);
  await accept(page);
  await submit(page).click();
  const { no } = await atBank(page);
  await button(page, "Ödemeyi onayla").click();
  await fact(page, "Kredi/banka kartı · Ödendi");
  await expect(page).toHaveURL(`/siparis/${no}`);
});
