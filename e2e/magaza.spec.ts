import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newTag, removeCategory, seed, uploadImage } from "./urunler";
import { sql } from "./yardim";

const tag = newTag();
const category = `test-${tag}`;
test.beforeAll(async () => {
  const [hardal, mavi, ...rest] = await Promise.all(
    ["#f4b942", "#4f86c6", ...Array<string>(27).fill("#cfe8e1")].map(
      uploadImage,
    ),
  );
  const plain = () => [{ path: rest.pop()!, alt: "Sade" }];
  sql(`begin;
    insert into public.categories (name, slug, sort_order) values ('Test ${tag}', '${category}', 900);
    insert into public.categories (name, slug, parent_id, is_active)
      select 'Kapalı', '${category}-kapali', id, false from public.categories where slug = '${category}';
    insert into public.size_charts (name, category_id, rows)
      select 'Tablo ${tag}', id, '[["Beden","Boy"],["3-6 Ay","62-68"]]' from public.categories where slug = '${category}';
    ${seed(category, {
      name: `Işıltılı İnce Şort ${tag}`,
      slug: `isiltili-${tag}`,
      published: "2030-01-03",
      images: [
        { path: hardal, color: "hardal", alt: "Hardal, önden" },
        { path: mavi, color: "mavi", alt: "Mavi, önden" },
      ],
      variants: [
        ["hardal", "3-6A", 19990, 24990, 10],
        ["hardal", "6-9A", 21990, null, 2],
        ["mavi", "3-6A", 29990, null, 0],
        ["mavi", "9-12A", 29990, null, 7],
      ],
    })}
    ${seed(category, { name: `Tükenen Hırka ${tag}`, slug: `tukenen-${tag}`, published: "2030-01-05", images: plain(), variants: [["pembe", "3-6A", 5000, null, 0]] })}
    ${seed(category, { name: `Pahalı Takım ${tag}`, slug: `pahali-${tag}`, published: "2030-01-04", images: plain(), variants: [["lila", "6-9A", 99990, null, 50]] })}
    ${seed(category, { name: `Gizli Taslak ${tag}`, slug: `gizli-${tag}`, status: "draft", images: plain(), variants: [["pembe", "3-6A", 5000, null, 5]] })}
    ${Array.from({ length: 24 }, (_, i) =>
      seed(category, {
        name: `Sıradan ${tag} ${i}`,
        slug: `siradan-${tag}-${i}`,
        published: "2020-01-01",
        images: plain(),
        variants: [["beyaz", "YD", 10000 + i * 100, null, 5]],
      }),
    ).join("\n")}
    commit;`);
});

test.afterAll(async () => {
  sql(`delete from public.size_charts where name = 'Tablo ${tag}';
       delete from public.categories where slug = '${category}-kapali';`);
  await removeCategory(category);
});

const cards = (page: Page) =>
  page.getByRole("main").locator("a[href^='/urun/']:visible");

