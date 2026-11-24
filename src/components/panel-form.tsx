"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type PanelState = { ok?: string; error?: string };

/** Yönetim panelinin ortak formu. */
export function PanelForm({
  action,
  hidden = {},
  submit,
  subject,
  confirm,
  readOnly,
  resetOnOk,
  check,
  once,
  children,
}: {
  action: (state: PanelState, form: FormData) => Promise<PanelState>;
  hidden?: Record<string, string>;
  submit: string;
  /** Ekran okuyucuda aynı adlı düğmeleri ayırır. */
  subject?: string;
  /** Göndermeden önce sorulan onay. */
  confirm?: string | ((form: FormData) => string);
  /** Yazma izni olmayan kişi alanları görür ama değiştiremez. */
  readOnly?: boolean;
  /** Ekleme formları başarıdan sonra boşalır. */
  resetOnOk?: boolean;
  /** Göndermeden önceki tarayıcı kontrolü; hata metni döndürürse gönderilmez. */
  check?: (form: FormData) => string | undefined;
  /** İstek, tek kullanımlık `key` taşır; yeniden gönderilirse iki kez işlenmez. */
  once?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [problem, setProblem] = useState<string>();
  const ref = useRef<HTMLFormElement>(null);
  const key = useRef<string>(undefined);

  useEffect(() => {
    if (!state.ok) return;
    key.current = undefined;
    if (resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);

  const error = problem ?? state.error;
  return (
    <form
      ref={ref}
      action={formAction}
      // Değerler değişince bu yeni bir istektir.
      onChange={() => (key.current = undefined)}
      onSubmit={(e) => {
        // React, hata olsa da formu boşaltır; yazılanlar kaybolmasın diye elle gönderilir.
        e.preventDefault();
        if (pending) return;
        const form = new FormData(e.currentTarget);
        const found = check?.(form);
        setProblem(found);
        if (found) return;
        const question =
          typeof confirm === "function" ? confirm(form) : confirm;
        if (question && !window.confirm(question)) return;
        if (once) form.set("key", (key.current ??= crypto.randomUUID()));
        startTransition(() => formAction(form));
      }}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        {!readOnly && (
          <button
            disabled={pending}
            className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane disabled:opacity-60"
          >
            {pending ? "Bekleyin…" : submit}
            {subject && <span className="sr-only"> ({subject})</span>}
          </button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-nar">
          {error}
        </p>
      )}
      {!error && state.ok && (
        <p role="status" className="mt-2">
          {state.ok}
        </p>
      )}
    </form>
  );
}
