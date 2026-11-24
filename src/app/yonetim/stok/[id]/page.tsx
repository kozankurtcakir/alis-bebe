import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Field } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { requirePermission } from "@/modules/auth/access";
import { setCriticalLevel } from "@/modules/stock/actions";
import { ReverseForm, StockOperation } from "@/modules/stock/forms";
import { isReversible, reasonLabel, stockState } from "@/modules/stock/labels";
import { getVariantStock, listMovements } from "@/modules/stock/queries";

export const metadata: Metadata = { title: "Varyant stoğu" };

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

const dateFormat = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

export default async function VariantStockPage({
  params,
  searchParams,
}: PageProps<"/yonetim/stok/[id]">) {
  const { permissions } = await requirePermission("stock.read");
  const { id } = await params;
  const stock = await getVariantStock(id);
  if (!stock) notFound();
  const page = pageSchema.parse((await searchParams).sayfa);
  const { rows, hasNext } = await listMovements(id, page);

  const canAdjust = permissions.includes("stock.adjust");
  const state = stockState(stock);
  const isEmpty = page === 1 && rows.length === 0;

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-baslik text-3xl font-bold break-words">
          {stock.product.name}
        </h1>
        <p className="break-words text-gri">
          {[stock.label, stock.sku].filter(Boolean).join(" · ")}
        </p>
        <Link
          href={`/yonetim/katalog/${stock.product.id}`}
          className="inline-flex min-h-11 items-center underline"
        >
          Ürünü aç
        </Link>
      </div>

      <dl className="grid grid-cols-3 gap-4 text-center">
        {[
          ["Eldeki", stock.on_hand],
          ["Ayrılmış", stock.reserved],
          ["Satılabilir", stock.available],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white p-4">
            <dt className="text-sm text-gri">{label}</dt>
            <dd className="text-2xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      {state && (
        <p
          className={`font-semibold ${stock.is_sellable ? "text-nar" : "text-gri"}`}
        >
          {state}
        </p>
      )}

      {canAdjust && (
        <section aria-labelledby="islem" className="space-y-3">
          <h2 id="islem" className="font-baslik text-xl font-bold">
            Stok işlemi
          </h2>
          {isEmpty && (
            <StockOperation
              variant={id}
              reason="initial"
              onHand={stock.on_hand}
            />
          )}
          {(["purchase", "damage", "adjustment"] as const).map((reason) => (
            <StockOperation
              key={reason}
              variant={id}
              reason={reason}
              onHand={stock.on_hand}
            />
          ))}
        </section>
      )}

      <section aria-labelledby="kritik" className="space-y-3">
        <h2 id="kritik" className="font-baslik text-xl font-bold">
          Kritik seviye
        </h2>
        <PanelForm
          action={setCriticalLevel}
          hidden={{ id }}
          submit="Seviyeyi kaydet"
          readOnly={!canAdjust}
        >
          <Field
            label="Uyarı seviyesi"
            name="level"
            type="number"
            min={0}
            max={10000}
            step={1}
            required
            defaultValue={stock.critical_level}
            hint="Satılabilir stok bu sayıya inince uyarı çıkar."
          />
        </PanelForm>
      </section>

      <section aria-labelledby="hareketler" className="space-y-3">
        <h2 id="hareketler" className="font-baslik text-xl font-bold">
          Hareketler
        </h2>
        {rows.length === 0 && <p>Hareket yok.</p>}
        <ol className="divide-y divide-gri/40">
          {rows.map((m) => (
            <li key={m.id} className="space-y-1 py-4">
              <p className="font-semibold">
                {reasonLabel(m.reason)}: {signed(m.delta)}{" "}
                <span className="font-normal">→ {m.on_hand_after}</span>
              </p>
              {m.note && <p className="break-words">{m.note}</p>}
              <p className="text-sm text-gri">
                <time dateTime={m.created_at}>
                  {dateFormat.format(new Date(m.created_at))}
                </time>{" "}
                · {m.actor_name || "Adsız"}
              </p>
              {m.is_reversed && <p className="text-sm">Ters çevrildi</p>}
              {canAdjust && isReversible(m.reason) && !m.is_reversed && (
                <ReverseForm
                  movement={m.id}
                  subject={`${reasonLabel(m.reason)} ${signed(m.delta)}`}
                />
              )}
            </li>
          ))}
        </ol>
        <nav aria-label="Sayfalar" className="flex justify-between">
          {page > 1 ? (
            <Link href={`?sayfa=${page - 1}`} className="underline">
              Daha yeni
            </Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link href={`?sayfa=${page + 1}`} className="underline">
              Daha eski
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}
