import { NextRequest, NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import { evaluationSchema, validateOwnedAssets } from "@/lib/evaluation";
import { generatePdf, type PdfMode } from "@/lib/pdf";
import { pdfAssetLoader } from "@/lib/pdf-assets";
import { pdfResponse } from "@/lib/pdf-response";
import { sheetLayout, questionScore } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== request.nextUrl.origin
    )
      throw Error("Origen no autorizado");
    const { db, user } = await authenticated(),
      body = await request.json(),
      input = evaluationSchema.parse(body);
    validateOwnedAssets(input.settings, user.id);
    if (!input.settings.localQuestions.length)
      throw Error("Agrega al menos una pregunta");
    const mode = (body.mode ?? "original") as PdfMode;
    if (
      !["original", "qr", "sheet", "qr-sheet", "keys", "answers"].includes(mode)
    )
      throw Error("Formato inválido");
    const questions = input.settings.localQuestions.map((q) => ({
        ...q,
        score: questionScore(
          input.settings.scoringMode,
          q.score,
          input.settings.localQuestions.length,
          input.settings.total,
        ),
      })),
      pages = sheetLayout(questions),
      bytes = await generatePdf(
        { ...input, question_ids: questions.map((q) => q.id) },
        {
          id: "preview",
          exam_id: input.id,
          label: "ORIGINAL",
          questions,
          items: pages.flatMap((p) => [...p.items, ...p.written]),
          page_count: pages.length,
        },
        String(input.settings.institution ?? "COLEGIO CRAMER"),
        mode,
        pdfAssetLoader(db),
      );
    return pdfResponse(bytes);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          typeof e === "object" && e && "message" in e
            ? String(e.message)
            : "No se pudo generar la vista previa",
      },
      { status: 400 },
    );
  }
}
