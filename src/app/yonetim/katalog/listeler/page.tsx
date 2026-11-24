import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requirePermission } from "@/modules/auth/access";
import {
  deleteListItem,
  saveBrand,
  saveColor,
  saveSize,
  saveSizeChart,
} from "@/modules/catalog/actions";
import { Field, SelectField, TextArea } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { sizeGroupLabels, toOptions } from "@/modules/catalog/labels";
import { getLists, type Lists } from "@/modules/catalog/queries";
import { flattenTree, formatRows } from "@/modules/catalog/text";

export const metadata: Metadata = { title: "Seçim listeleri" };

type Item = { id: string; name: string };

export default async function ListsPage() {
  const access = await requirePermission("catalog.read");
  const readOnly = !access.permissions.includes("catalog.write");
  const lists = await getLists();
  const categories = flattenTree(lists.categories);

  return (
    <div className="space-y-10">
      <h1 className="font-baslik text-3xl font-bold">Seçim listeleri</h1>

      <ListSection
        title="Markalar"
        single="Marka"
        table="brands"
        items={lists.brands}
        action={saveBrand}
        readOnly={readOnly}
        fields={(b) => <NameFields item={b} max={80} />}
      />
      <ListSection
        title="Renkler"
        single="Renk"
        table="colors"
        items={lists.colors}
        action={saveColor}
        readOnly={readOnly}
        mark={(c) => (
          <span
            aria-hidden
            className="mr-2 inline-block size-4 rounded-full border border-gri align-middle"
            style={{ background: c.hex }}
          />
        )}
        fields={(c) => (
          <>
            <NameFields item={c} max={40} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Renk"
                name="hex"
                type="color"
                defaultValue={c?.hex ?? "#ffffff"}
              />
              <Field
                label="Kod"
                name="code"
                defaultValue={c?.code}
                required
                maxLength={6}
                hint="SKU önerisinde kullanılır. Örnek: HAR"
              />
            </div>
          </>
        )}
      />
      <ListSection
        title="Bedenler"
        single="Beden"
        table="sizes"
        items={lists.sizes}
        action={saveSize}
        readOnly={readOnly}
        fields={(s) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Ad"
              name="name"
              defaultValue={s?.name}
              required
              maxLength={40}
            />
            <SelectField
              label="Beden grubu"
              name="size_group"
              empty="Seçin"
              required
              options={toOptions(sizeGroupLabels)}
              defaultValue={s?.size_group ?? ""}
            />
            <Field
              label="Kod"
              name="code"
              defaultValue={s?.code}
              required
              maxLength={8}
              hint="SKU önerisinde kullanılır. Örnek: 3-6A"
            />
            <Field
              label="Sıra"
              name="sort_order"
              type="number"
              min={0}
              required
              defaultValue={s?.sort_order ?? 0}
            />
            <Field
              label="En az kaç aylık"
              name="age_min_months"
              type="number"
              min={0}
              defaultValue={s?.age_min_months ?? ""}
            />
            <Field
              label="En çok kaç aylık"
              name="age_max_months"
              type="number"
              min={0}
              defaultValue={s?.age_max_months ?? ""}
            />
          </div>
        )}
      />
      <ListSection
        title="Beden tabloları"
        single="Beden tablosu"
        table="size_charts"
        items={lists.size_charts}
        action={saveSizeChart}
        readOnly={readOnly}
        fields={(t) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Ad"
                name="name"
                defaultValue={t?.name}
                required
                maxLength={80}
              />
              <SelectField
                label="Kategori"
                name="category_id"
                empty="Bütün kategoriler"
                options={categories.map((c) => ({
                  value: c.id,
                  label: "— ".repeat(c.depth) + c.name,
                }))}
                defaultValue={t?.category_id ?? ""}
              />
            </div>
            <TextArea
              label="Tablo"
              name="rows"
              required
              rows={6}
              maxLength={5000}
              defaultValue={t && formatRows(t.rows)}
              hint="Her satır ayrı; hücreler noktalı virgülle ayrılır. İlk satır başlıktır. Örnek: Beden; Boy (cm); Kilo (kg)"
            />
          </>
        )}
      />
    </div>
  );
}

function NameFields({
  item,
  max,
}: {
  item?: Lists["brands"][number];
  max: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Ad"
        name="name"
        defaultValue={item?.name}
        required
        maxLength={max}
      />
      <Field
        label="Adres"
        name="slug"
        defaultValue={item?.slug}
        maxLength={100}
        hint="Boş bırakılırsa addan üretilir."
      />
    </div>
  );
}

function ListSection<T extends Item>({
  title,
  single,
  table,
  items,
  action,
  readOnly,
  mark,
  fields,
}: {
  title: string;
  single: string;
  table: string;
  items: T[];
  action: typeof saveBrand;
  readOnly: boolean;
  mark?: (item: T) => ReactNode;
  fields: (item?: T) => ReactNode;
}) {
  return (
    <section aria-labelledby={table} className="space-y-4">
      <h2 id={table} className="font-baslik text-xl font-bold">
        {title}
      </h2>
      {items.length === 0 && <p>Henüz kayıt yok.</p>}
      <ul className="divide-y divide-gri/40 border-y border-gri/40">
        {items.map((item) => (
          <li key={item.id} aria-label={item.name}>
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                {mark?.(item)}
                {item.name}
              </summary>
              <div className="space-y-4 pb-5">
                <PanelForm
                  action={action}
                  hidden={{ id: item.id }}
                  submit="Kaydet"
                  subject={item.name}
                  readOnly={readOnly}
                >
                  {fields(item)}
                </PanelForm>
                {!readOnly && (
                  <PanelForm
                    action={deleteListItem}
                    hidden={{ table, id: item.id }}
                    submit="Sil"
                    subject={item.name}
                    confirm={`${item.name} silinsin mi?`}
                  />
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <details className="rounded-xl border border-gri/40 bg-white px-4">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">
            {single} ekle
          </summary>
          <div className="pb-5">
            <PanelForm action={action} submit={`${single} ekle`} resetOnOk>
              {fields()}
            </PanelForm>
          </div>
        </details>
      )}
    </section>
  );
}
