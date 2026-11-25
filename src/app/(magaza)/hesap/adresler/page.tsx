import type { Metadata } from "next";
import { CheckField, Field } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { deleteAddress, saveAddress } from "@/modules/account/actions";
import { PlaceFields } from "@/modules/account/place-fields";
import { listAddresses, type Address } from "@/modules/account/queries";
import { formatPhone } from "@/modules/account/validation";
import { requireUser } from "@/modules/auth/access";

export const instant = false;
export const metadata: Metadata = { title: "Adreslerim" };

const MAX_ADDRESSES = 10; // Veritabanındaki sınırla aynı.

export default async function AddressesPage() {
  await requireUser();
  const addresses = await listAddresses();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Adreslerim</h1>
      {addresses.length === 0 && <p>Kayıtlı adresiniz yok.</p>}
      <ul className="space-y-4">
        {addresses.map((a) => (
          <li key={a.id} className="space-y-2 rounded-2xl bg-white p-4">
            <h2 className="font-baslik text-xl font-bold break-words">
              {a.title}
              {a.is_default && (
                <span className="ml-2 rounded-full bg-nane px-3 py-1 font-sans text-sm font-semibold">
                  Varsayılan
                </span>
              )}
            </h2>
            <p className="break-words">
              {a.recipient}, {formatPhone(a.phone)}
            </p>
            <p className="break-words">
              {a.line}, {a.district} / {a.city} {a.postal_code}
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 underline">
                Düzenle<span className="sr-only"> ({a.title})</span>
              </summary>
              <AddressForm address={a} />
            </details>
            <PanelForm
              action={deleteAddress}
              hidden={{ id: a.id }}
              submit="Sil"
              subject={a.title}
              confirm={`${a.title} adresi silinsin mi?`}
            />
          </li>
        ))}
      </ul>
      {addresses.length < MAX_ADDRESSES ? (
        <section
          aria-labelledby="yeni-adres"
          className="space-y-4 rounded-2xl bg-white p-4"
        >
          <h2 id="yeni-adres" className="font-baslik text-xl font-bold">
            Yeni adres
          </h2>
          <AddressForm />
        </section>
      ) : (
        <p>En fazla {MAX_ADDRESSES} adres kaydedebilirsiniz.</p>
      )}
    </div>
  );
}

function AddressForm({ address: a }: { address?: Address }) {
  return (
    <PanelForm
      action={saveAddress}
      hidden={{ id: a?.id ?? "" }}
      submit={a ? "Kaydet" : "Adresi ekle"}
      subject={a?.title}
      resetOnOk={!a}
    >
      <Field
        label="Adres adı"
        name="title"
        defaultValue={a?.title}
        hint="Örnek: Ev, İş"
        required
        maxLength={40}
      />
      <Field
        label="Alıcının adı soyadı"
        name="recipient"
        defaultValue={a?.recipient}
        autoComplete="name"
        required
        minLength={2}
        maxLength={100}
      />
      <Field
        label="Cep telefonu"
        name="phone"
        type="tel"
        defaultValue={a ? formatPhone(a.phone) : ""}
        autoComplete="tel"
        hint="Örnek: 0555 000 00 00"
        required
        maxLength={30}
      />
      <PlaceFields address={a} />
      {!a?.is_default && (
        <CheckField label="Varsayılan adresim olsun" name="is_default" />
      )}
    </PanelForm>
  );
}
