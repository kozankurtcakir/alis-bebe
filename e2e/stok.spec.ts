import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { grantRole, newEmail, setUpMfa, signUpAndConfirm, sql } from "./yardim";

const run = promisify(execFile);

/** Sahte ürün ve tek varyant. */
function addVariant() {
  const sku = `STOK-${randomUUID().slice(0, 8).toUpperCase()}`;
  sql(`insert into public.products (name, slug, audience, gender, vat_bps)
       values ('E2E ${sku}', '${sku.toLowerCase()}', 'baby', 'unisex', 1000);
       insert into public.product_variants (product_id, color_id, size_id, sku, price)
       select p.id, c.id, s.id, '${sku}', 100
       from public.products p, public.colors c, public.sizes s
       where p.name = 'E2E ${sku}' and c.code = 'HAR' and s.code = '3-6A'`);
  return sku;
}

/** Test verisini siler; yalnızca ekleme koruması sadece bu temizlikte atlanır. */
function removeVariant(sku: string) {
  const id = `(select id from public.product_variants where sku = '${sku}')`;
  sql(`begin;
       alter table public.price_history disable trigger price_history_append_only;
       alter table public.stock_movements disable trigger stock_movements_append_only;
       delete from public.price_history where variant_id = ${id};
       delete from public.stock_movements where variant_id = ${id} and reverses_id is not null;
       delete from public.stock_movements where variant_id = ${id};
       alter table public.price_history enable trigger price_history_append_only;
       alter table public.stock_movements enable trigger stock_movements_append_only;
       delete from public.inventory where variant_id = ${id};
       delete from public.product_variants where sku = '${sku}';
       set constraints all immediate;
       delete from public.products where name = 'E2E ${sku}';
       commit;`);
}

async function staff(page: Page, role: string) {
  const email = newEmail();
  await signUpAndConfirm(page, email);
  grantRole(email, role);
  await setUpMfa(page);
  return email;
}

const onHand = (sku: string) =>
  Number(
    sql(`select i.on_hand from public.inventory i
         join public.product_variants v on v.id = i.variant_id where v.sku = '${sku}'`),
  );

/** Stok, hareketlerin toplamına eşit mi? */
const isConsistent = (sku: string) =>
  sql(`select i.on_hand = coalesce(sum(m.delta), 0) and bool_and(m.on_hand_after >= 0)
       from public.inventory i
       join public.product_variants v on v.id = i.variant_id
       left join public.stock_movements m on m.variant_id = v.id
       where v.sku = '${sku}' group by i.on_hand`) === "t";

