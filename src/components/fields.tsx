"use client"; // Sunucuda üretilen useId kimlikleri, gizli tutulan önceki sayfayla çakışır.

import { useId, type ComponentProps } from "react";

const controlClass =
  "mt-1 block min-h-11 w-full rounded-xl border border-gri bg-white px-3 disabled:bg-zemin";

type Common = { label: string; name: string; hint?: string };

export function Field({
  label,
  hint,
  ...input
}: Common & ComponentProps<"input">) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        autoComplete="off"
        {...input}
        id={id}
        aria-describedby={hint ? `${id}-not` : undefined}
        className={`${controlClass} ${input.type === "color" ? "p-1" : ""} ${input.type === "file" ? "py-2" : ""}`}
      />
      {hint && (
        <p id={`${id}-not`} className="mt-1 text-sm text-gri">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  ...input
}: Common & ComponentProps<"textarea">) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <textarea
        rows={4}
        {...input}
        id={id}
        aria-describedby={hint ? `${id}-not` : undefined}
        className={`${controlClass} py-2`}
      />
      {hint && (
        <p id={`${id}-not`} className="mt-1 text-sm text-gri">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  options,
  empty,
  ...select
}: Common & {
  options: { value: string; label: string }[];
  /** Boş seçeneğin adı; `required` ise seçim zorunlu kalır. */
  empty?: string;
} & ComponentProps<"select">) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select {...select} id={id} className={controlClass}>
        {empty && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckField({
  label,
  ...input
}: { label: string } & ComponentProps<"input">) {
  return (
    <label className="flex min-h-11 w-fit items-center gap-2">
      <input {...input} type="checkbox" className="size-5 accent-petrol" />
      {label}
    </label>
  );
}
