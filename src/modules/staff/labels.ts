import { catalogActionLabel } from "@/modules/catalog/labels";

export const roleLabels = {
  super_admin: "Super Admin",
  admin: "Admin",
  product_manager: "Ürün Yöneticisi",
  stock_manager: "Stok Yöneticisi",
  order_manager: "Sipariş Yöneticisi",
  customer_service: "Müşteri Hizmetleri",
} as const;

export type StaffRole = keyof typeof roleLabels;

export const staffRoles = Object.keys(roleLabels) as StaffRole[];

/** Yalnızca Super Admin'in (roles.manage) yönetebildiği roller. */
export const adminRoles: readonly string[] = ["super_admin", "admin"];

export const roleLabel = (key: string) => roleLabels[key as StaffRole] ?? key;

const actionLabels: Record<string, string> = {
  "role.assign": "Rol verildi",
  "role.revoke": "Rol kaldırıldı",
  "role.bootstrap": "İlk Super Admin oluşturuldu",
  "user.activate": "Hesap açıldı",
  "user.deactivate": "Hesap kapatıldı",
  "stock.critical_level": "Kritik stok seviyesi değişti",
  "mfa.reset": "İki adımlı doğrulama sıfırlandı",
};

export const actionLabel = (key: string) =>
  actionLabels[key] ?? catalogActionLabel(key) ?? key;
