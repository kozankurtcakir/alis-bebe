import type { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/modules/auth/access";
import { permissionFor } from "@/modules/import/columns";
import { buildWorkbook } from "@/modules/import/export";
import { exportVariants, getImportLists } from "@/modules/import/queries";

const schema = z.object({
  tur: z.enum(["products", "stock"]),
  // Parça yoksa boş şablon indirilir.
  parca: z.coerce.number().int().min(1).max(1000).optional(),
});

export async function GET(request: NextRequest) {
  const input = schema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!input.success) return new Response(null, { status: 400 });
  const { tur, parca } = input.data;
  await requirePermission(permissionFor(tur));

  const [variants, lists] = await Promise.all([
    parca ? exportVariants(parca) : null,
    getImportLists(),
  ]);
  const file = await buildWorkbook(tur, variants, lists.categories);
  const name = `${tur === "products" ? "urunler" : "stok"}-${parca ?? "sablon"}.xlsx`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
