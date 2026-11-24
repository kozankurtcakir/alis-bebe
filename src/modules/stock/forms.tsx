"use client";

import { Field } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { adjustStock, reverseMovement } from "./actions";
import type { ManualReason } from "./labels";

const operations: Record<
  ManualReason,
  {
    title: string;
    quantity: string;
    submit: string;
    noteRequired: boolean;
    after: (onHand: number, quantity: number) => number;
  }
> = {
  initial: {
    title: "İlk stok",
    quantity: "Başlangıç adedi",
    submit: "İlk stoğu kaydet",
    noteRequired: false,
    after: (_, quantity) => quantity,
  },
  purchase: {
    title: "Mal girişi",
    quantity: "Eklenecek adet",
    submit: "Girişi kaydet",
    noteRequired: false,
    after: (onHand, quantity) => onHand + quantity,
  },
  damage: {
    title: "Hasar / kayıp",
    quantity: "Düşülecek adet",
    submit: "Düşüşü kaydet",
    noteRequired: true,
    after: (onHand, quantity) => onHand - quantity,
  },
  adjustment: {
    title: "Sayım",
    quantity: "Rafta sayılan adet",
    submit: "Sayımı kaydet",
    noteRequired: true,
    after: (_, quantity) => quantity,
  },
};

export function StockOperation({
  variant,
  reason,
  onHand,
}: {
  variant: string;
  reason: ManualReason;
  onHand: number;
}) {
  const op = operations[reason];
  return (
    <details className="rounded-xl border border-gri/40 bg-white px-4">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
        {op.title}
      </summary>
      <div className="pb-5">
        <PanelForm
          action={adjustStock}
          hidden={{ id: variant, reason, expected: String(onHand) }}
          submit={op.submit}
          resetOnOk
          once
          check={(form) => {
            const quantity = Number(form.get("quantity"));
            if (op.after(onHand, quantity) < 0) {
              return `Stok yetersiz: elde ${onHand} adet var.`;
            }
          }}
          confirm={(form) =>
            `${op.title}: stok ${onHand} → ${op.after(onHand, Number(form.get("quantity")))}. Kaydedilsin mi?`
          }
        >
          <Field
            label={op.quantity}
            name="quantity"
            type="number"
            inputMode="numeric"
            min={reason === "adjustment" ? 0 : 1}
            max={100000}
            step={1}
            required
          />
          <Field
            label={op.noteRequired ? "Not" : "Not (isteğe bağlı)"}
            name="note"
            maxLength={500}
            required={op.noteRequired}
          />
        </PanelForm>
      </div>
    </details>
  );
}

export function ReverseForm({
  movement,
  subject,
}: {
  movement: string;
  subject: string;
}) {
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
        Ters kayıt<span className="sr-only"> ({subject})</span>
      </summary>
      <PanelForm
        action={reverseMovement}
        hidden={{ id: movement }}
        submit="Ters kaydı oluştur"
        subject={subject}
        once
        confirm={`${subject}: karşı hareketle geri alınsın mı?`}
      >
        <Field label="Neden" name="note" required maxLength={500} />
      </PanelForm>
    </details>
  );
}