test("Stok Yöneticisi stoğu yönetir; hatalı ve yinelenen istekler reddedilir", async ({
  page,
  browser,
}) => {
  test.slow();
  const sku = addVariant();
  const reader = await (await browser.newContext()).newPage();
  const asked: string[] = [];
  page.on("dialog", (d) => {
    asked.push(d.message());
    return d.accept();
  });

  const open = async (p: Page) => {
    await p.goto(`/yonetim/stok?ara=${sku}`);
    await p.getByRole("listitem", { name: sku }).getByRole("link").click();
    await expect(p.getByText("Satılabilir", { exact: true })).toBeVisible();
  };
  const operate = async (
    p: Page,
    title: string,
    submit: string,
    quantity: string,
    note?: string,
  ) => {
    const box = p.locator("details").filter({
      has: p.locator("summary", { hasText: title }),
      hasNot: p.locator("li"),
    });
    const form = box.first();
    if (!(await form.getByRole("button", { name: submit }).isVisible())) {
      await form.locator("summary").click();
    }
    await form.getByRole("spinbutton").fill(quantity);
    if (note) await form.getByRole("textbox").fill(note);
    await form.getByRole("button", { name: submit }).click();
  };

  try {
    await staff(page, "stock_manager");
    await open(page);
    await operate(page, "İlk stok", "İlk stoğu kaydet", "20");
    await expect(page.getByText("İlk stok: +20")).toBeVisible();
    expect(asked.at(-1)).toContain("stok 0 → 20");
    // İlk stok bir kez girilir.
    await expect(
      page.locator("summary", { hasText: "İlk stok" }).filter({
        hasNotText: "Ters kayıt",
      }),
    ).toHaveCount(0);

    // Aynı istek ağda iki kez giderse bir kez işlenir.
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST"),
      operate(page, "Mal girişi", "Girişi kaydet", "5"),
    ]);
    await expect(page.getByText("Kaydedildi. Yeni stok: 25")).toBeVisible();
    const replay = await page.request.fetch(request.url(), {
      method: "POST",
      headers: await request.allHeaders(),
      data: request.postDataBuffer()!,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.text()).toContain("Yeni stok: 25");
    expect(onHand(sku)).toBe(25);

    // Eksi stok ve notsuz hasar.
    await operate(page, "Hasar / kayıp", "Düşüşü kaydet", "26", "kırık");
    await expect(page.getByText("Stok yetersiz: elde 25")).toBeVisible();
    await operate(page, "Hasar / kayıp", "Düşüşü kaydet", "2", "kırık");
    await expect(page.getByText("Kaydedildi. Yeni stok: 23")).toBeVisible();

    // Eski ekrandan sayım reddedilir, yeni stok gösterilir.
    const stale = await page.context().newPage();
    stale.on("dialog", (d) => d.accept());
    await open(stale);
    await operate(page, "Mal girişi", "Girişi kaydet", "1");
    await expect(page.getByText("Kaydedildi. Yeni stok: 24")).toBeVisible();
    await operate(stale, "Sayım", "Sayımı kaydet", "17", "raf sayımı");
    await expect(
      stale.getByText("Stok bu sırada değişti (şimdi 24)"),
    ).toBeVisible();
    expect(onHand(sku)).toBe(24);
    await operate(stale, "Sayım", "Sayımı kaydet", "17", "raf sayımı");
    await expect(stale.getByText("Kaydedildi. Yeni stok: 17")).toBeVisible();
    await stale.close();

    // Ters kayıt yalnızca bir kez.
    await page.reload();
    const purchase = page
      .getByRole("listitem")
      .filter({ hasText: "Mal girişi: +5" });
    await purchase.locator("summary").click();
    await purchase.getByLabel("Neden").fill("yanlış girildi");
    await purchase.getByRole("button").click();
    await expect(purchase.getByText("Ters çevrildi")).toBeVisible();
    await expect(page.getByText("Ters kayıt: −5")).toBeVisible();
    await expect(purchase.getByRole("button")).toHaveCount(0);
    expect(onHand(sku)).toBe(12);

    // Kritik seviye uyarısı.
    await page.getByLabel("Uyarı seviyesi").fill("12");
    await page.getByRole("button", { name: "Seviyeyi kaydet" }).click();
    await expect(page.getByText("Kritik", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const url = page.url();
    await page.goto(`/yonetim/stok?ara=${sku}&durum=critical`);
    await expect(page.getByRole("listitem", { name: sku })).toBeVisible();
    await page.goto(`/yonetim/stok?ara=${sku}&durum=out`);
    await expect(page.getByText("Kayıt bulunamadı.")).toBeVisible();
    await page.goto("/yonetim");
    await expect(page.getByRole("link", { name: /Kritik stok/ })).toBeVisible();

    // Müşteri Hizmetleri görür ama değiştiremez.
    await staff(reader, "customer_service");
    await reader.goto(url);
    await expect(reader.getByText("Ters kayıt: −5")).toBeVisible();
    await expect(reader.getByLabel("Uyarı seviyesi")).toBeDisabled();
    await expect(reader.locator("main").getByRole("button")).toHaveCount(0);
    await expect(reader.locator("main summary")).toHaveCount(0);

    expect(isConsistent(sku)).toBe(true);
  } finally {
    removeVariant(sku);
    await reader.context().close();
  }
});

test("50 eşzamanlı istekte stok eksiye düşmez", async ({ page }, info) => {
  // Veritabanı bağlantı sınırını aşmamak için tek tarayıcıda çalışır.
  test.skip(info.project.name !== "masaustu");
  test.slow();
  const sku = addVariant();
  try {
    const email = await staff(page, "stock_manager");
    const claims =
      sql(`select json_build_object('sub', u.id, 'role', 'authenticated',
      'aal', 'aal2', 'session_id', s.id) from auth.users u
      join auth.sessions s on s.user_id = u.id where u.email = '${email}' limit 1`);
    const variant = sql(
      `select id from public.product_variants where sku = '${sku}'`,
    );
    /** Aynı anda 50 ayrı bağlantı; `key` boşsa her istek farklı anahtar taşır. */
    const burst = async (reason: string, key: string) => {
      const statement = `select set_config('request.jwt.claims', '${claims}', false);
        set role authenticated;
        select 'OK ' || public.adjust_stock('${variant}', '${reason}', 1, 'yarış', ${key}, null);`;
      const { stdout } = await run("docker", [
        "exec",
        "-e",
        `Q=${statement}`,
        "supabase_db_alis-bebe",
        "bash",
        "-c",
        'for i in $(seq 50); do psql -U postgres -qAtc "$Q" 2>&1 & done; wait',
      ]);
      return {
        ok: (stdout.match(/^OK /gm) ?? []).length,
        refused: (stdout.match(/Stok yetersiz/g) ?? []).length,
      };
    };

    // Aynı anahtar: 50 istek gelir, bir kez işlenir.
    expect(await burst("purchase", `'${randomUUID()}'`)).toEqual({
      ok: 50,
      refused: 0,
    });
    expect(onHand(sku)).toBe(1);

    // Farklı anahtarlar: 50 giriş de kaybolmadan eklenir.
    expect(await burst("purchase", "gen_random_uuid()")).toEqual({
      ok: 50,
      refused: 0,
    });
    expect(onHand(sku)).toBe(51);

    // Stok 10 iken 50 düşüş: tam 10'u başarılı olur.
    sql(`select set_config('request.jwt.claims', '${claims}', false);
         set role authenticated;
         select public.adjust_stock('${variant}', 'adjustment', 10, 'sayım', gen_random_uuid(), 51)`);
    expect(await burst("damage", "gen_random_uuid()")).toEqual({
      ok: 10,
      refused: 40,
    });
    expect(onHand(sku)).toBe(0);
    expect(isConsistent(sku)).toBe(true);
  } finally {
    removeVariant(sku);
  }
});
