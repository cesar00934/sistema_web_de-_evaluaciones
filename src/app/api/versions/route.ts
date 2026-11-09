import { NextRequest, NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import {
  questionSchema,
  createVersion,
  sheetLayout,
  questionScore,
} from "@/lib/domain";
import { z } from "zod";
import { questionsForEvaluation } from "@/lib/evaluation";
import { institutionalDefaults } from "@/lib/editor-defaults";
export async function POST(request: NextRequest) {
  try {
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== request.nextUrl.origin
    )
      throw Error("Origen no autorizado");
    const { db, user } = await authenticated();
    const input = z
      .object({
        examId: z.string().min(1),
        label: z.string().trim().min(1).max(80),
        shuffleQuestions: z.boolean(),
        shuffleOptions: z.boolean(),
      })
      .parse(await request.json());
    const { data: exam, error } = await db
      .from("exams")
      .select(
        "owner_id,id,title,area,level,grade,section,bimester,unit,teacher_id,question_ids,scale_maximum,settings",
      )
      .eq("owner_id", user.id)
      .eq("id", input.examId)
      .single();
    if (error) throw error;
    const { data: preferences } = await db
      .from("settings")
      .select("institution,preferences")
      .eq("owner_id", user.id)
      .maybeSingle();
    let teacherName = String(exam.settings.teacherName ?? "");
    if (!teacherName && exam.teacher_id) {
      const { data: teacher } = await db
        .from("teachers")
        .select("name")
        .eq("owner_id", user.id)
        .eq("id", exam.teacher_id)
        .maybeSingle();
      teacherName = teacher?.name ?? "";
    }
    const snapshotSettings = {
      ...exam.settings,
      localQuestions: undefined,
      teacherName,
      institution:
        exam.settings.institution ??
        preferences?.institution ??
        "COLEGIO CRAMER",
      institutional: {
        ...institutionalDefaults,
        ...(exam.settings.institutional ?? preferences?.preferences ?? {}),
      },
    };
    if (exam.question_ids.length > 250 || !exam.question_ids.length)
      throw Error("Selecciona entre 1 y 250 preguntas");
    const { data: bank, error: qe } = await db
      .from("questions")
      .select("id,payload")
      .eq("owner_id", user.id)
      .in("id", exam.question_ids);
    if (qe) throw qe;
    const questions = questionsForEvaluation(exam, bank).map((q) => {
      const parsed = questionSchema.parse(q),
        settings = exam.settings;
      return {
        ...parsed,
        score: questionScore(
          settings.scoringMode ?? "manual",
          parsed.score,
          exam.question_ids.length,
          settings.total ?? 40,
        ),
      };
    });
    if (
      questions.reduce((n: number, q: { score: number }) => n + q.score, 0) <= 0
    )
      throw Error("El puntaje total debe ser positivo");
    const ordered = createVersion(
        questions,
        input.shuffleQuestions,
        input.shuffleOptions,
      ),
      pages = sheetLayout(ordered);
    const { data, error: ve } = await db
      .from("versions")
      .insert({
        owner_id: user.id,
        id: crypto.randomUUID(),
        exam_id: exam.id,
        label: input.label,
        questions: ordered,
        items: pages.flatMap((p) => [...p.items, ...p.written]),
        page_count: pages.length,
        scale_maximum: exam.scale_maximum,
        exam_snapshot: {
          ...exam,
          settings: snapshotSettings,
        },
      })
      .select("id")
      .single();
    if (ve) throw ve;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : typeof error === "object" && error && "message" in error
              ? String(error.message)
              : "No se pudo crear la versión",
      },
      { status: 400 },
    );
  }
}
