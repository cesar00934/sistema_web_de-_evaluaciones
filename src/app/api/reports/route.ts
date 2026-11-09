import { NextRequest, NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import {
  resultQuery,
  emptyFilters,
  type Filters,
  type ResultRow,
} from "@/lib/result-query";
import { csvCell } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await authenticated(),
      s = request.nextUrl.searchParams,
      filters = { ...emptyFilters };
    let exportOwner = user.id;
    if (s.get("scope") === "all") {
      const { data } = await db.rpc("is_admin");
      if (!data)
        return NextResponse.json(
          { error: "Solo el administrador puede exportar otras cuentas" },
          { status: 403 },
        );
      exportOwner = s.get("owner") ?? "";
    }
    const scopedFilters: Filters = { ...filters, owner: exportOwner };
    for (const k of [
      "area",
      "bimester",
      "grade",
      "section",
      "student",
      "version",
      "from",
      "until",
    ] as const)
      filters[k] = (s.get(k) ?? "").slice(0, 200);
    filters.pending = s.get("pending") === "true";
    const all: ResultRow[] = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const { data, error, count } = await resultQuery(db, {
        ...filters,
        owner: scopedFilters.owner,
      } as Filters).range(offset, offset + 499);
      if (error) throw error;
      if ((count ?? 0) > 10000)
        throw Error(
          "Exportación limitada a 10 000 resultados; aplica filtros.",
        );
      all.push(...(data as unknown as ResultRow[]));
      if ((data as unknown as ResultRow[]).length < 500) break;
    }
    const rows = all.map((r) => ({
      student: `${r.students.last_names}, ${r.students.first_names}`,
      exam: r.versions.exams.title,
      version: r.versions.label,
      grade: r.grade,
      pending: r.pending,
      automatic: r.automatic_score,
      manual: r.manual_score,
      maximum: r.maximum_score,
      gradeClass: r.students.grade,
      section: r.students.section,
    }));
    const headers = [
      "Alumno",
      "Evaluación",
      "Versión",
      "Nota",
      "Pendientes",
      "Automático",
      "Manual",
      "Máximo",
      "Grado",
      "Sección",
    ];
    const values = rows.map((r) => Object.values(r));
    const format = s.get("format") ?? "csv";
    let bytes: Buffer, type: string;
    if (format === "csv") {
      bytes = Buffer.from(
        "\uFEFF" +
          [headers, ...values]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n"),
        "utf8",
      );
      type = "text/csv; charset=utf-8";
    } else if (format === "xlsx") {
      const { reportSpreadsheet } = await import("@/lib/report-spreadsheet");
      bytes = await reportSpreadsheet(headers, values);
      type =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (format === "pdf") {
      const { reportPdf } = await import("@/lib/pdf"),
        { data: settings } = await db
          .from("settings")
          .select("institution")
          .eq("owner_id", user.id)
          .maybeSingle();
      bytes = Buffer.from(
        await reportPdf(rows, settings?.institution ?? "COLEGIO CRAMER"),
      );
      type = "application/pdf";
    } else throw Error("Formato inválido");
    if (bytes.length > 4_000_000)
      throw Error(
        "El reporte supera 4 MB. Aplica filtros y exporta por grupos.",
      );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="resultados.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          typeof e === "object" && e && "message" in e
            ? String(e.message)
            : "No se pudo exportar",
      },
      { status: 400 },
    );
  }
}
