import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatPrice } from "@/lib/money";
import { activeFake } from "@/modules/payments/service";

export const instant = false;
export const metadata: Metadata = {
  title: "Sahte banka",
  robots: { index: false },
};

const buttons = [
  ["onay", "Ödemeyi onayla"],
  ["red", "Kartı reddet"],
  ["sessiz", "Onayla, bildirim gönderme"],
  ["yanlis", "Eksik tutarla onayla"],
] as const;

/** Yalnızca yerel deneme. Gerçek sağlayıcıda bu sayfa sağlayıcının kendi sitesindedir. */
export default async function FakeBankPage({
  params,
  searchParams,
}: PageProps<"/sahte-odeme/[deneme]">) {
  await connection();
  const { deneme } = await params;
  const { imza } = await searchParams;
  const signature = typeof imza === "string" ? imza : "";
  const item = activeFake()?.page(deneme, signature);
  if (!item) notFound();

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-8">
      <h1 className="font-baslik text-3xl font-bold">Sahte banka</h1>
      <p>
        Bu sayfa yalnızca deneme içindir. Kart bilgisi istenmez, para çekilmez.
      </p>
      <p className="rounded-2xl bg-nane p-4">
        {item.orderNo} · <strong>{formatPrice(item.amount)}</strong>
      </p>
      <form
        method="post"
        action={`/sahte-odeme/${deneme}/karar`}
        className="space-y-4"
      >
        <input type="hidden" name="imza" value={signature} />
        {buttons.map(([karar, label]) => (
          <button
            key={karar}
            name="karar"
            value={karar}
            className="block min-h-11 w-full rounded-xl border border-petrol px-4 font-semibold hover:bg-nane"
          >
            {label}
          </button>
        ))}
      </form>
    </main>
  );
}
