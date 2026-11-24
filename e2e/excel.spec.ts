import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import writeXlsxFile from "write-excel-file/node";
import { grantRole, newEmail, setUpMfa, signUpAndConfirm, sql } from "./yardim";

const run = promisify(execFile);
const MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Value = string | number;

/** Metinler metin hücresi, sayılar sayı hücresi olur. */
async function workbook(header: string[], ...rows: Value[][]) {
  const buffer = await writeXlsxFile(
    [header, ...rows].map((row) =>
      row.map((value) =>
        typeof value === "number"
          ? { value, type: Number }
          : { value, type: String, format: "@" },
      ),
    ),
  ).toBuffer();
  return { name: `deneme-${randomUUID()}.xlsx`, mimeType: MIME, buffer };
}

async function upload(
  page: Page,
  kind: "Ürün" | "Stok",
  file: { name: string; mimeType: string; buffer: Buffer },
  mode?: string,
) {
  await page.goto("/yonetim/excel");
  if (mode) await page.getByLabel("Miktar ne anlama").selectOption(mode);
  await page.getByLabel(`${kind} dosyası (.xlsx)`).setInputFiles(file);
  await page
    .getByRole("button", { name: `Yükle ve kontrol et (${kind})` })
    .click();
}

/** Önizleme açılana kadar bekler ve yüklemenin kimliğini döndürür. */
async function preview(page: Page, name: string) {
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url().split("/").at(-1)!;
}

/** Önceki sayfa gizli olarak durabilir; yalnızca görünen yazıya bakılır. */
const expectApplied = (page: Page) =>
  expect(
    page.getByText("Uygulandı", { exact: true }).filter({ visible: true }),
  ).toBeVisible();

async function staff(page: Page, role: string) {
  const email = newEmail();
  await signUpAndConfirm(page, email);
  grantRole(email, role);
  await setUpMfa(page);
  return email;
}

/** Önekle başlayan test verisini siler; ekleme koruması yalnızca burada atlanır. */
function cleanUp(prefix: string, emails: string[]) {
  const variants = `(select id from public.product_variants where sku like '${prefix}%')`;
  const jobs = `(select j.id from public.import_jobs j join auth.users u on u.id = j.created_by
    where u.email in (${emails.map((e) => `'${e}'`).join(",") || "''"}))`;
  sql(`begin;
       create temp table p on commit drop as
         select distinct product_id as id from public.product_variants where sku like '${prefix}%';
       alter table public.price_history disable trigger price_history_append_only;
       alter table public.stock_movements disable trigger stock_movements_append_only;
       alter table public.import_rows disable trigger import_rows_append_only;
       delete from public.import_rows where job_id in ${jobs};
       delete from public.import_jobs where id in ${jobs};
       delete from public.price_history where variant_id in ${variants};
       delete from public.stock_movements where variant_id in ${variants};
       alter table public.price_history enable trigger price_history_append_only;
       alter table public.stock_movements enable trigger stock_movements_append_only;
       alter table public.import_rows enable trigger import_rows_append_only;
       delete from public.inventory where variant_id in ${variants};
       delete from public.product_variants where sku like '${prefix}%';
       set constraints all immediate;
       delete from public.product_categories where product_id in (select id from p);
       delete from public.products where id in (select id from p);
       commit;`);
}

const newPrefix = () => `XL-${randomUUID().slice(0, 6).toUpperCase()}`;
const price = (sku: string) =>
  sql(`select price from public.product_variants where sku = '${sku}'`);
const stock = (sku: string) =>
  sql(`select i.on_hand from public.inventory i
       join public.product_variants v on v.id = i.variant_id where v.sku = '${sku}'`);

/** Kişinin oturumuyla veritabanında çalışan komut. */
const claimsOf = (email: string) =>
  sql(`select json_build_object('sub', u.id, 'role', 'authenticated',
    'aal', 'aal2', 'session_id', s.id) from auth.users u
    join auth.sessions s on s.user_id = u.id where u.email = '${email}' limit 1`);

async function runAs(email: string, statement: string, times = 1) {
  const { stdout } = await run("docker", [
    "exec",
    "-e",
    `Q=select set_config('request.jwt.claims', '${claimsOf(email)}', false);
       set role authenticated; ${statement}`,
    "supabase_db_alis-bebe",
    "bash",
    "-c",
    `for i in $(seq ${times}); do psql -U postgres -qAtc "$Q" 2>&1 & done; wait`,
  ]);
  return stdout;
}

