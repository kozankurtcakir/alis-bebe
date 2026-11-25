import Link from "next/link";
import { Field, SelectField } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { formatPrice } from "@/lib/money";
import { formatDate } from "@/modules/orders/labels";
import { Fact } from "@/modules/orders/parts";
import type { OrderDetail } from "@/modules/orders/queries";
import {
  advanceShipment,
  createShipment,
  recordCod,
  saveTracking,
} from "./actions";
import {
  codStatuses,
  eventText,
  shipmentStatuses,
  shipmentSteps,
  type ShipmentStatus,
} from "./labels";
import type { Carrier } from "./queries";

const questions: Partial<Record<ShipmentStatus, string>> = {
  handed_over:
    "Paket kargoya verildi mi? Sipariş artık iptal edilemez, müşteriye e-posta gider.",
  delivered: "Paket müşteriye teslim edildi mi? Bu işlem geri alınamaz.",
  returned: "Paket mağazaya geri döndü mü? Bu işlem geri alınamaz.",
  cancelled: "Gönderi iptal edilsin mi? Sipariş hazırlanmaya devam eder.",
};
const buttons: Partial<Record<ShipmentStatus, string>> = {
  handed_over: "Kargoya verildi",
  delivered: "Teslim edildi",
  returned: "Mağazaya geri döndü",
  cancelled: "Gönderiyi iptal et",
};

/** Sipariş ayrıntısının kargo bölümü. */
export function Shipment({
  order: o,
  carriers,
  canWrite,
}: {
  order: OrderDetail;
  carriers: Carrier[];
  canWrite: boolean;
}) {
  const s = o.shipment;
  const open = s?.status === "created" || s?.status === "handed_over";
  const choices = carriers.filter((c) => c.is_active || c.id === s?.carrier_id);
  const steps =
    s && canWrite
      ? shipmentSteps(s.status, s.carrier_id !== null && s.tracking_no !== null)
      : [];

  return (
    <>
      {!s && <p>Açık gönderi yok.</p>}
      {!s && canWrite && o.order_status === "preparing" && (
        <PanelForm
          action={createShipment}
          hidden={{ id: o.id }}
          submit="Gönderi oluştur"
        />
      )}
      {s && (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Gönderi" value={s.our_ref} />
          <Fact label="Gönderi durumu" value={shipmentStatuses[s.status]} />
          <Fact label="Kargo firması" value={s.carrier ?? "Seçilmedi"} />
          <Fact label="Takip numarası" value={s.tracking_no ?? "Yazılmadı"} />
        </dl>
      )}
      {s && canWrite && (
        <Link
          href={`/yonetim/siparisler/${o.id}/etiket`}
          target="_blank"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Etiketi yazdır (yeni sekmede açılır)
        </Link>
      )}
      {s && open && canWrite && choices.length === 0 && (
        <p className="font-semibold text-nar">
          Önce Kargo firmaları sayfasından firma eklenmeli.
        </p>
      )}
      {s && open && canWrite && choices.length > 0 && (
        <PanelForm
          // Kaydedilen numara düzeltilmiş hâliyle görünür.
          key={`${s.carrier_id} ${s.tracking_no}`}
          action={saveTracking}
          hidden={{ id: s.id }}
          submit={
            s.status === "created"
              ? "Takip bilgisini kaydet"
              : "Takip bilgisini düzelt"
          }
        >
          <SelectField
            label="Kargo firması"
            name="carrier"
            empty="Seçin"
            defaultValue={s.carrier_id ?? ""}
            options={choices.map((c) => ({ value: c.id, label: c.name }))}
            required
          />
          <Field
            label="Takip numarası"
            name="tracking"
            defaultValue={s.tracking_no ?? ""}
            required
            maxLength={50}
          />
        </PanelForm>
      )}
      {s &&
        steps.map((to) => (
          <PanelForm
            key={to}
            action={advanceShipment}
            hidden={{ id: s.id, to }}
            submit={buttons[to] ?? to}
            confirm={questions[to]}
          />
        ))}
      {o.shipment_events.length > 0 && (
        <details>
          <summary className="min-h-11 py-2 font-semibold">
            Gönderi geçmişi
          </summary>
          <ol className="space-y-3">
            {o.shipment_events.map((e) => (
              <li key={e.seq}>
                <p className="break-words">{eventText(e)}</p>
                <p className="text-sm break-words text-gri">
                  {e.ref} · {formatDate(e.at)} · {e.actor ?? "Sistem"}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

/** Kapıda ödemede firmanın yatırdığı para. Teslim, tahsilat sayılmaz. */
export function CodSettlement({
  cod,
  canWrite,
}: {
  cod: NonNullable<OrderDetail["cod"]>;
  canWrite: boolean;
}) {
  const received = cod.receipts.reduce((sum, r) => sum + r.amount, 0);
  const gap = received - cod.expected;
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Beklenen" value={formatPrice(cod.expected)} />
        <Fact label="Gelen" value={formatPrice(received)} />
        <Fact label="Tahsilat durumu" value={codStatuses[cod.status]} />
      </dl>
      {received > 0 && gap !== 0 && (
        <p className="font-semibold text-nar">
          {gap < 0
            ? `${formatPrice(-gap)} eksik. Kargo firmasına sorun.`
            : `${formatPrice(gap)} fazla. Kargo firmasına sorun.`}
        </p>
      )}
      <ul className="space-y-2">
        {cod.receipts.map((r) => (
          <li key={r.seq}>
            <p className="break-words">
              <strong>{formatPrice(r.amount)}</strong> · {r.reference}
            </p>
            <p className="text-sm text-gri">
              {r.by} · {formatDate(r.at)}
            </p>
          </li>
        ))}
      </ul>
      {canWrite && (
        <PanelForm
          action={recordCod}
          hidden={{ id: cod.id }}
          submit="Kaydı ekle"
          confirm="Tutarı banka hesabında gördünüz mü?"
          resetOnOk
          once
        >
          <SelectField
            label="Kayıt türü"
            name="kind"
            defaultValue="in"
            options={[
              { value: "in", label: "Para geldi" },
              { value: "fix", label: "Yanlış kaydı düş" },
            ]}
          />
          <Field
            label="Tutar (TL)"
            name="amount"
            inputMode="decimal"
            hint="Örnek: 249,90"
            required
            maxLength={15}
          />
          <Field
            label="Banka işlem numarası"
            name="reference"
            required
            maxLength={100}
          />
        </PanelForm>
      )}
    </>
  );
}
