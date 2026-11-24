import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { requirePermission } from "@/modules/auth/access";
import { actionLabel, roleLabel } from "@/modules/staff/labels";

export const metadata: Metadata = { title: "İşlem geçmişi" };

const PAGE_SIZE = 50;
const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const change = z.object({ role: z.string().optional() }).nullable();
const logsSchema = z.array(
  z.object({
    id: z.string(),
    created_at: z.string(),
    actor_email: z.string().nullable(),
    action: z.string(),
    target_email: z.string().nullable(),
    before: change,
    after: change,
  }),
);

const dateFormat = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

export default async function AuditPage({
  searchParams,
}: PageProps<"/yonetim/islem-gecmisi">) {
  await requirePermission("audit.read");
  const page = pageSchema.parse((await searchParams).sayfa);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_audit_logs", {
    p_page: page,
  });
  if (error) throw new Error(`İşlem geçmişi okunamadı: ${error.code}`);
  const rows = logsSchema.parse(data);
  const logs = rows.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">İşlem geçmişi</h1>
      {logs.length === 0 && <p>Kayıt yok.</p>}
      <ol className="divide-y divide-gri/40">
        {logs.map((log) => {
          const role = log.after?.role ?? log.before?.role;
          return (
            <li key={log.id} className="space-y-1 py-4">
              <p className="font-semibold">
                {actionLabel(log.action)}
                {role && `: ${roleLabel(role)}`}
              </p>
              <p className="break-words">
                {log.target_email ?? "—"}
                <span className="text-gri">
                  {" "}
                  · yapan: {log.actor_email ?? "sistem"}
                </span>
              </p>
              <time dateTime={log.created_at} className="text-sm text-gri">
                {dateFormat.format(new Date(log.created_at))}
              </time>
            </li>
          );
        })}
      </ol>
      <nav aria-label="Sayfalar" className="flex justify-between">
        {page > 1 ? (
          <Link href={`?sayfa=${page - 1}`} className="underline">
            Daha yeni
          </Link>
        ) : (
          <span />
        )}
        {rows.length > PAGE_SIZE && (
          <Link href={`?sayfa=${page + 1}`} className="underline">
            Daha eski
          </Link>
        )}
      </nav>
    </div>
  );
}
