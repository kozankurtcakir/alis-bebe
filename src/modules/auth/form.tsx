"use client";

import { useActionState, useId, type ReactNode } from "react";
import { startMfaSetup, type FormState, type MfaSetup } from "./actions";

type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete: string;
  inputMode?: "numeric";
  hint?: string;
};

const buttonClass =
  "min-h-12 w-full rounded-xl bg-petrol px-5 font-semibold text-white hover:bg-petrol/90 disabled:opacity-60";

export function ActionForm({
  action,
  fields = [],
  hidden = {},
  submit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields?: Field[];
  hidden?: Record<string, string>;
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const id = useId();

  if (state.ok) return <Notice>{state.ok}</Notice>;

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.error && <Notice error>{state.error}</Notice>}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map(({ name, label, hint, ...input }) => {
        const error = state.errors?.[name]?.[0];
        const described = error ?? hint;
        return (
          <div key={name}>
            <label htmlFor={`${id}-${name}`} className="font-semibold">
              {label}
            </label>
            <input
              {...input}
              id={`${id}-${name}`}
              name={name}
              required
              defaultValue={state.values?.[name]}
              aria-invalid={error ? true : undefined}
              aria-describedby={described ? `${id}-${name}-not` : undefined}
              className="mt-1 min-h-12 w-full rounded-xl border border-gri bg-white px-4 aria-invalid:border-nar"
            />
            {described && (
              <p
                id={`${id}-${name}-not`}
                className={`mt-1 text-sm ${error ? "text-nar" : "text-gri"}`}
              >
                {described}
              </p>
            )}
          </div>
        );
      })}
      <button disabled={pending} className={buttonClass}>
        {pending ? "Bekleyin…" : submit}
      </button>
    </form>
  );
}

function Notice({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-xl border-l-4 bg-white p-4 ${error ? "border-nar" : "border-petrol"}`}
    >
      {children}
    </p>
  );
}

/** İki adımlı doğrulamayı ilk kez kurar; QR kodu yalnızca istenince üretilir. */
export function MfaSetupForm({ children }: { children: ReactNode }) {
  const [state, start, pending] = useActionState<MfaSetup>(startMfaSetup, {});

  if (!state.secret) {
    return (
      <form action={start} className="space-y-5">
        {state.error && <Notice error>{state.error}</Notice>}
        <button disabled={pending} className={buttonClass}>
          {pending ? "Bekleyin…" : "Kurulumu başlat"}
        </button>
      </form>
    );
  }
  return (
    <div className="space-y-5">
      <p>Doğrulama uygulamanızla (ör. Google Authenticator) kodu okutun.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- veri adresi, iyileştirilecek dosya yok */}
      <img
        src={state.qr}
        alt="İki adımlı doğrulama QR kodu"
        width={200}
        height={200}
        className="mx-auto bg-white p-2"
      />
      <p className="text-sm text-gri">
        Okutamıyorsanız bu anahtarı elle girin:{" "}
        <code data-testid="mfa-anahtar" className="font-semibold break-all">
          {state.secret}
        </code>
      </p>
      {children}
    </div>
  );
}