test("ürün dosyası: hatalı dosya yazmaz, önizlenir ve tek seferde uygulanır", async ({
  page,
}) => {
  test.slow();
  const prefix = newPrefix();
  const emails: string[] = [];
  page.on("dialog", (d) => d.accept());
  const newHeader = [
    "Ürün",
    "Ürün adı",
    "Ana kategori",
    "Kime",
    "Cinsiyet",
    "KDV %",
    "SKU",
    "Renk",
    "Beden",
    "Barkod",
    "Fiyat",
  ];
  const barcode = `00${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const rows = (size: string): Value[][] => [
    [
      "z1",
      `E2E ${prefix}`,
      "Bebek",
      "Bebek",
      "Unisex",
      10,
      `${prefix}-A`,
      "Hardal",
      "3-6 Ay",
      barcode,
      249.9,
    ],
    ["z1", "", "", "", "", "", `${prefix}-B`, "Hardal", size, "", "259,90"],
  ];

  try {
    emails.push(await staff(page, "product_manager"));
    await page.goto("/yonetim");
    await page.getByRole("link", { name: "Excel" }).click();
    await expect(page.getByRole("heading", { name: "Excel" })).toBeVisible();
    // Ürün Yöneticisi stok dosyası yükleyemez.
    await expect(page.getByText("Stok dosyası")).toHaveCount(0);
    expect(
      (await page.request.get("/yonetim/excel/indir?tur=stock")).status(),
    ).toBe(404);

    // Şablon iner.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Boş şablonu indir (Ürün)" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("urunler-sablon.xlsx");
    const template = await readFile((await download.path())!);
    await upload(page, "Ürün", {
      name: "s.xlsx",
      mimeType: MIME,
      buffer: template,
    });
    await expect(page.getByText("Dosyada veri satırı yok.")).toBeVisible();

    // Sahte dosya.
    await upload(page, "Ürün", {
      name: "sahte.xlsx",
      mimeType: MIME,
      buffer: Buffer.from("bu bir Excel dosyası değil ".repeat(10)),
    });
    await expect(page.getByText("Yalnızca .xlsx dosyası")).toBeVisible();

    // Tek hatalı satır: önizleme açılır, uygulama düğmesi yoktur, kayıt değişmez.
    const bad = await workbook(newHeader, ...rows("3-7 Ay"));
    await upload(page, "Ürün", bad);
    const badId = await preview(page, bad.name);
    await expect(
      page
        .getByRole("listitem", { name: "Satır 3" })
        .getByText('Beden: "3-7 Ay" bulunamadı.'),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /uygula/ })).toHaveCount(0);
    expect(
      await runAs(
        emails[0],
        `select public.apply_import('${badId}', true, true)`,
      ),
    ).toContain("Hatalı satır");
    expect(
      sql(`select count(*) from public.products where name = 'E2E ${prefix}'`),
    ).toBe("0");

    // Düzeltilmiş dosya.
    const good = await workbook(newHeader, ...rows("6-9 Ay"));
    await upload(page, "Ürün", good);
    await preview(page, good.name);
    await expect(page.getByText(`Barkod: ${barcode}`)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "2 satırı uygula" }).click();
    await expectApplied(page);
    await expect(page.getByRole("button", { name: /uygula/ })).toHaveCount(0);
    expect(
      sql(`select p.status, count(*), min(v.barcode), min(v.price)
           from public.products p join public.product_variants v on v.product_id = p.id
           where p.name = 'E2E ${prefix}' group by p.status`),
    ).toBe(`draft|2|${barcode}|24990`);

    // Aynı dosya: kayıtlarla aynı.
    await upload(page, "Ürün", good);
    await preview(page, good.name);
    await expect(page.getByText("uygulanacak değişiklik yok")).toBeVisible();

    // %10 fiyat artışı ayrıca onay ister.
    const raise = await workbook(["SKU", "Fiyat"], [`${prefix}-A`, 274.89]);
    await upload(page, "Ürün", raise);
    await preview(page, raise.name);
    await expect(page.getByText("249,90 → 274,89")).toBeVisible();
    await expect(page.getByText(/1 satırda fiyat %10/)).toBeVisible();
    await page.getByRole("button", { name: "1 satırı uygula" }).click();
    expect(price(`${prefix}-A`)).toBe("24990");
    await page.getByLabel("Fiyat değişikliklerini kontrol ettim").check();
    await page.getByRole("button", { name: "1 satırı uygula" }).click();
    await expectApplied(page);
    expect(price(`${prefix}-A`)).toBe("27489");

    // %10'un altı uyarmaz; önizlemeden sonra değişen fiyat uygulamayı durdurur.
    const small = await workbook(["SKU", "Fiyat"], [`${prefix}-B`, "270,00"]);
    await upload(page, "Ürün", small);
    await preview(page, small.name);
    await expect(page.getByText(/%10/)).toHaveCount(0);
    sql(
      `update public.product_variants set price = 26000 where sku = '${prefix}-B'`,
    );
    await page.getByRole("button", { name: "1 satırı uygula" }).click();
    await expect(page.getByText("önizlemeden sonra değişmiş")).toBeVisible();
    expect(price(`${prefix}-B`)).toBe("26000");

    // Dışa aktarılan dosya SKU'yu içerir.
    const exported = await page.request.get(
      "/yonetim/excel/indir?tur=products&parca=1",
    );
    expect(exported.headers()["content-type"]).toBe(MIME);
    expect(exported.headers()["cache-control"]).toContain("no-store");
  } finally {
    cleanUp(prefix, emails);
  }
});

test("stok dosyası ve roller", async ({ page, browser }) => {
  test.slow();
  const prefix = newPrefix();
  const emails: string[] = [];
  const other = await (await browser.newContext()).newPage();
  page.on("dialog", (d) => d.accept());
  sql(`insert into public.products (name, slug, audience, gender, vat_bps)
       values ('E2E ${prefix}', '${prefix.toLowerCase()}', 'baby', 'unisex', 1000);
       insert into public.product_variants (product_id, color_id, size_id, sku, price)
       select p.id, c.id, s.id, '${prefix}-' || s.code, 100
       from public.products p, public.colors c, public.sizes s
       where p.name = 'E2E ${prefix}' and c.code = 'HAR' and s.code in ('3-6A', '6-9A')`);

  try {
    // Oturumsuz kişi girişe yönlenir; izinsiz personel sayfayı görmez.
    await other.goto("/yonetim/excel");
    await expect(other).toHaveURL(/\/giris/);
    emails.push(await staff(other, "customer_service"));
    await expect(other.getByRole("link", { name: "Excel" })).toHaveCount(0);
    await other.goto("/yonetim/excel");
    await expect(other.getByText("404")).toBeVisible();
    for (const kind of ["products", "stock"]) {
      const response = await other.request.get(
        `/yonetim/excel/indir?tur=${kind}&parca=1`,
      );
      expect(response.status()).toBe(404);
    }

    emails.push(await staff(page, "stock_manager"));
    const file = await workbook(
      ["SKU", "Miktar", "Not"],
      [`${prefix}-3-6A`, 12, "fatura 1"],
      [`${prefix}-6-9A`, "5", ""],
    );
    await upload(page, "Stok", file, "purchase");
    const id = await preview(page, file.name);
    await expect(page.getByText("0 → 12")).toBeVisible();
    // Başkası ne sayfadan ne veritabanından uygulayabilir.
    await other.goto(`/yonetim/excel/${id}`);
    await expect(other.getByText("404")).toBeVisible();
    expect(
      await runAs(emails[0], `select public.apply_import('${id}')`),
    ).toContain("Yükleme bulunamadı");
    await page.getByRole("button", { name: "2 satırı uygula" }).click();
    await expectApplied(page);
    expect(stock(`${prefix}-3-6A`)).toBe("12");

    // Aynı mal girişi dosyası yanlışlıkla ikinci kez uygulanamaz.
    await upload(page, "Stok", file, "purchase");
    await preview(page, file.name);
    await expect(
      page.getByText("Bu dosya daha önce uygulanmış."),
    ).toBeVisible();
    await page.getByRole("button", { name: "2 satırı uygula" }).click();
    expect(stock(`${prefix}-3-6A`)).toBe("12");

    // Sayım.
    const count = await workbook(
      ["SKU", "Miktar", "Mevcut stok"],
      [`${prefix}-3-6A`, 9, 12],
    );
    await upload(page, "Stok", count, "adjustment");
    await preview(page, count.name);
    await page.getByRole("button", { name: "1 satırı uygula" }).click();
    await expectApplied(page);
    expect(stock(`${prefix}-3-6A`)).toBe("9");

    // Hareket görünür ve ters çevrilebilir.
    await page.goto(`/yonetim/stok?ara=${prefix}-3-6A`);
    await page
      .getByRole("listitem", { name: `${prefix}-3-6A` })
      .getByRole("link")
      .click();
    await expect(page.getByText("Excel: −3")).toBeVisible();
    await expect(
      page.locator("summary", { hasText: "Ters kayıt (Excel −3)" }),
    ).toBeVisible();

    // Aynı yükleme 10 kez aynı anda istenir: bir kez uygulanır.
    const race = await workbook(["SKU", "Miktar"], [`${prefix}-6-9A`, 1]);
    await upload(page, "Stok", race, "purchase");
    const raceId = await preview(page, race.name);
    const out = await runAs(
      emails[1],
      `select 'OK ' || public.apply_import('${raceId}')`,
      10,
    );
    expect(out.match(/^OK /gm)).toHaveLength(1);
    expect(out.match(/zaten uygulanmış/g)).toHaveLength(9);
    expect(stock(`${prefix}-6-9A`)).toBe("6");

    // Aynı dosyanın iki ayrı yüklemesi aynı anda: yalnızca biri uygulanır.
    const twin = await workbook(["SKU", "Miktar"], [`${prefix}-6-9A`, 2]);
    const twins: string[] = [];
    for (let i = 0; i < 2; i++) {
      await upload(page, "Stok", twin, "purchase");
      twins.push(await preview(page, twin.name));
    }
    const results = await Promise.all(
      twins.map((t) =>
        runAs(emails[1], `select 'OK ' || public.apply_import('${t}')`),
      ),
    );
    expect(results.filter((r) => /^OK /m.test(r))).toHaveLength(1);
    expect(stock(`${prefix}-6-9A`)).toBe("8");

    expect(
      sql(`select bool_and(i.on_hand = (select coalesce(sum(m.delta), 0)
             from public.stock_movements m where m.variant_id = v.id))
           from public.inventory i join public.product_variants v on v.id = i.variant_id
           where v.sku like '${prefix}%'`),
    ).toBe("t");
  } finally {
    cleanUp(prefix, emails);
    await other.context().close();
  }
});

test("1.000 satır uygulanır; yarıda kesilirse hiçbir satır kalmaz @yuk", async ({
  page,
}, info) => {
  test.slow();
  const prefix = newPrefix();
  const emails: string[] = [];
  page.on("dialog", (d) => d.accept());
  try {
    emails.push(await staff(page, "admin"));
    const file = await workbook(
      ["Ürün", "Ürün adı", "Kime", "Cinsiyet", "KDV %", "SKU", "Fiyat"],
      ...Array.from({ length: 1000 }, (_, i) => [
        `u${i}`,
        `E2E ${prefix} ${i}`,
        "Bebek",
        "Unisex",
        10,
        `${prefix}-${i}`,
        100,
      ]),
    );
    await upload(page, "Ürün", file);
    const id = await preview(page, file.name);
    await expect(
      page.getByRole("button", { name: "1000 satırı uygula" }),
    ).toBeVisible();
    const count = () =>
      sql(
        `select count(*) from public.product_variants where sku like '${prefix}%'`,
      );

    // Süre sınırı işlemi ortasında keser.
    expect(
      await runAs(
        emails[0],
        `set statement_timeout = '60ms'; select public.apply_import('${id}')`,
      ),
    ).toContain("statement timeout");
    expect(count()).toBe("0");
    expect(
      sql(`select status from public.import_jobs where id = '${id}'`),
    ).toBe("validated");

    const start = Date.now();
    await page.getByRole("button", { name: "1000 satırı uygula" }).click();
    await expectApplied(page);
    info.annotations.push({
      type: "süre",
      description: `${Date.now() - start} ms`,
    });
    expect(count()).toBe("1000");
  } finally {
    cleanUp(prefix, emails);
  }
});
