import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CheckField, Field, TextArea } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { priceInput } from "@/lib/money";
import { requirePermission } from "@/modules/auth/access";
import { saveSettings } from "@/modules/orders/actions";
import { getSettings } from "@/modules/orders/queries";
import { holidayInput, vatInput } from "@/modules/orders/validation";

export const metadata: Metadata = { title: "Ayarlar" };

export default async function SettingsPage() {
  await requirePermission("settings.critical");
  const s = await getSettings();

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Ayarlar</h1>
      <PanelForm
        action={saveSettings}
        submit="Ayarları kaydet"
        confirm="Ayarlar kaydedilsin mi? Yeni siparişleri hemen etkiler."
      >
        <Group title="Kargo ve hediye paketi">
          <Money
            label="Kargo ücreti"
            name="shipping_fee"
            value={s.shipping_fee}
          />
          <Money
            label="Ücretsiz kargo sınırı"
            name="free_shipping_from"
            value={s.free_shipping_from}
            hint="Ara toplam bu tutar veya üzeriyse kargo ücretsizdir."
          />
          <Money
            label="Hediye paketi (sipariş başına)"
            name="gift_fee"
            value={s.gift_fee}
          />
        </Group>

        <Group title="Havale/EFT">
          <Field
            label="Hesap sahibi"
            name="bank_holder"
            defaultValue={s.bank_holder}
            maxLength={200}
          />
          <Field
            label="IBAN"
            name="bank_iban"
            defaultValue={s.bank_iban}
            maxLength={40}
            hint="Boşsa havale/EFT kapalıdır. Denemede gerçek hesap yazmayın."
          />
          <Count
            label="Bekleme süresi (iş günü)"
            name="transfer_days"
            value={s.transfer_days}
          />
          <CheckField
            label="Eşleştiren ile onaylayan farklı kişi olsun"
            name="transfer_two_person"
            defaultChecked={s.transfer_two_person}
          />
          <TextArea
            label="Resmî tatiller"
            name="holidays"
            defaultValue={holidayInput(s.holidays)}
            hint="Her satıra bir gün: 01.01.2027"
            maxLength={1000}
          />
        </Group>

        <Group title="Kart ödemesi">
          <CheckField
            label="Kart ödemesi açık"
            name="card_enabled"
            defaultChecked={s.card_enabled}
          />
          <Count
            label="Ödeme süresi (dakika)"
            name="card_minutes"
            value={s.card_minutes}
          />
        </Group>

        <Group title="Kapıda ödeme">
          <CheckField
            label="Kapıda ödeme açık"
            name="cod_enabled"
            defaultChecked={s.cod_enabled}
          />
          <Money label="Üst sınır" name="cod_limit" value={s.cod_limit} />
          <Money label="Ek ücret" name="cod_fee" value={s.cod_fee} />
          <CheckField
            label="Kapıda kart kabul edilir"
            name="cod_card"
            defaultChecked={s.cod_card}
          />
          <CheckField
            label="Onaydan önce telefon doğrulaması zorunlu"
            name="phone_check"
            defaultChecked={s.phone_check}
          />
        </Group>

        <Group title="Mağazadan teslim">
          <CheckField
            label="Mağazadan teslim açık"
            name="pickup_enabled"
            defaultChecked={s.pickup_enabled}
          />
          <CheckField
            label="Mağazada ödenebilir"
            name="pickup_pay"
            defaultChecked={s.pickup_pay}
          />
          <Count
            label="Bekleme süresi (gün)"
            name="pickup_days"
            value={s.pickup_days}
          />
          <Field
            label="Mağaza adresi"
            name="pickup_address"
            defaultValue={s.pickup_address}
            maxLength={200}
          />
        </Group>

        <Group title="Sınırlar ve yayın">
          <Count
            label="Kişi başına ödenmemiş sipariş"
            name="max_unpaid"
            value={s.max_unpaid}
          />
          <Count
            label="Misafir bağlantısının süresi (gün)"
            name="link_days"
            value={s.link_days}
          />
          <Vat
            label="Kargo KDV oranı (%)"
            name="shipping_vat_bps"
            value={s.shipping_vat_bps}
          />
          <Vat
            label="Hediye paketi KDV oranı (%)"
            name="gift_vat_bps"
            value={s.gift_vat_bps}
          />
          <Vat
            label="Kapıda ödeme KDV oranı (%)"
            name="cod_vat_bps"
            value={s.cod_vat_bps}
          />
          <CheckField
            label="Deneme modu açık"
            name="test_mode"
            defaultChecked={s.test_mode}
          />
        </Group>
      </PanelForm>
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title} className="space-y-4 rounded-xl bg-white p-4">
    <h2 className="font-baslik text-xl font-bold">{title}</h2>
    {children}
  </section>
);

const Money = ({
  label,
  name,
  value,
  hint,
}: {
  label: string;
  name: string;
  value: number;
  hint?: string;
}) => (
  <Field
    label={`${label} (TL)`}
    name={name}
    defaultValue={priceInput(value)}
    inputMode="decimal"
    required
    maxLength={15}
    hint={hint}
  />
);

const Count = (p: { label: string; name: string; value: number }) => (
  <Field
    label={p.label}
    name={p.name}
    defaultValue={p.value}
    inputMode="numeric"
    required
    maxLength={3}
  />
);

const Vat = (p: { label: string; name: string; value: number | null }) => (
  <Field
    label={p.label}
    name={p.name}
    defaultValue={vatInput(p.value)}
    inputMode="decimal"
    maxLength={5}
    hint="Mali müşavir onayı olmadan boş bırakın."
  />
);
