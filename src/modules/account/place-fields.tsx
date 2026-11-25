"use client";

import { useState } from "react";
import { Field, SelectField, TextArea } from "@/components/fields";
import { cities } from "./cities";
import { districts } from "./districts";
import type { Address } from "./queries";

/** İl, ilçe ve açık adres. İlçe listesi seçilen ile göre değişir. */
export function PlaceFields({
  prefix = "",
  address: a,
}: {
  prefix?: string;
  address?: Address;
}) {
  const [city, setCity] = useState(a?.city ?? "");
  const list = cities.find((c) => c === city);
  return (
    <>
      <SelectField
        label="İl"
        name={`${prefix}city`}
        defaultValue={city}
        onChange={(e) => setCity(e.target.value)}
        autoComplete="address-level1"
        empty="Seçin"
        options={cities.map((c) => ({ value: c, label: c }))}
        required
      />
      <SelectField
        // İl değişince eski ilçe seçili kalmaz.
        key={city}
        label="İlçe"
        name={`${prefix}district`}
        defaultValue={city === a?.city ? a?.district : ""}
        autoComplete="address-level2"
        empty={list ? "Seçin" : "Önce il seçin"}
        options={(list ? districts[list] : []).map((d) => ({
          value: d,
          label: d,
        }))}
        required
      />
      <TextArea
        label="Açık adres"
        name={`${prefix}line`}
        defaultValue={a?.line}
        autoComplete="street-address"
        hint="Mahalle, sokak, kapı ve daire numarası"
        required
        minLength={10}
        maxLength={300}
      />
      <Field
        label="Posta kodu (isteğe bağlı)"
        name={`${prefix}postal_code`}
        defaultValue={a?.postal_code ?? ""}
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={5}
      />
    </>
  );
}
