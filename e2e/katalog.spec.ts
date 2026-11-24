import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { grantRole, newEmail, setUpMfa, signUpAndConfirm, sql } from "./yardim";

const run = promisify(execFile);

/** Test ürününü siler; yalnızca ekleme koruması sadece bu temizlikte atlanır. */
function removeProduct(name: string) {
  const product = `(select id from public.products where name = '${name}')`;
  const variants = `(select id from public.product_variants where product_id = ${product})`;
  sql(`begin;
       alter table public.price_history disable trigger price_history_append_only;
       delete from public.price_history where variant_id in ${variants};
       alter table public.price_history enable trigger price_history_append_only;
       update public.products set status = 'draft', archived_at = null where name = '${name}';
       delete from public.variant_costs where variant_id in ${variants};
       delete from public.product_images where product_id = ${product};
       delete from public.product_categories where product_id = ${product};
       delete from public.product_variants where product_id = ${product};
       set constraints all immediate;
       delete from public.products where name = '${name}';
       commit;`);
}

async function staff(page: Page, role: string) {
  const email = newEmail();
  await signUpAndConfirm(page, email);
  grantRole(email, role);
  await setUpMfa(page);
}

const section = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);

test("Ürün Yöneticisi ürün hazırlar; hatalı girişler reddedilir", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Zıbın ${randomUUID().slice(0, 8)}`;
  const reader = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();
  page.on("dialog", (d) => d.accept());

  try {
    await staff(page, "product_manager");
    await expect(page.getByRole("link", { name: "Personel" })).toHaveCount(0);
    await page.getByRole("link", { name: "Ürünler" }).click();
    await page.getByRole("link", { name: "Yeni ürün" }).click();
    await expect(
      page.getByRole("heading", { name: "Yeni ürün" }),
    ).toBeVisible();

    // KDV için hazır oran yok; hatada yazılanlar kaybolmaz.
    await page.getByLabel("Ürün adı", { exact: true }).fill(name);
    await page.getByLabel("Kime").selectOption({ label: "Bebek" });
    await page.getByLabel("Cinsiyet").selectOption({ label: "Unisex" });
    await expect(page.getByLabel("KDV oranı (%)")).toHaveValue("");
    await page.getByLabel("KDV oranı (%)").fill("yüz");
    await page.getByRole("button", { name: "Ürünü oluştur" }).click();
    await expect(page.getByText("KDV oranını yazın.")).toBeVisible();
    await expect(page.getByLabel("Ürün adı", { exact: true })).toHaveValue(
      name,
    );
    await page.getByLabel("KDV oranı (%)").fill("10");
    await page.getByLabel("Açıklama", { exact: true }).fill("Yumuşak zıbın.");
    await page.getByLabel("Malzeme").fill("%100 pamuk");
    await page.getByRole("button", { name: "Ürünü oluştur" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Durum: Taslak")).toBeVisible();

    // Eksik ürün yayınlanamaz.
    await page.getByRole("button", { name: "Yayınla" }).click();
    await expect(
      page.getByText("Yayın için ana kategori gerekir."),
    ).toBeVisible();
    await page.getByLabel("Ana kategori").selectOption({ label: "Bebek" });
    await page.getByRole("button", { name: "Kategorileri kaydet" }).click();
    await expect(page.getByText("Kategoriler kaydedildi.")).toBeVisible();

    // Varyantlar: SKU önerilir.
    const variants = section(page, "Varyantlar");
    await variants.getByText("Varyant ekle", { exact: true }).click();
    const creator = variants.locator("details").filter({ hasText: "Renkler" });
    await creator.getByLabel("Hardal").check();
    await creator.getByLabel("3-6 Ay").check();
    await creator.getByLabel("6-9 Ay").check();
    const first = creator.getByRole("group", { name: "Hardal / 3-6 Ay" });
    const suggested = await first.getByLabel("SKU").inputValue();
    expect(suggested).toMatch(/^AB-\d{4,}-HAR-3-6A$/);
    await first.getByLabel("Barkod").fill("0" + Date.now());
    await creator.getByLabel("Fiyat (TL)").fill("249.90");
    await creator.getByRole("button", { name: "2 varyantı ekle" }).click();
    await expect(creator.getByRole("alert")).toContainText("249,90");
    await creator.getByLabel("Fiyat (TL)").fill("249,90");
    await creator.getByRole("button", { name: "2 varyantı ekle" }).click();
    await expect(creator.getByText("2 varyant eklendi.")).toBeVisible();
    const row = variants.getByRole("listitem", { name: suggested });
    await expect(row).toBeVisible();

    // Yinelenen SKU reddedilir (küçük harfle yazılsa da).
    await creator.getByLabel("Hardal").uncheck();
    await creator.getByLabel("6-9 Ay").uncheck();
    await creator.getByLabel("Mavi").check();
    await creator
      .getByRole("group", { name: "Mavi / 3-6 Ay" })
      .getByLabel("SKU")
      .fill(suggested.toLowerCase());
    await creator.getByLabel("Fiyat (TL)").fill("100");
    await creator.getByRole("button", { name: "1 varyantı ekle" }).click();
    await expect(creator.getByRole("alert")).toContainText("Bu SKU başka");

    // Fiyat değişir; maliyet Ürün Yöneticisine görünmez.
    await row.locator("summary").click();
    await expect(row.getByLabel("Alış maliyeti (TL)")).toHaveCount(0);
    await row.getByLabel("Fiyat (TL)", { exact: true }).fill("199,90");
    await row.getByRole("button", { name: "Varyantı kaydet" }).click();
    await expect(row.locator("summary")).toContainText("₺199,90");

    // Sahte ve uygunsuz dosyalar reddedilir.
    const images = section(page, "Görseller");
    const upload = async (buffer: Buffer) => {
      await images
        .getByLabel("Görsel dosyası")
        .setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer });
      await images.getByLabel("Görsel açıklaması").fill("Hardal zıbın, önden");
      await images.getByRole("button", { name: "Görseli yükle" }).click();
    };
    await upload(Buffer.from("<script>alert(1)</script>"));
    await expect(images.getByRole("alert")).toContainText("geçerli bir görsel");
    await upload(Buffer.alloc(4 * 1024 * 1024 + 1));
    await expect(images.getByRole("alert")).toContainText("en fazla 4 MB");
    const gif = await sharp({
      create: { width: 9, height: 9, channels: 3, background: "red" },
    })
      .gif()
      .toBuffer();
    await upload(gif);
    await expect(images.getByRole("alert")).toContainText("Yalnızca JPEG");

    // Konum bilgili, 4 MB sınırına yakın gerçek görsel kabul edilir; bilgi silinir.
    const photo = await sharp({
      create: {
        width: 1250,
        height: 1050,
        channels: 3,
        background: "#888",
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png({ compressionLevel: 0 })
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "39/1 46/1 0/1" } })
      .toBuffer();
    expect(photo.length).toBeGreaterThan(3.5 * 1024 * 1024);
    expect(photo.length).toBeLessThan(4 * 1024 * 1024);
    await upload(photo);
    await expect(images.getByText("Görsel yüklendi.")).toBeVisible();
    const image = images.getByRole("img", { name: "Hardal zıbın, önden" });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    const path = sql(
      `select path from public.product_images where product_id =
       (select id from public.products where name = '${name}')`,
    );
    const stored = await page.request.get(`/gorsel/${path}`);
    expect(stored.headers()["content-type"]).toBe("image/webp");
    const meta = await sharp(await stored.body()).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    for (const bad of ["x.svg", "..%2F..%2Fetc.webp", `${randomUUID()}.webp`]) {
      expect((await page.request.get(`/gorsel/${bad}`)).status()).toBe(404);
    }

    // Yayın ve son görsel koruması.
    await page.getByRole("button", { name: "Yayınla" }).click();
    await expect(page.getByText("Durum: Yayında")).toBeVisible();
    await images.getByRole("button", { name: "Görseli sil" }).click();
    await expect(
      images.getByText("Yayın için en az bir görsel gerekir."),
    ).toBeVisible();
    await page.reload();
    await expect(image).toBeVisible();
    await noOverflow(page);
    const url = page.url();

    // Arama: ad ve SKU ile bulunur; süzgeç karakterleri zararsızdır.
    for (const [query, count] of [
      [name, 1],
      [suggested, 1],
      ["yok%,id.not.is.null)", 0],
    ] as const) {
      await page.goto(
        `/yonetim/katalog?${new URLSearchParams({ ara: query })}`,
      );
      await expect(
        page.getByRole("heading", { name: "Ürünler" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name })).toHaveCount(count);
    }

    // Stok Yöneticisi ürünü görür ama değiştiremez.
    await staff(reader, "stock_manager");
    await reader.goto(url);
    await expect(reader.getByRole("heading", { name })).toBeVisible();
    await expect(reader.getByLabel("Ürün adı", { exact: true })).toBeDisabled();
    await expect(reader.locator("main").getByRole("button")).toHaveCount(0);
    await reader.goto("/yonetim/katalog/yeni");
    await expect(reader.getByText("404")).toBeVisible();

    // Admin maliyeti yazar; işlem geçmişi eski ve yeni değeri gösterir.
    await staff(admin, "admin");
    await admin.goto(url);
    const adminRow = admin.getByRole("listitem", { name: suggested });
    await adminRow.locator("summary").click();
    for (const cost of ["90", "95,50"]) {
      await adminRow.getByLabel("Alış maliyeti (TL)").fill(cost);
      await adminRow.getByRole("button", { name: "Maliyeti kaydet" }).click();
      await expect
        .poll(() =>
          sql(`select c.cost from public.variant_costs c
               join public.product_variants v on v.id = c.variant_id
               where v.sku = '${suggested}'`),
        )
        .toBe(cost === "90" ? "9000" : "9550");
    }
    await admin.goto("/yonetim/islem-gecmisi");
    const entries = admin.getByRole("listitem").filter({ hasText: suggested });
    await expect(entries.getByText("Maliyet: 90,00 → 95,50")).toBeVisible();

    // Taslakta son görsel silinebilir; dosya da gider.
    await page.goto(url);
    await page.getByRole("button", { name: "Taslağa al" }).click();
    await expect(page.getByText("Durum: Taslak")).toBeVisible();
    await images.getByRole("button", { name: "Görseli sil" }).click();
    await expect(images.getByText("Henüz görsel yok.")).toBeVisible();
    expect(
      sql(`select count(*) from storage.objects where name = '${path}'`),
    ).toBe("0");
  } finally {
    removeProduct(name);
    await reader.context().close();
    await admin.context().close();
  }
});

test("seçim listeleri ve kategoriler", async ({ page }) => {
  test.slow();
  const brand = `E2E Marka ${randomUUID().slice(0, 8)}`;
  page.on("dialog", (d) => d.accept());
  try {
    await staff(page, "product_manager");
    await page.goto("/yonetim/katalog/listeler");
    const brands = section(page, "Markalar");
    const row = brands.getByRole("listitem", { name: brand });
    const add = async () => {
      await brands.getByLabel("Ad", { exact: true }).last().fill(brand);
      await brands.getByRole("button", { name: "Marka ekle" }).click();
    };
    await brands.locator("summary", { hasText: "Marka ekle" }).click();
    await add();
    await expect(row).toBeVisible();
    await add();
    await expect(brands.getByRole("alert")).toContainText("başka bir kayıt");
    await row.locator("summary").click();
    await row.getByRole("button", { name: "Sil" }).click();
    await expect(row).toHaveCount(0);
    await noOverflow(page);

    // Kategori kendi altına taşınamaz; alt kategorisi olan silinemez.
    await page.goto("/yonetim/katalog/kategoriler");
    const adult = page.getByRole("listitem", { name: "Yetişkin", exact: true });
    await adult.locator("summary").click();
    await adult.getByLabel("Üst kategori").selectOption({ label: "— Tişört" });
    await adult.getByRole("button", { name: "Kaydet" }).click();
    await expect(
      adult.getByText("Kategori kendi altına taşınamaz."),
    ).toBeVisible();
    await adult.getByRole("button", { name: "Sil" }).click();
    await expect(adult.getByText("Kayıt kullanımda")).toBeVisible();
    await noOverflow(page);
  } finally {
    sql(`delete from public.brands where name = '${brand}'`);
  }
});

test("aynı SKU'yu aynı anda ekleyen iki istekten yalnızca biri başarılı olur", async () => {
  const name = `E2E Yarış ${randomUUID().slice(0, 8)}`;
  const sku = `YARIS-${randomUUID().slice(0, 8).toUpperCase()}`;
  sql(`insert into public.products (name, slug, audience, gender, vat_bps)
       values ('${name}', '${sku.toLowerCase()}', 'baby', 'unisex', 1000)`);
  try {
    const insert = (size: string) =>
      run("docker", [
        "exec",
        "supabase_db_alis-bebe",
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-qAtc",
        `begin;
         insert into public.product_variants (product_id, color_id, size_id, sku, price)
         select p.id, c.id, s.id, '${sku}', 100
         from public.products p, public.colors c, public.sizes s
         where p.name = '${name}' and c.code = 'HAR' and s.code = '${size}';
         select pg_sleep(0.5);
         commit;`,
      ]);
    const results = await Promise.allSettled([insert("3-6A"), insert("6-9A")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      sql(`select count(*) from public.product_variants where sku = '${sku}'`),
    ).toBe("1");
  } finally {
    removeProduct(name);
  }
});
