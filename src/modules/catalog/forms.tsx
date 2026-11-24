"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CatalogState } from "./actions";
import { createVariants, uploadImage } from "./actions";
import { CheckField, Field, SelectField } from "./fields";
import { sizeGroupLabels } from "./labels";
import type { Lists } from "./queries";
import { suggestSku } from "./text";

type FormProps = {
  action: (state: CatalogState, form: FormData) => Promise<CatalogState>;
  hidden?: Record<string, string>;
  submit: string;
  /** Ekran okuyucuda aynı adlı düğmeleri ayırır. */
  subject?: string;
  confirm?: string;
  /** Yazma izni olmayan kişi alanları görür ama değiştiremez. */
  readOnly?: boolean;
  /** Ekleme formları başarıdan sonra boşalır. */
  resetOnOk?: boolean;
  /** Göndermeden önceki tarayıcı kontrolü; hata metni döndürürse gönderilmez. */
  check?: (form: FormData) => string | undefined;
  children?: ReactNode;
};

export function CatalogForm({
  action,
  hidden = {},
  submit,
  subject,
  confirm,
  readOnly,
  resetOnOk,
  check,
  children,
}: FormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [problem, setProblem] = useState<string>();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);

  const error = problem ?? state.error;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        // React, hata olsa da formu boşaltır; yazılanlar kaybolmasın diye elle gönderilir.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = new FormData(e.currentTarget);
        const found = check?.(form);
        setProblem(found);
        if (!found) startTransition(() => formAction(form));
      }}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        {!readOnly && (
          <button
            disabled={pending}
            className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane disabled:opacity-60"
          >
            {pending ? "Bekleyin…" : submit}
            {subject && <span className="sr-only"> ({subject})</span>}
          </button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-nar">
          {error}
        </p>
      )}
      {!error && state.ok && (
        <p role="status" className="mt-2">
          {state.ok}
        </p>
      )}
    </form>
  );
}

const MAX_MB = 4;

export function ImageUploadForm({
  product,
  colors,
}: {
  product: string;
  colors: { value: string; label: string }[];
}) {
  return (
    <CatalogForm
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
    </CatalogForm>
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
      <CatalogForm
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
      </CatalogForm>
    </div>
  );
}
