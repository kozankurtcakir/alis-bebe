import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Field, SelectField } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { requireStaff } from "@/modules/auth/access";
import { uploadImport } from "@/modules/import/actions";
import {
  kindLabels,
  modeLabels,
  permissionFor,
  type Kind,
} from "@/modules/import/columns";
import { statusLabel } from "@/modules/import/labels";
import {
  countVariants,
  EXPORT_SIZE,
  listImports,
} from "@/modules/import/queries";

export const metadata: Metadata = { title: "Excel" };

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

const dateFormat = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

const hints: Record<Kind, string> = {
  products:
    "Yeni ürün ve varyant ekler, var olanları günceller. Satırlar SKU ile eşleşir; boş hücre değiştirmez.",
  stock:
    "Satırlar SKU ile eşleşir; miktarı boş satır atlanır. Dosya indirildikten sonra stoğu değişen satır, sayımda reddedilir.",
};

export default async function ImportPage({
  searchParams,
}: PageProps<"/yonetim/excel">) {
  const { permissions } = await requireStaff();
  const kinds = (["products", "stock"] as const).filter((k) =>
    permissions.includes(permissionFor(k)),
  );
  if (kinds.length === 0) notFound();
  const page = pageSchema.parse((await searchParams).sayfa);
  const [{ jobs, hasNext }, variants] = await Promise.all([
    listImports(page),
    countVariants(),
  ]);
  const parts = Array.from(
    { length: Math.ceil(variants / EXPORT_SIZE) },
    (_, i) => i + 1,
  );

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-baslik text-3xl font-bold">Excel</h1>
        <p className="text-gri">
          Dosya önce kontrol edilir; siz onaylamadan hiçbir kayıt değişmez. En
          fazla 2 MB ve 1.000 satır.
        </p>
      </div>

      {kinds.map((kind) => (
        <section key={kind} aria-labelledby={kind} className="space-y-4">
          <h2 id={kind} className="font-baslik text-xl font-bold">
            {kindLabels[kind]} dosyası
          </h2>
          <p>{hints[kind]}</p>
          <ul className="flex flex-wrap gap-x-6">
            <li>
              <a
                href={`/yonetim/excel/indir?tur=${kind}`}
                download
                className="inline-flex min-h-11 items-center underline"
              >
                Boş şablonu indir
                <span className="sr-only"> ({kindLabels[kind]})</span>
              </a>
            </li>
            {parts.map((part) => (
              <li key={part}>
                <a
                  href={`/yonetim/excel/indir?tur=${kind}&parca=${part}`}
                  download
                  className="inline-flex min-h-11 items-center underline"
                >
                  Kayıtları indir{parts.length > 1 && ` (${part})`}
                  <span className="sr-only"> ({kindLabels[kind]})</span>
                </a>
              </li>
            ))}
          </ul>
          <PanelForm
            action={uploadImport}
            hidden={{ kind }}
            submit="Yükle ve kontrol et"
            subject={kindLabels[kind]}
          >
            {kind === "stock" && (
              <SelectField
                label="Miktar ne anlama geliyor?"
                name="mode"
                empty="Seçin"
                required
                options={Object.entries(modeLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            )}
            <Field
              label={`${kindLabels[kind]} dosyası (.xlsx)`}
              name="file"
              type="file"
              accept=".xlsx"
              required
            />
          </PanelForm>
        </section>
      ))}

      <section aria-labelledby="gecmis" className="space-y-3">
        <h2 id="gecmis" className="font-baslik text-xl font-bold">
          Yüklemeler
        </h2>
        {jobs.length === 0 && <p>Yükleme yok.</p>}
        <ul className="divide-y divide-gri/40">
          {jobs.map((job) => (
            <li key={job.id} className="py-3">
              <Link
                href={`/yonetim/excel/${job.id}`}
                className="inline-flex min-h-11 items-center font-semibold break-all underline underline-offset-4"
              >
                {job.file_name}
              </Link>
              <p className="text-sm">
                {kindLabels[job.kind]} · {job.total} satır ·{" "}
                <span
                  className={job.status === "invalid" ? "text-nar" : undefined}
                >
                  {statusLabel(job)}
                </span>
              </p>
              <p className="text-sm text-gri">
                <time dateTime={job.created_at}>
                  {dateFormat.format(new Date(job.created_at))}
                </time>{" "}
                · {job.creator_name || "Adsız"}
              </p>
            </li>
          ))}
        </ul>
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
