import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckField } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { requireStaff } from "@/modules/auth/access";
import { applyImport } from "@/modules/import/actions";
import {
  kindLabels,
  modeLabels,
  permissionFor,
} from "@/modules/import/columns";
import { rowLabels, statusLabel } from "@/modules/import/labels";
import {
  countRows,
  getImport,
  listRows,
  rowFilters,
} from "@/modules/import/queries";

export const metadata: Metadata = { title: "Excel önizleme" };

const filterSchema = z.object({
  goster: z.enum(rowFilters).catch("all"),
  sayfa: z.coerce.number().int().min(1).max(1000).catch(1),
});

export default async function ImportPreviewPage({
  params,
  searchParams,
}: PageProps<"/yonetim/excel/[id]">) {
  const { permissions } = await requireStaff();
  const { id } = await params;
  const canImport = (["products", "stock"] as const).some((k) =>
    permissions.includes(permissionFor(k)),
  );
  const job = canImport ? await getImport(id) : null;
  if (!job) notFound();

  const { goster, sayfa } = filterSchema.parse(await searchParams);
  const [counts, { rows, hasNext }] = await Promise.all([
    countRows(id),
    listRows(id, goster, sayfa),
  ]);
  const changes = counts.create + counts.update;
  const filters = [
    { value: "all", label: "Hepsi", count: job.total },
    { value: "error", label: rowLabels.error, count: counts.error },
    { value: "price", label: "Fiyat uyarısı", count: job.price_warnings },
    { value: "create", label: rowLabels.create, count: counts.create },
    { value: "update", label: rowLabels.update, count: counts.update },
    { value: "skip", label: rowLabels.skip, count: counts.skip },
  ].filter((f) => f.count > 0);
  const pageLink = (page: number) => `?goster=${goster}&sayfa=${page}`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-baslik text-3xl font-bold break-words">
          {job.file_name}
        </h1>
        <p>
          {kindLabels[job.kind]}
          {job.stock_mode && ` · ${modeLabels[job.stock_mode]}`} ·{" "}
          <span
            className={
              job.status === "invalid"
                ? "font-semibold text-nar"
                : "font-semibold"
            }
          >
            {statusLabel(job)}
          </span>
        </p>
        <Link
          href="/yonetim/excel"
          className="inline-flex min-h-11 items-center underline"
        >
          Yüklemelere dön
        </Link>
      </div>

      {job.status === "invalid" && (
        <p className="rounded-xl bg-white p-4">
          Hiçbir kayıt değişmedi. Hataları Excel dosyasında düzeltip dosyayı
          yeniden yükleyin.
        </p>
      )}
      {job.status === "validated" &&
        (changes === 0 ? (
          <p className="rounded-xl bg-white p-4">
            Dosya kayıtlarla aynı; uygulanacak değişiklik yok.
          </p>
        ) : job.is_own ? (
          <section aria-label="Uygula" className="rounded-xl bg-white p-4">
            <PanelForm
              action={applyImport}
              hidden={{ id }}
              submit={`${changes} satırı uygula`}
              confirm={`${changes} satır uygulansın mı?`}
            >
              {job.price_warnings > 0 && (
                <div>
                  <p className="font-semibold text-nar">
                    {job.price_warnings} satırda fiyat %10 veya daha fazla
                    değişiyor.
                  </p>
                  <CheckField
                    name="prices"
                    label="Fiyat değişikliklerini kontrol ettim"
                    required
                  />
                </div>
              )}
              {job.applied_before && (
                <div>
                  <p className="font-semibold text-nar">
                    Bu dosya daha önce uygulanmış.
                  </p>
                  <CheckField
                    name="repeat"
                    label="Yeniden uygulamak istiyorum"
                    required
                  />
                </div>
              )}
            </PanelForm>
          </section>
        ) : (
          <p className="rounded-xl bg-white p-4">
            Yalnızca dosyayı yükleyen kişi ({job.creator_name || "Adsız"})
            uygulayabilir.
          </p>
        ))}

      <section aria-labelledby="satirlar" className="space-y-3">
        <h2 id="satirlar" className="font-baslik text-xl font-bold">
          Satırlar
        </h2>
        <nav aria-label="Satır süzgeci" className="flex flex-wrap gap-x-5">
          {filters.map((f) => (
            <Link
              key={f.value}
              href={`?goster=${f.value}`}
              aria-current={goster === f.value ? "page" : undefined}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline aria-[current]:font-bold aria-[current]:underline"
            >
              {f.label} ({f.count})
            </Link>
          ))}
        </nav>
        {rows.length === 0 && <p>Satır yok.</p>}
        <ol className="divide-y divide-gri/40 border-y border-gri/40">
          {rows.map((row) => (
            <li
              key={row.id}
              aria-label={`Satır ${row.row_no}`}
              className="space-y-1 py-4"
            >
              <p className="font-semibold break-words">
                Satır {row.row_no}: {row.raw.SKU ?? "SKU yok"}{" "}
                <span
                  className={`font-normal ${row.action === "error" ? "text-nar" : "text-gri"}`}
                >
                  · {rowLabels[row.action]}
                </span>
              </p>
              {row.big_price_change && (
                <p className="text-sm font-semibold text-nar">
                  Fiyat %10 veya daha fazla değişiyor
                </p>
              )}
              {row.errors.map((error) => (
                <p key={error} className="break-words text-nar">
                  {error}
                </p>
              ))}
              {row.summary.map((change) => (
                <p key={change.field} className="text-sm break-words">
                  {change.field}:{" "}
                  {change.old !== null && (
                    <>
                      <span className="text-gri">{change.old}</span> →{" "}
                    </>
                  )}
                  {change.new}
                </p>
              ))}
            </li>
          ))}
        </ol>
        <nav aria-label="Sayfalar" className="flex justify-between">
          {sayfa > 1 ? (
            <Link href={pageLink(sayfa - 1)} className="underline">
              Önceki
            </Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link href={pageLink(sayfa + 1)} className="underline">
              Sonraki
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}
