import type { Metadata } from "next";
import { CheckField, Field } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { requirePermission } from "@/modules/auth/access";
import { saveCarrier } from "@/modules/shipping/actions";
import { listCarriers, type Carrier } from "@/modules/shipping/queries";

export const metadata: Metadata = { title: "Kargo firmaları" };

export default async function CarriersPage() {
  const access = await requirePermission("shipping.read");
  const readOnly = !access.permissions.includes("settings.basic");
  const carriers = await listCarriers();

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Kargo firmaları</h1>
      {carriers.length === 0 && <p>Henüz firma eklenmedi.</p>}
      <ul className="space-y-4">
        {carriers.map((c) => (
          <li key={c.id} className="space-y-3 rounded-xl bg-white p-4">
            <h2 className="font-baslik text-xl font-bold break-words">
              {c.name}
              {!c.is_active && " (kullanılmıyor)"}
            </h2>
            <CarrierForm carrier={c} readOnly={readOnly} />
          </li>
        ))}
      </ul>
      {!readOnly && (
        <section
          aria-labelledby="yeni"
          className="space-y-3 rounded-xl bg-white p-4"
        >
          <h2 id="yeni" className="font-baslik text-xl font-bold">
            Yeni firma
          </h2>
          <CarrierForm />
        </section>
      )}
    </div>
  );
}

function CarrierForm({
  carrier: c,
  readOnly,
}: {
  carrier?: Carrier;
  readOnly?: boolean;
}) {
  return (
    <PanelForm
      action={saveCarrier}
      hidden={{ id: c?.id ?? "" }}
      submit={c ? "Kaydet" : "Firma ekle"}
      subject={c?.name}
      readOnly={readOnly}
      resetOnOk={!c}
    >
      <Field
        label="Firma adı"
        name="name"
        defaultValue={c?.name}
        required
        maxLength={60}
      />
      <Field
        label="Takip adresi (isteğe bağlı)"
        name="url"
        defaultValue={c?.url_template ?? ""}
        inputMode="url"
        maxLength={300}
        hint="Takip numarasının yerine {no} yazın. Örnek: https://kargo.example/takip?no={no}"
      />
      <CheckField
        label="Yeni gönderilerde kullanılır"
        name="active"
        defaultChecked={c?.is_active ?? true}
      />
    </PanelForm>
  );
}
