"use client";

import { useActionState, useId, type ReactNode } from "react";
import type { StaffState } from "./actions";

/** Tek işlemlik küçük form. `confirm` verilirse göndermeden önce onay sorar. */
export function StaffForm({
  action,
  hidden = {},
  submit,
  subject,
  confirm,
  children,
}: {
  action: (state: StaffState, form: FormData) => Promise<StaffState>;
  hidden?: Record<string, string>;
  submit: string;
  /** Ekran okuyucuda aynı adlı düğmeleri ayırır. */
  subject?: string;
  confirm?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        {children}
        <button
          disabled={pending}
          className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane disabled:opacity-60"
        >
          {submit}
          {subject && <span className="sr-only"> ({subject})</span>}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-nar">
          {state.error}
        </p>
      )}
      {state.ok && <p role="status">{state.ok}</p>}
    </form>
  );
}

const inputClass =
  "mt-1 block min-h-11 w-full rounded-xl border border-gri bg-white px-3";

export function EmailField({ label }: { label: string }) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 basis-56">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        name="email"
        type="email"
        required
        autoComplete="off"
        className={inputClass}
      />
    </div>
  );
}

export function RoleField({
  label,
  options,
}: {
  label: string;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select
        id={id}
        name="role"
        required
        defaultValue=""
        className={inputClass}
      >
        {/* Varsayılan rol yok: yanlışlıkla yüksek yetki verilmesin. */}
        <option value="" disabled>
          Rol seçin
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
