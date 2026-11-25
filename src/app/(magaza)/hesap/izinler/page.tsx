import type { Metadata } from "next";
import { PanelForm } from "@/components/panel-form";
import { setConsent } from "@/modules/account/actions";
import { listConsents } from "@/modules/account/queries";
import { consentKinds } from "@/modules/account/validation";
import { requireUser } from "@/modules/auth/access";

export const instant = false;
export const metadata: Metadata = { title: "İleti izinleri" };

const date = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

export default async function ConsentsPage() {
  await requireUser();
  const consents = await listConsents();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-baslik text-3xl font-bold">İleti izinleri</h1>
      <p>
        Kampanya ve yenilik iletileri yalnızca izin verirseniz gönderilir. İzin
        vermek alışveriş için gerekli değildir; dilediğinizde kaldırabilirsiniz.
      </p>
      <p className="rounded-2xl bg-nane p-4">
        Taslak metin: hukuki metin uzman kontrolünden sonra yayınlanacak.
        Şimdilik hiçbir ileti gönderilmiyor.
      </p>
      <ul className="space-y-4">
        {consents.map(({ kind, granted, at }) => (
          <li key={kind} className="space-y-2 rounded-2xl bg-white p-4">
            <h2 className="font-baslik text-xl font-bold">
              {consentKinds[kind]}
            </h2>
            <p>
              {granted ? "İzin verdiniz" : "İzin yok"}
              {at && ` (${date.format(new Date(at))})`}.
            </p>
            <PanelForm
              action={setConsent}
              hidden={{ kind, granted: String(!granted) }}
              submit={granted ? "İzni kaldır" : "İzin ver"}
              subject={consentKinds[kind]}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