const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`),
    page.url(),
  ).toEqual([]);
}

test("Türkçe arama: büyük/küçük harf ve İ/I/ı/i farkı sonucu değiştirmez", async ({
  page,
}) => {
  for (const word of [
    "Işıltılı",
    "IŞILTILI",
    "ışıltılı",
    "isiltili",
    "İŞİLTİLİ",
    "Işıltılı".normalize("NFD"),
    "ince ŞORT",
    "INCE sort",
    "hardal pamuk",
    "işılt",
  ]) {
    await page.goto(`/ara?q=${encodeURIComponent(`${word} ${tag}`)}`);
    await expect(cards(page), word).toHaveText([`Işıltılı İnce Şort ${tag}`]);
  }

  // Sözcüğün ortası ve başka sözcük eşleşmez; özel karakter yok sayılır.
  for (const [word, count] of [
    ["ltılı", 0],
    ["pantolon", 0],
    ["%", 24],
    ["_", 24],
  ] as const) {
    await page.goto(`/ara?q=${encodeURIComponent(`${word} ${tag}`)}`);
    await expect(cards(page), word).toHaveCount(count);
  }

  // Arama kutusundan; yazılan etiket sayfada metin olarak kalır.
  await page.goto("/");
  await page
    .getByRole("searchbox", { name: "Ürün ara" })
    .fill(`<b>x ${tag}yok`);
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `“<b>x ${tag}yok” için sonuçlar`,
  );
  await expect(page.getByText("Aradığınız ürünü bulamadık.")).toBeVisible();
});

test("kategori: süzgeç, sıralama ve sayfalar", async ({ page, isMobile }) => {
  const main = page.getByRole("main");
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Kategoriler" })
    .getByRole("link", { name: `Test ${tag}` })
    .click();
  await expect(page).toHaveURL(`/kategori/${category}`);
  await expect(main.getByRole("status")).toHaveText("27 ürün");
  await expect(cards(page)).toHaveCount(24);
  // Yeni yayınlanan önce, tükenen en sonda; taslak ve kapalı kategori görünmez.
  await expect(cards(page).first()).toHaveText(`Pahalı Takım ${tag}`);
  await expect(page.getByText("Gizli Taslak")).toHaveCount(0);
  await expect(page.getByText("Kapalı")).toHaveCount(0);

  await page.getByRole("link", { name: "Sonraki" }).click();
  await expect(page.getByText("Sayfa 2 / 2")).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).last()).toHaveText(`Tükenen Hırka ${tag}`);

  await page.getByRole("link", { name: "Fiyat azalan" }).click();
  await expect(page).toHaveURL(`/kategori/${category}?sirala=fiyat-azalan`);
  await expect(cards(page).nth(1)).toHaveText(`Işıltılı İnce Şort ${tag}`);
  await page.getByRole("link", { name: "Fiyat artan" }).click();
  await expect(cards(page).first()).toHaveText(`Sıradan ${tag} 0`);

  // Süzgeç; sıralama korunur.
  if (isMobile) await page.getByRole("button", { name: /^Filtrele/ }).click();
  await page.getByRole("checkbox", { name: "3-6 Ay" }).check();
  await page.getByRole("checkbox", { name: "Mavi" }).check();
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(main.getByRole("status")).toHaveText("1 ürün");
  expect(new URL(page.url()).searchParams.get("sirala")).toBe("fiyat-artan");
  // Mavi 3-6 Ay tükendi: süzgeç tek varyanta bakar.
  await expect(main.getByText("Tükendi")).toBeVisible();

  await page.getByRole("link", { name: /Mavi\s*süzgecini kaldır/ }).click();
  await expect(main.getByRole("status")).toHaveText("2 ürün");
  await page.goto(`/kategori/${category}?beden=3-6A&renk=mavi&stok=var`);
  await expect(
    page.getByText("Seçtiğiniz süzgeçlere uyan ürün yok."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Hepsini kaldır" }).click();
  await expect(main.getByRole("status")).toHaveText("27 ürün");
  await page.goto(`/kategori/${category}?en-az=200&en-cok=1.000`);
  await expect(cards(page)).toHaveText([
    `Pahalı Takım ${tag}`,
    `Işıltılı İnce Şort ${tag}`,
  ]);

  // Bozuk adres hata vermez.
  await page.goto(`/kategori/${category}?beden=%3Cx%3E&sayfa=abc&en-az=-1`);
  await expect(main.getByRole("status")).toHaveText("27 ürün");
  await noOverflow(page);
});

test("ürün: renk ve beden seçimi; gizli bilgi ve betik sızmaz", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`/urun/isiltili-${tag}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Işıltılı İnce Şort ${tag}` }),
  ).toBeVisible();
  const gallery = page.getByRole("region", { name: "Ürün görselleri" });
  await expect(gallery.getByRole("img")).toHaveCount(1);
  await expect(gallery.getByAltText("Hardal, önden")).toBeVisible();
  await expect
    .poll(() =>
      gallery
        .getByRole("img")
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);

  const main = page.getByRole("main");
  const status = main.getByRole("status").first();
  const size = (name: string | RegExp) =>
    page.getByRole("radio", { name, exact: true });
  await expect(status).toContainText("beden seçin");
  await size("3-6 Ay").check();
  await expect(status).toHaveText("Stokta");
  await expect(main.getByText("₺199,90")).toBeVisible();
  await expect(main.getByText("₺249,90")).toBeVisible();
  await size("6-9 Ay").check();
  await expect(status).toHaveText("Az kaldı");
  await expect(main.getByText("₺219,90")).toBeVisible();

  // Yeni renkte bu beden yok: seçim kalkar, görsel değişir.
  await size("Mavi").check();
  await expect(gallery.getByAltText("Mavi, önden")).toBeVisible();
  await expect(gallery.getByAltText("Hardal, önden")).toHaveCount(0);
  await expect(status).toContainText("beden seçin");
  await expect(size(/3-6 Ay\s*\(tükendi\)/)).toBeDisabled();

  await page.getByText(`Beden tablosu: Tablo ${tag}`).click();
  await expect(page.getByRole("cell", { name: "62-68" })).toBeVisible();

  // Açıklamadaki etiketler metin olarak görünür, çalışmaz.
  await expect(page.getByText("<b>Yumuşak</b> <script>")).toBeVisible();
  expect(
    await page.evaluate(() => (window as { sizdi?: number }).sizdi),
  ).toBeUndefined();

  const html = await (await page.request.get(`/urun/isiltili-${tag}`)).text();
  expect(html).toContain("Işıltılı İnce Şort");
  expect(html).not.toMatch(/GZL-|on_hand|reserved|barcode|vat_bps|"cost"/);
  expect(await page.context().cookies()).toEqual([]);
  expect(errors).toEqual([]);
  await noOverflow(page);
});

test("taslak, kapalı kategori ve olmayan adres açılmaz", async ({ page }) => {
  for (const path of [
    `/urun/gizli-${tag}`,
    "/urun/olmayan",
    `/kategori/${category}-kapali`,
    "/kategori/olmayan",
    "/olmayan",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Sayfa bulunamadı" }),
      path,
    ).toBeVisible();
    await expect(page.locator("meta[name=robots]").first()).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.getByText("Gizli Taslak")).toHaveCount(0);
  }
});

test("erişilebilirlik: WCAG 2.2 AA taraması, klavye ve dar ekran", async ({
  page,
  isMobile,
}) => {
  test.slow();
  const paths = [
    "/",
    "/ara",
    `/ara?q=${tag}yok`,
    `/kategori/${category}?beden=3-6A`,
    `/urun/isiltili-${tag}`,
    "/urun/olmayan",
    "/giris",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await axe(page);
  }

  // Açık süzgeç ve seçili beden de taranır.
  await page.goto(`/kategori/${category}`);
  if (isMobile) await page.getByRole("button", { name: "Filtrele" }).click();
  await expect(page.getByRole("checkbox", { name: "3-6 Ay" })).toBeVisible();
  await axe(page);
  await page.goto(`/urun/isiltili-${tag}`);
  await page.getByRole("radio", { name: "6-9 Ay" }).check();
  await page.getByText(`Beden tablosu: Tablo ${tag}`).click();
  await axe(page);

  // Klavye: içeriğe geçme bağlantısı, sonra ok tuşuyla renk.
  await page.goto(`/urun/isiltili-${tag}`);
  const skip = page.getByRole("link", { name: "İçeriğe geç" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.getByRole("radio", { name: "Hardal" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Mavi" })).toBeChecked();

  // %400 yakınlaştırma 320 piksele karşılık gelir.
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noOverflow(page);
  }
});

test("yavaş telefonda en büyük içerik 2,5 saniyede görünür @yuk", async ({
  browser,
}) => {
  test.slow();
  const buyer = await browser.newContext();
  const shopping = await buyer.newPage();
  await shopping.goto(`/urun/pahali-${tag}`);
  await shopping.getByRole("radio", { name: "6-9 Ay" }).check();
  await shopping.getByRole("button", { name: "Sepete ekle" }).click();
  await expect(shopping.getByText("Sepete eklendi.")).toBeVisible();
  const cart = await buyer.storageState();
  await buyer.close();

  for (const [path, storageState] of [
    ["/"],
    [`/kategori/${category}`],
    [`/urun/isiltili-${tag}`],
    [`/ara?q=${tag}`],
    // Sepeti dolu misafir: her sayfa sepeti de okur.
    ["/", cart],
    [`/urun/isiltili-${tag}`, cart],
    ["/sepet", cart],
  ] as const) {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 412, height: 823 },
      deviceScaleFactor: 1.75,
      isMobile: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Lighthouse'un "yavaş 4G" telefonu.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const { lcp, cls, element } = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number; element: string }>((done) => {
          let lcp = 0;
          let element = "";
          let cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              lcp = e.startTime;
              element =
                (e as unknown as { element?: Element }).element?.tagName ?? "";
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              const shift = e as unknown as {
                value: number;
                hadRecentInput: boolean;
              };
              if (!shift.hadRecentInput) cls += shift.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => done({ lcp, cls, element }), 500);
        }),
    );
    console.log(
      `${path.replace(tag, "…")}${storageState ? " (sepetli)" : ""}: LCP ${Math.round(lcp)} ms (${element}), CLS ${cls.toFixed(3)}`,
    );
    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThanOrEqual(2500);
    expect(cls).toBeLessThanOrEqual(0.1);
    await context.close();
  }
});
