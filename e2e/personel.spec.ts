import { expect, test, type Page } from "@playwright/test";
import {
  grantRole,
  newEmail,
  removeSuperAdmin,
  setUpMfa,
  signUpAndConfirm,
} from "./yardim";

const row = (page: Page, email: string) =>
  page.getByRole("listitem").filter({ hasText: email });

async function addStaff(page: Page, email: string, role: string) {
  await page.goto("/yonetim/personel");
  await page.getByLabel("Üyenin e-postası").fill(email);
  await page.getByLabel("Rol", { exact: true }).selectOption({ label: role });
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
}

test("Super Admin personeli yönetir, Admin sınırını aşamaz", async ({
  page,
  browser,
}) => {
  test.slow();
  const [superEmail, adminEmail, memberEmail] = [
    newEmail(),
    newEmail(),
    newEmail(),
  ];
  const admin = await (await browser.newContext()).newPage();
  const member = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, superEmail);
  await signUpAndConfirm(admin, adminEmail);
  await signUpAndConfirm(member, memberEmail);

  try {
    grantRole(superEmail, "super_admin");
    await setUpMfa(page);

    await addStaff(page, newEmail(), "Admin");
    await expect(page.getByText("üye bulunamadı")).toBeVisible();
    await addStaff(page, adminEmail, "Admin");
    await expect(row(page, adminEmail)).toContainText("Hesap açık");
    await expect(row(page, superEmail)).toContainText("(siz)");
    await expect(row(page, superEmail).getByRole("button")).toHaveCount(0);

    // Admin: Super Admin'e dokunamaz, yönetici rolü seçemez.
    await setUpMfa(admin);
    await admin.goto("/yonetim/personel");
    await expect(row(admin, superEmail)).toBeVisible();
    await expect(row(admin, superEmail).getByRole("button")).toHaveCount(0);
    await expect(row(admin, adminEmail).getByRole("button")).toHaveCount(0);
    const roleField = admin.getByLabel("Rol", { exact: true });
    await expect(roleField.locator("option")).toHaveText([
      "Rol seçin",
      "Ürün Yöneticisi",
      "Stok Yöneticisi",
      "Sipariş Yöneticisi",
      "Müşteri Hizmetleri",
    ]);

    // Rol seçilmeden gönderilemez.
    await expect(roleField).toHaveValue("");
    await admin.getByLabel("Üyenin e-postası").fill(memberEmail);
    await admin.getByRole("button", { name: "Ekle", exact: true }).click();
    expect(
      await roleField.evaluate((el: HTMLSelectElement) => el.validity.valid),
    ).toBe(false);

    // Sayfa kodunu değiştirerek rol yükseltme denemesi reddedilir.
    await admin.getByLabel("Üyenin e-postası").fill(memberEmail);
    await roleField.evaluate((el: HTMLSelectElement) => {
      el.options[1].value = "super_admin";
      el.selectedIndex = 1;
    });
    await admin.getByRole("button", { name: "Ekle", exact: true }).click();
    await expect(admin.getByText("Bu işlem için yetkiniz yok.")).toBeVisible();
    await expect(row(admin, memberEmail)).toHaveCount(0);

    // İzinli rol verilir; hesap kapanınca kişi dışarı atılır.
    await addStaff(admin, memberEmail, "Stok Yöneticisi");
    await expect(row(admin, memberEmail)).toContainText("Stok Yöneticisi");
    await setUpMfa(member);
    await member.goto("/yonetim/personel");
    await expect(member.getByText("404")).toBeVisible();
    await member.goto("/yonetim/islem-gecmisi");
    await expect(member.getByText("404")).toBeVisible();

    admin.on("dialog", (d) => d.accept());
    await row(admin, memberEmail)
      .getByRole("button", { name: "Hesabı kapat" })
      .click();
    await expect(row(admin, memberEmail)).toContainText("Hesap kapalı");
    await member.goto("/yonetim");
    await expect(member).toHaveURL("/giris");

    // Onay penceresi reddedilirse işlem yapılmaz.
    await page.goto("/yonetim/personel");
    page.once("dialog", (d) => d.dismiss());
    await row(page, adminEmail)
      .getByRole("button", { name: "Doğrulamayı sıfırla" })
      .click();
    await expect(row(page, adminEmail)).toContainText("doğrulama kurulu");
    page.on("dialog", (d) => d.accept());
    await row(page, adminEmail)
      .getByRole("button", { name: "Doğrulamayı sıfırla" })
      .click();
    await expect(row(page, adminEmail)).toContainText("kurulu değil");
    await admin.goto("/yonetim");
    await expect(admin).toHaveURL("/giris");

    await row(page, adminEmail)
      .getByRole("button", { name: "Admin rolünü kaldır" })
      .click();
    await expect(row(page, adminEmail)).toHaveCount(0);

    await page.goto("/yonetim/islem-gecmisi");
    for (const text of [
      "Rol verildi: Admin",
      "Rol kaldırıldı: Admin",
      "İki adımlı doğrulama sıfırlandı",
    ]) {
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: adminEmail })
          .getByText(text),
      ).toBeVisible();
    }
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: memberEmail })
        .getByText("Hesap kapatıldı"),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    removeSuperAdmin(superEmail);
    await admin.context().close();
    await member.context().close();
  }
});
