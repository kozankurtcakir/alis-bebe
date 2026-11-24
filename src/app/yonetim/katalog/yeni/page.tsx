import type { Metadata } from "next";
import { requirePermission } from "@/modules/auth/access";
import { createProduct } from "@/modules/catalog/actions";
import { PanelForm } from "@/components/panel-form";
import { ProductFields } from "@/modules/catalog/product-fields";
import { getLists } from "@/modules/catalog/queries";

export const metadata: Metadata = { title: "Yeni ürün" };

export default async function NewProductPage() {
  await requirePermission("catalog.write");
  const { brands } = await getLists();

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Yeni ürün</h1>
      <p className="text-gri">
        Ürün taslak olarak açılır. Kategori, varyant ve görsel sonraki sayfada
        eklenir.
      </p>
      <PanelForm action={createProduct} submit="Ürünü oluştur">
        <ProductFields brands={brands} />
      </PanelForm>
    </div>
  );
}
