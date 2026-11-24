import type { Metadata } from "next";
import { requirePermission } from "@/modules/auth/access";
import { deleteListItem, saveCategory } from "@/modules/catalog/actions";
import { CheckField, Field, SelectField } from "@/modules/catalog/fields";
import { CatalogForm } from "@/modules/catalog/forms";
import { getLists, type Lists } from "@/modules/catalog/queries";
import { flattenTree } from "@/modules/catalog/text";

export const metadata: Metadata = { title: "Kategoriler" };

type Category = Lists["categories"][number];

export default async function CategoriesPage() {
  const access = await requirePermission("catalog.read");
  const readOnly = !access.permissions.includes("catalog.write");
  const categories = flattenTree((await getLists()).categories);

  const fields = (category?: Category) => (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Ad"
          name="name"
          defaultValue={category?.name}
          required
          maxLength={80}
        />
        <Field
          label="Adres"
          name="slug"
          defaultValue={category?.slug}
          maxLength={100}
          hint="Boş bırakılırsa addan üretilir."
        />
        <SelectField
          label="Üst kategori"
          name="parent_id"
          empty="Yok (ana kategori)"
          defaultValue={category?.parent_id ?? ""}
          options={categories
            .filter((c) => c.id !== category?.id)
            .map((c) => ({
              value: c.id,
              label: "— ".repeat(c.depth) + c.name,
            }))}
        />
        <Field
          label="Sıra"
          name="sort_order"
          type="number"
          min={0}
          required
          defaultValue={category?.sort_order ?? 0}
        />
      </div>
      <CheckField
        label="Aktif (mağazada görünür)"
        name="is_active"
        defaultChecked={category?.is_active ?? true}
      />
    </>
  );

  return (
    <div className="space-y-8">
      <h1 className="font-baslik text-3xl font-bold">Kategoriler</h1>
      <ul className="divide-y divide-gri/40 border-y border-gri/40">
        {categories.map((c) => (
          <li key={c.id} aria-label={c.name}>
            <details>
              <summary className="min-h-11 cursor-pointer py-3">
                <span aria-hidden>{"— ".repeat(c.depth)}</span>
                <span className="font-semibold">{c.name}</span>
                {!c.is_active && " · kapalı"}
              </summary>
              <div className="space-y-4 pb-5">
                <CatalogForm
                  action={saveCategory}
                  hidden={{ id: c.id }}
                  submit="Kaydet"
                  subject={c.name}
                  readOnly={readOnly}
                >
                  {fields(c)}
                </CatalogForm>
                {!readOnly && (
                  <CatalogForm
                    action={deleteListItem}
                    hidden={{ table: "categories", id: c.id }}
                    submit="Sil"
                    subject={c.name}
                    confirm={`${c.name} silinsin mi?`}
                  />
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <section aria-labelledby="ekle" className="space-y-4">
          <h2 id="ekle" className="font-baslik text-xl font-bold">
            Kategori ekle
          </h2>
          <CatalogForm action={saveCategory} submit="Kategori ekle" resetOnOk>
            {fields()}
          </CatalogForm>
        </section>
      )}
    </div>
  );
}
