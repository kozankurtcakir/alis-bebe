import { Field, SelectField, TextArea } from "./fields";
import {
  audienceLabels,
  genderLabels,
  productTypeLabels,
  toOptions,
} from "./labels";
import type { Lists, Product } from "./queries";

/** Yeni ürün ve ürün düzenleme formlarının ortak alanları. */
export function ProductFields({
  brands,
  product,
}: {
  brands: Lists["brands"];
  product?: Product;
}) {
  return (
    <>
      <Field
        label="Ürün adı"
        name="name"
        defaultValue={product?.name}
        required
        minLength={2}
        maxLength={150}
      />
      <Field
        label="Adres"
        name="slug"
        defaultValue={product?.slug}
        maxLength={160}
        hint="Sayfa bağlantısında görünür. Boş bırakılırsa addan üretilir."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Tür"
          name="product_type"
          options={toOptions(productTypeLabels)}
          defaultValue={product?.product_type ?? "clothing"}
        />
        <SelectField
          label="Kime"
          name="audience"
          empty="Seçin"
          required
          options={toOptions(audienceLabels)}
          defaultValue={product?.audience ?? ""}
        />
        <SelectField
          label="Cinsiyet"
          name="gender"
          empty="Seçin"
          required
          options={toOptions(genderLabels)}
          defaultValue={product?.gender ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Marka"
          name="brand_id"
          empty="Markasız"
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
          defaultValue={product?.brand_id ?? ""}
        />
        <Field
          label="KDV oranı (%)"
          name="vat_bps"
          inputMode="decimal"
          required
          defaultValue={
            product && String(product.vat_bps / 100).replace(".", ",")
          }
          hint="Hazır oran yoktur; mali müşavirinizin verdiği oranı yazın."
        />
      </div>
      <TextArea
        label="Açıklama"
        name="description"
        defaultValue={product?.description}
        maxLength={10000}
        hint="Yayın için gerekli."
      />
      <Field
        label="Malzeme"
        name="material"
        defaultValue={product?.material}
        maxLength={500}
        hint="Yayın için gerekli. Örnek: %100 pamuk"
      />
      <Field
        label="Bakım (isteğe bağlı)"
        name="care"
        defaultValue={product?.care ?? ""}
        maxLength={1000}
      />
    </>
  );
}
