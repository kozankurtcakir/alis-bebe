import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PanelForm } from "@/components/panel-form";
import { notFound } from "next/navigation";
import { formatPrice, priceInput } from "@/lib/money";
import { requirePermission } from "@/modules/auth/access";
import {
  deleteImage,
  saveCost,
  setCategories,
  setStatus,
  updateImage,
  updateProduct,
  updateVariant,
} from "@/modules/catalog/actions";
import { CheckField, Field, SelectField } from "@/components/fields";
import { ImageUploadForm, VariantCreator } from "@/modules/catalog/forms";
import { statusLabels } from "@/modules/catalog/labels";
import { ProductFields } from "@/modules/catalog/product-fields";
import { getLists, getProduct } from "@/modules/catalog/queries";
import { flattenTree } from "@/modules/catalog/text";

export const metadata: Metadata = { title: "Ürün" };

const statusSteps = {
  draft: [
    { status: "published", label: "Yayınla" },
    { status: "archived", label: "Arşivle" },
  ],
  published: [
    { status: "draft", label: "Taslağa al" },
    { status: "archived", label: "Arşivle" },
  ],
  archived: [{ status: "draft", label: "Taslağa al" }],
} as const;

const sectionTitle = "font-baslik text-xl font-bold";

export default async function ProductPage({
  params,
}: PageProps<"/yonetim/katalog/[id]">) {
  const { permissions } = await requirePermission("catalog.read");
  const product = await getProduct((await params).id);
  if (!product) notFound();
  const lists = await getLists();

  const readOnly = !permissions.includes("catalog.write");
  const canPrice = permissions.includes("prices.write");
  const colorOptions = lists.colors.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const categories = flattenTree(lists.categories);
  const primary = product.product_categories.find((c) => c.is_primary);
  const variants = product.product_variants.map((v) => ({
    ...v,
    label:
      [
        lists.colors.find((c) => c.id === v.color_id)?.name,
        lists.sizes.find((s) => s.id === v.size_id)?.name,
      ]
        .filter(Boolean)
        .join(" / ") || "Renksiz ve bedensiz",
  }));

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <h1 className="font-baslik text-3xl font-bold break-words">
          {product.name}
        </h1>
        <p>
          Durum: <strong>{statusLabels[product.status]}</strong>
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-3">
            {statusSteps[product.status].map((step) => (
              <PanelForm
                key={step.status}
                action={setStatus}
                hidden={{ id: product.id, status: step.status }}
                submit={step.label}
                confirm={
                  step.status === "archived"
                    ? "Ürün arşivlensin mi?"
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <section aria-labelledby="bilgiler" className="space-y-4">
        <h2 id="bilgiler" className={sectionTitle}>
          Bilgiler
        </h2>
        <PanelForm
          action={updateProduct}
          hidden={{ id: product.id }}
          submit="Bilgileri kaydet"
          readOnly={readOnly}
        >
          <ProductFields brands={lists.brands} product={product} />
        </PanelForm>
      </section>

      <section aria-labelledby="kategoriler" className="space-y-4">
        <h2 id="kategoriler" className={sectionTitle}>
          Kategoriler
        </h2>
        <PanelForm
          action={setCategories}
          hidden={{ id: product.id }}
          submit="Kategorileri kaydet"
          readOnly={readOnly}
        >
          <SelectField
            label="Ana kategori"
            name="primary"
            empty="Seçilmedi"
            defaultValue={primary?.category_id ?? ""}
            options={categories.map((c) => ({
              value: c.id,
              label: "— ".repeat(c.depth) + c.name,
            }))}
          />
          <fieldset>
            <legend className="font-semibold">Diğer kategoriler</legend>
            <div className="flex flex-wrap gap-x-5">
              {categories.map((c) => (
                <CheckField
                  key={c.id}
                  label={c.name}
                  name="others"
                  value={c.id}
                  defaultChecked={product.product_categories.some(
                    (p) => p.category_id === c.id && !p.is_primary,
                  )}
                />
              ))}
            </div>
          </fieldset>
        </PanelForm>
      </section>

      <section aria-labelledby="varyantlar" className="space-y-4">
        <h2 id="varyantlar" className={sectionTitle}>
          Varyantlar
        </h2>
        {variants.length === 0 && <p>Henüz varyant yok.</p>}
        <ul className="divide-y divide-gri/40 border-y border-gri/40">
          {variants.map((v) => (
            <li key={v.id} aria-label={v.sku}>
              <details>
                <summary className="min-h-11 cursor-pointer py-3">
                  <span className="font-semibold">{v.label}</span> ·{" "}
                  <span className="break-all">{v.sku}</span> ·{" "}
                  {formatPrice(v.price)}
                  {!v.is_active && " · pasif"}
                </summary>
                <div className="space-y-4 pb-5">
                  {permissions.includes("stock.read") && (
                    <Link
                      href={`/yonetim/stok/${v.id}`}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      Stok ve hareketler
                      <span className="sr-only"> ({v.sku})</span>
                    </Link>
                  )}
                  <PanelForm
                    action={updateVariant}
                    hidden={{ id: v.id }}
                    submit="Varyantı kaydet"
                    subject={v.sku}
                    readOnly={readOnly}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="SKU"
                        name="sku"
                        defaultValue={v.sku}
                        required
                        maxLength={40}
                      />
                      <Field
                        label="Barkod"
                        name="barcode"
                        defaultValue={v.barcode ?? ""}
                        maxLength={32}
                      />
                      <Field
                        label="Fiyat (TL)"
                        name="price"
                        inputMode="decimal"
                        defaultValue={priceInput(v.price)}
                        required
                        disabled={!canPrice}
                      />
                      <Field
                        label="Eski fiyat (TL)"
                        name="compare_at_price"
                        inputMode="decimal"
                        defaultValue={
                          v.compare_at_price === null
                            ? ""
                            : priceInput(v.compare_at_price)
                        }
                        disabled={!canPrice}
                        hint="Üstü çizili gösterilir; fiyattan yüksek olmalı."
                      />
                      <Field
                        label="Desi"
                        name="desi"
                        inputMode="decimal"
                        defaultValue={
                          v.desi === null
                            ? ""
                            : String(v.desi).replace(".", ",")
                        }
                        hint="Kargo hacim ölçüsü; isteğe bağlı."
                      />
                    </div>
                    <CheckField
                      label="Aktif (satılabilir)"
                      name="is_active"
                      defaultChecked={v.is_active}
                    />
                  </PanelForm>
                  {permissions.includes("costs.write") && (
                    <PanelForm
                      action={saveCost}
                      hidden={{ id: v.id }}
                      submit="Maliyeti kaydet"
                      subject={v.sku}
                    >
                      <Field
                        label="Alış maliyeti (TL)"
                        name="cost"
                        inputMode="decimal"
                        required
                        defaultValue={
                          v.variant_costs
                            ? priceInput(v.variant_costs.cost)
                            : ""
                        }
                        hint="Yalnızca Admin ve Super Admin görür."
                      />
                    </PanelForm>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
        {!readOnly && canPrice && (
          <details className="rounded-xl border border-gri/40 bg-white px-4">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">
              Varyant ekle
            </summary>
            <div className="pb-5">
              <VariantCreator
                product={product.id}
                productNo={product.product_no}
                optional={product.product_type === "personal_care"}
                existing={product.product_variants.map(
                  (v) => `${v.color_id ?? ""}|${v.size_id ?? ""}`,
                )}
                colors={lists.colors}
                sizes={lists.sizes}
              />
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="gorseller" className="space-y-4">
        <h2 id="gorseller" className={sectionTitle}>
          Görseller
        </h2>
        {product.product_images.length === 0 && <p>Henüz görsel yok.</p>}
        <ul className="space-y-6">
          {product.product_images.map((image) => (
            <li
              key={image.id}
              aria-label={image.alt}
              className="grid gap-4 sm:grid-cols-[10rem_1fr]"
            >
              <Image
                src={`/gorsel/${image.path}`}
                alt={image.alt}
                width={image.width}
                height={image.height}
                sizes="160px"
                className="h-auto w-40 rounded-xl"
              />
              <div className="space-y-3">
                <PanelForm
                  action={updateImage}
                  hidden={{ id: image.id }}
                  submit="Görsel bilgisini kaydet"
                  subject={image.alt}
                  readOnly={readOnly}
                >
                  <Field
                    label="Açıklama"
                    name="alt"
                    defaultValue={image.alt}
                    required
                    maxLength={200}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Renk"
                      name="color_id"
                      empty="Bütün renkler"
                      options={colorOptions}
                      defaultValue={image.color_id ?? ""}
                    />
                    <Field
                      label="Sıra"
                      name="sort_order"
                      type="number"
                      min={0}
                      required
                      defaultValue={image.sort_order}
                      hint="Küçük olan önce görünür."
                    />
                  </div>
                </PanelForm>
                {!readOnly && (
                  <PanelForm
                    action={deleteImage}
                    hidden={{ id: image.id }}
                    submit="Görseli sil"
                    subject={image.alt}
                    confirm="Görsel kalıcı olarak silinsin mi?"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="space-y-3 border-t border-gri/40 pt-4">
            <h3 className="font-baslik text-lg font-bold">Görsel ekle</h3>
            <ImageUploadForm product={product.id} colors={colorOptions} />
          </div>
        )}
      </section>
    </div>
  );
}
