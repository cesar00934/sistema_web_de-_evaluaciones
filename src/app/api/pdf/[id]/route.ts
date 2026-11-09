import { NextRequest, NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import { generatePdf, type PdfMode } from "@/lib/pdf";
import { pdfAssetLoader } from "@/lib/pdf-assets";
import type { Exam } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, user } = await authenticated(),
      { id } = await params,
      owner = request.nextUrl.searchParams.get("owner") || user.id,
      mode = (request.nextUrl.searchParams.get("mode") ??
        "original") as PdfMode;
    if (
      !["original", "qr", "sheet", "qr-sheet", "answers", "keys"].includes(mode)
    )
      throw Error("Formato inválido");
    const { data: v, error } = await db
      .from("versions")
      .select(
        "owner_id,id,exam_id,label,questions,items,page_count,exam_snapshot",
      )
      .eq("owner_id", owner)
      .eq("id", id)
      .single();
    if (error) throw error;
    let exam: Exam;
    if (v.exam_snapshot) exam = v.exam_snapshot as Exam;
    else {
      const { data, error } = await db
        .from("exams")
        .select(
          "owner_id,id,title,area,level,grade,section,bimester,unit,scale_maximum,question_ids,settings,teacher_id",
        )
        .eq("owner_id", owner)
        .eq("id", v.exam_id)
        .single();
      if (error) throw error;
      exam = data;
    }
    const { data: settings } = await db
      .from("settings")
      .select("institution,preferences")
      .eq("owner_id", owner)
      .maybeSingle();
    if (exam.teacher_id && !exam.settings.teacherName) {
      const { data } = await db
        .from("teachers")
        .select("name")
        .eq("owner_id", owner)
        .eq("id", exam.teacher_id)
        .maybeSingle();
      exam.settings = { ...exam.settings, teacherName: data?.name ?? "" };
    }
    exam.settings = {
      ...exam.settings,
      institutional: exam.settings.institutional ?? settings?.preferences ?? {},
    };
    const bytes = await generatePdf(
      exam,
      v,
      String(
        exam.settings.institution ?? settings?.institution ?? "COLEGIO CRAMER",
      ),
      mode,
      pdfAssetLoader(db),
    );
    if (bytes.length > 4_000_000)
      throw Error(
        "El PDF supera 4 MB. Reduce imágenes o divide la evaluación.",
      );
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="evaluacion-cramer.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          typeof e === "object" && e && "message" in e
            ? String(e.message)
            : "Error de PDF",
      },
      { status: 400 },
    );
  }
}
