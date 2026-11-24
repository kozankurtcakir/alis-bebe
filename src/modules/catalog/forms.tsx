"use client";

import { useState } from "react";
import { CheckField, Field, SelectField } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { createVariants, uploadImage } from "./actions";
import { sizeGroupLabels } from "./labels";
import type { Lists } from "./queries";
import { suggestSku } from "./text";

const MAX_MB = 4;

export function ImageUploadForm({
  product,
  colors,
}: {
  product: string;
  colors: { value: string; label: string }[];
}) {
  return (
    <PanelForm
      action={uploadImage}
      hidden={{ product }}
      submit="Görseli yükle"
      resetOnOk
      check={(form) => {
        const file = form.get("file");
        if (file instanceof File && file.size > MAX_MB * 1024 * 1024) {
          return `Görsel en fazla ${MAX_MB} MB olabilir.`;
        }
      }}
    >
      <Field
        label="Görsel dosyası"
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        hint="JPEG, PNG veya WebP; en fazla 4 MB."
      />
      <Field
        label="Görsel açıklaması"
        name="alt"
        required
        maxLength={200}
        hint="Görseli göremeyenler için: Hardal müslin zıbın, önden"
      />
      <SelectField
        label="Görselin rengi"
        name="color_id"
        empty="Bütün renkler"
        options={colors}
      />
    </PanelForm>
  );
}

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** Seçilen renk × beden satırlarını ve değiştirilebilir SKU önerilerini gösterir. */
export function VariantCreator({
  product,
  productNo,
  optional,
  existing,
  colors,
  sizes,
}: {
  product: string;
  productNo: number;
  /** Kişisel bakımda renk ve beden seçilmeyebilir. */
  optional: boolean;
  /** Zaten ekli "renk|beden" çiftleri. */
  existing: string[];
  colors: Lists["colors"];
  sizes: Lists["sizes"];
}) {
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [sizeIds, setSizeIds] = useState<string[]>([]);

  const pick = (ids: string[]) => (ids.length === 0 && optional ? [""] : ids);
  const rows = pick(colorIds).flatMap((colorId) =>
    pick(sizeIds)
      .filter((sizeId) => !existing.includes(`${colorId}|${sizeId}`))
      .map((sizeId) => {
        const color = colors.find((c) => c.id === colorId);
        const size = sizes.find((s) => s.id === sizeId);
        return {
          key: `${colorId}|${sizeId}`,
          colorId,
          sizeId,
          label:
            [color?.name, size?.name].filter(Boolean).join(" / ") ||
            "Renksiz ve bedensiz",
          sku: suggestSku(productNo, color?.code, size?.code),
        };
      }),
  );
  const chosen = colorIds.length > 0 || sizeIds.length > 0;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="font-semibold">Renkler</legend>
        <div className="flex flex-wrap gap-x-5">
          {colors.map((c) => (
            <CheckField
              key={c.id}
              label={c.name}
              checked={colorIds.includes(c.id)}
              onChange={() => setColorIds(toggle(colorIds, c.id))}
            />
          ))}
        </div>
      </fieldset>
      {Object.entries(sizeGroupLabels).map(([group, label]) => {
        const list = sizes.filter((s) => s.size_group === group);
        if (list.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend className="font-semibold">Bedenler: {label}</legend>
            <div className="flex flex-wrap gap-x-5">
              {list.map((s) => (
                <CheckField
                  key={s.id}
                  label={s.name}
                  checked={sizeIds.includes(s.id)}
                  onChange={() => setSizeIds(toggle(sizeIds, s.id))}
                />
              ))}
            </div>
          </fieldset>
        );
      })}

      {rows.length === 0 &&
      chosen &&
      colorIds.length > 0 &&
      sizeIds.length > 0 ? (
        <p>Seçilen varyantların hepsi zaten ekli.</p>
      ) : (
        rows.length === 0 &&
        !optional && <p className="text-gri">Renk ve beden seçin.</p>
      )}

      {/* Form boş kalsa da takılı durur; başarı iletisi kaybolmaz. */}
      <PanelForm
        action={createVariants}
        hidden={{ product }}
        submit={`${rows.length} varyantı ekle`}
        readOnly={rows.length === 0}
      >
        {rows.length > 0 && (
          <Field
            label="Fiyat (TL)"
            name="price"
            inputMode="decimal"
            required
            hint="249,90 biçiminde. Varyantların fiyatı sonra ayrı ayrı değiştirilebilir."
          />
        )}
        {rows.map((row) => (
          <fieldset
            key={row.key}
            className="grid gap-3 border-t border-gri/40 pt-3 sm:grid-cols-2"
          >
            <legend className="sr-only">{row.label}</legend>
            <p aria-hidden className="font-semibold sm:col-span-2">
              {row.label}
            </p>
            <input type="hidden" name="color" value={row.colorId} />
            <input type="hidden" name="size" value={row.sizeId} />
            <Field
              label="SKU"
              name="sku"
              defaultValue={row.sku}
              required
              maxLength={40}
            />
            <Field
              label="Barkod (isteğe bağlı)"
              name="barcode"
              maxLength={32}
            />
          </fieldset>
        ))}
      </PanelForm>
    </div>
  );
}
